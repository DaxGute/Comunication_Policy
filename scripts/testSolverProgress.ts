/**
 * Canonical solver-state progress: no-op mutations, malformed fills,
 * local loops, and semantic stall on crosswordbench-style cycling.
 *
 * Run: npm run test:solver-progress
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import {
  crosswordReasoningAdapter,
  deriveCrosswordCandidateLedger,
  validateCrosswordCandidate,
} from "../src/problems/adapters/crosswordAdapter";
import { loadCrosswordBenchProblems } from "../src/problems/crossword/loadCrosswordBench";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningIntents,
  compileReasoningMoves,
  emptySolverProgressState,
  localLoopFeedback,
  finalizationRequiredFeedback,
  reduceSolverProgress,
  stallWarningFeedback,
  seedGraphForProblem,
  type IssueConvergenceState,
  type ReasoningEvent,
  type ReasoningGraph,
} from "../src/reasoning";
import { runProblem } from "../src/runtime/runProblem";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";
import { MOCK_MODEL_ID } from "../src/runtime/models";

const policy = createCommunicationPolicy({
  trustA: 0.5,
  trustB: 0.5,
  authority: 0.5,
  familiarity: 0.5,
});

function apply(
  problem: Problem,
  graph: ReasoningGraph,
  intents: Parameters<typeof applyReasoningIntents>[1],
  actor: "agent_a" | "agent_b",
  turn: number,
) {
  return applyReasoningIntents(graph, intents, {
    actor,
    turnIndex: turn,
    messageId: `m-${turn}-${actor}`,
    candidateIdentity: (node) =>
      crosswordReasoningAdapter.candidateIdentity?.(problem, node),
    validateCandidate: (node) =>
      crosswordReasoningAdapter.validateCandidate?.(problem, node) ?? {
        ok: true,
      },
  });
}

const mini: Problem = {
  id: "solver-progress-mini",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Mini",
  text: "test",
  crossword: {
    width: 4,
    height: 2,
    difficulty: "test",
    category: "test",
    grid: ["....", "...."],
    solution: ["DAVE", "DOVE"],
    source: "crosswordbench",
    sourceId: 1,
    clues: [
      {
        number: 6,
        direction: "across",
        clue: "Actor Franco",
        row: 0,
        col: 0,
        length: 4,
        answer: "DAVE",
      },
      {
        number: 1,
        direction: "down",
        clue: "Untouched",
        row: 0,
        col: 0,
        length: 2,
        answer: "DO",
      },
    ],
  },
};

{
  const seeded = seedGraphForProblem(mini, crosswordReasoningAdapter);
  const compiled = compileReasoningMoves(
    [{ kind: "claim", subject: "Across 6", value: "DAVE", basis: ["clue"] }],
    { problem: mini, adapter: crosswordReasoningAdapter, graph: seeded },
  );
  const first = apply(mini, seeded, compiled.intents, "agent_a", 1);
  assert.equal(first.events.some((event) => event.accepted && event.stateChanged !== false), true);
  const again = apply(
    mini,
    first.graph,
    compiled.intents.map((intent) =>
      intent.action === "create"
        ? { ...intent, action: "create" as const }
        : intent,
    ),
    "agent_b",
    2,
  );
  const liveDave = first.graph.nodes.filter(
    (node) =>
      (node.type === "claim" || node.type === "proposal") &&
      node.status !== "rejected" &&
      node.status !== "superseded",
  );
  assert.equal(liveDave.length, 1);
  assert.equal(again.events.at(-1)?.stateChanged, false);
  assert.match(again.events.at(-1)?.diagnostics?.join(" ") ?? "", /no_state_change/);
  assert.equal(
    again.graph.nodes.filter((node) => node.type === "claim" || node.type === "proposal")
      .length,
    liveDave.length,
  );

  const sameRevise = apply(
    mini,
    first.graph,
    [
      {
        action: "revise",
        targetId: liveDave[0]!.id,
        text: "Across 6 = DAVE",
        metadata: { answer: "DAVE" },
      },
    ],
    "agent_b",
    3,
  );
  assert.equal(sameRevise.events.at(-1)?.stateChanged, false);
  assert.match(
    sameRevise.events.at(-1)?.diagnostics?.join(" ") ?? "",
    /already the live candidate/,
  );
}

{
  const invalid = validateCrosswordCandidate(mini, {
    type: "claim",
    text: "MUSTHAVERCRNOTUTOAGREEWITHDOWNSHEER",
    subjectId: "crossword:across:6",
    metadata: { answer: "MUSTHAVERCRNOTUTOAGREEWITHDOWNSHEER" },
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reasons?.join(" ") ?? "", /length/);

  const seeded = seedGraphForProblem(mini, crosswordReasoningAdapter);
  const applied = apply(
    mini,
    seeded,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "MUSTHAVERCRNOTUTOAGREEWITHDOWNSHEER",
        subjectId: "crossword:across:6",
        metadata: { answer: "MUSTHAVERCRNOTUTOAGREEWITHDOWNSHEER" },
      },
    ],
    "agent_a",
    1,
  );
  assert.equal(applied.events[0]?.accepted, false);
  assert.equal(
    applied.graph.nodes.some((node) => node.type === "claim"),
    false,
  );
  const ledger = deriveCrosswordCandidateLedger(mini, applied.graph);
  const across = ledger.find((item) => item.issueId === "crossword:across:6")!;
  assert.equal(across.liveCandidates.length, 0);
  assert.equal(across.untouched, true);
}

function requestText(conversation: { messages: { modelRequest?: { content: string }[] }[] }): string {
  return conversation.messages
    .flatMap((message) => message.modelRequest ?? [])
    .map((item) => item.content)
    .join("\n");
}

function countOccurrences(text: string, pattern: RegExp): number {
  return text.match(new RegExp(pattern.source, "g"))?.length ?? 0;
}

{
  const text = localLoopFeedback({ loopingLabels: ["Across 6"] });
  assert.match(text, /repeatedly revisiting the same unresolved issue/);
  assert.doesNotMatch(text, /Across 6/);
  assert.doesNotMatch(text, /Do not propose another candidate/);
  assert.doesNotMatch(text, /Untouched clues/);
  const stall = stallWarningFeedback();
  assert.match(stall, /STALL WARNING/);
  assert.match(stall, /Change reasoning strategy/);
  assert.doesNotMatch(stall, /internally consistent/);
  assert.doesNotMatch(stall, /Do not propose/);
  const finalize = finalizationRequiredFeedback();
  assert.match(finalize, /FINALIZATION REQUIRED/);
  assert.match(finalize, /even if some entries remain uncertain/);
}

class CrossingLoopClient implements ModelClient {
  constructor(
    private readonly subject: string,
    private readonly answers: string[],
    private readonly onPrompt?: (input: ModelRequest) => ModelResponse | undefined,
  ) {}
  turn = 0;
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const override = this.onPrompt?.(input);
    if (override) return override;
    const answer = this.answers[this.turn % this.answers.length]!;
    this.turn += 1;
    return {
      content: JSON.stringify({
        message: `${this.subject} = ${answer}. The crossing still conflicts.`,
        moves: [
          {
            kind: "claim",
            subject: this.subject,
            value: answer,
            basis: ["clue"],
          },
        ],
      }),
      provider: "mock",
    };
  }
}

function loopConfig(maxTurns = 40) {
  return normalizeRunConfig(
    {
      problemCategory: "crossword",
      runModel: MOCK_MODEL_ID,
      maxTurns,
      stallRecoveryTurns: 2,
      stallFailTurns: 6,
      localLoopTurns: 3,
      cycleWindowTurns: 6,
    },
    { ...DEFAULT_RUN_CONFIG, runModel: MOCK_MODEL_ID, provider: "mock" },
  );
}

async function runLooped(
  problem: Problem,
  subject: string,
  answers: string[],
  onPrompt?: (input: ModelRequest) => ModelResponse | undefined,
) {
  return runProblem({
    problem,
    policy,
    config: loopConfig(),
    client: new CrossingLoopClient(subject, answers, onPrompt),
    agentPrompts: buildAgentPromptPair(policy),
  });
}

const bench = loadCrosswordBenchProblems();
const problem0003 = bench.find((problem) => problem.id === "crosswordbench_0003");
const problem0006 = bench.find((problem) => problem.id === "crosswordbench_0006");
assert.ok(problem0003, "crosswordbench_0003 is in the subset");
assert.ok(problem0006, "crosswordbench_0006 is in the subset");

{
  const conversation = await runLooped(problem0003!, "Across 6", ["DAVE", "DOVE"]);
  assert.equal(conversation.stoppedReason, "reasoning_protocol_stalled");
  assert.ok(conversation.messages.length < 40);
  assert.ok(conversation.messages.length <= 12);
  const progress = conversation.reasoningDiagnostics?.solverProgress;
  assert.ok(progress);
  assert.ok(
    (progress.noOpMutationCount ?? 0) +
      (progress.cycleDetectionCount ?? 0) +
      (progress.repeatedStateCount ?? 0) >
      0,
  );
  assert.ok((progress.meaningfulStateTransitionCount ?? 0) < conversation.messages.length);
  assert.ok(progress.semanticStallReason);
  assert.ok(progress.stallWarningTurn);
  assert.equal(progress.stallWarningKind, "local_loop");
  assert.ok(progress.finalizationRequiredTurn);
  assert.ok(
    (progress.finalizationRequiredTurn ?? 0) > (progress.stallWarningTurn ?? 0),
  );
  assert.equal(progress.progressResumedAfterWarning, undefined);
  assert.equal(progress.finalAnswerAfterFinalization, undefined);
  assert.equal(progress.terminatedAsProtocolStall, true);
  assert.ok((progress.recoveryTurnsBeforeFinalization ?? 0) >= 1);
  const liveClaims = (conversation.reasoningNodes ?? []).filter(
    (node) =>
      (node.type === "claim" || node.type === "proposal") &&
      node.status !== "rejected" &&
      node.status !== "superseded",
  );
  const identities = new Set(
    liveClaims.map((node) => node.metadata?.candidateIdentity ?? node.text),
  );
  assert.ok(identities.size <= 2);
  const feedback = requestText(conversation);
  assert.match(feedback, /LOCAL_LOOP/);
  assert.match(feedback, /FINALIZATION REQUIRED/);
  assert.doesNotMatch(feedback, /Do not propose another candidate/);
  assert.doesNotMatch(feedback, /You are cycling on/);
  assert.equal(countOccurrences(feedback, /LOCAL_LOOP/), 1);
  assert.equal(countOccurrences(feedback, /FINALIZATION REQUIRED/), 1);
}

{
  const conversation = await runLooped(problem0006!, "Across 1", ["RIVET", "RIVER"]);
  assert.equal(conversation.stoppedReason, "reasoning_protocol_stalled");
  assert.ok(conversation.messages.length < 40);
  const progress = conversation.reasoningDiagnostics?.solverProgress;
  assert.ok((progress?.repeatedStateCount ?? 0) > 0 || (progress?.noOpMutationCount ?? 0) > 0);
  assert.ok(progress?.finalizationRequiredTurn);
}

{
  const conversation = await runLooped(
    mini,
    "Across 6",
    ["DAVE", "DOVE"],
    (input) => {
      const asked = input.messages.some((message) =>
        message.content.includes("FINALIZATION REQUIRED"),
      );
      if (!asked) return undefined;
      return {
        content: JSON.stringify({
          message:
            "Best effort.\nFINAL_ANSWER:\nACROSS\n6: DAVE\nDOWN\n1: DO",
          moves: [],
          finalAnswer: {
            text: "ACROSS\n6: DAVE\nDOWN\n1: DO",
            supportingNodeIds: [],
          },
        }),
        provider: "mock",
      };
    },
  );
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.match(conversation.finalAnswer ?? "", /DAVE/);
  const progress = conversation.reasoningDiagnostics?.solverProgress;
  assert.equal(progress?.finalAnswerAfterFinalization, true);
  assert.notEqual(progress?.terminatedAsProtocolStall, true);
  assert.ok(progress?.stallWarningTurn);
  assert.ok(progress?.finalizationRequiredTurn);
}

{
  let sawWarning = false;
  let filledOther = false;
  const conversation = await runProblem({
    problem: mini,
    policy,
    config: loopConfig(),
    client: {
      async generate(input: ModelRequest): Promise<ModelResponse> {
        if (
          input.messages.some((message) =>
            /LOCAL_LOOP|STALL WARNING/.test(message.content),
          )
        ) {
          sawWarning = true;
        }
        if (filledOther) {
          return {
            content: JSON.stringify({
              message: "Best current grid.\nFINAL_ANSWER:\nACROSS\n6: DAVE\nDOWN\n1: DO",
              moves: [],
              finalAnswer: {
                text: "ACROSS\n6: DAVE\nDOWN\n1: DO",
                supportingNodeIds: [],
              },
            }),
            provider: "mock",
          };
        }
        if (sawWarning) {
          filledOther = true;
          return {
            content: JSON.stringify({
              message: "Investigating the other clue. Down 1 = DO.",
              moves: [
                {
                  kind: "claim",
                  subject: "Down 1",
                  value: "DO",
                  basis: ["clue"],
                },
              ],
            }),
            provider: "mock",
          };
        }
        return {
          content: JSON.stringify({
            message: "Across 6 = DAVE. Still stuck on the crossing.",
            moves: [
              {
                kind: "claim",
                subject: "Across 6",
                value: "DAVE",
                basis: ["clue"],
              },
            ],
          }),
          provider: "mock",
        };
      },
    },
    agentPrompts: buildAgentPromptPair(policy),
  });
  const progress = conversation.reasoningDiagnostics?.solverProgress;
  assert.equal(progress?.progressResumedAfterWarning, true);
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.ok(sawWarning);
}

{
  const graph: ReasoningGraph = { nodes: [], events: [] };
  const issues = (covered: string[]): IssueConvergenceState[] =>
    ["a", "b", "c", "d"].map((id) => ({
      issueId: id,
      liveClaimIds: covered.includes(id) ? [`${id}-live`] : [],
      unresolved: true,
      contradictory: false,
      reopened: false,
      conflicts: [],
    }));
  const createEvent = (turn: number, subjectId: string): ReasoningEvent => ({
    id: `e${turn}`,
    seq: turn,
    turnIndex: turn,
    messageId: `m${turn}`,
    actor: "agent_a",
    intent: { action: "create", nodeType: "claim", text: `${subjectId}-${turn}` },
    operation: {
      type: "create",
      node: {
        id: `n${turn}`,
        type: "claim",
        text: `${subjectId}-${turn}`,
        subjectId,
        createdBy: "agent_a",
        createdAtTurn: turn,
        status: "open",
        parents: [],
        dependencies: [],
      },
    },
    accepted: true,
    errors: [],
    stateChanged: true,
  });

  let state = emptySolverProgressState();
  state.fingerprints = ["seed"];
  const covered = ["a", "b", "c", "d"];
  const subjects = ["a", "b", "c", "d"];
  let warning: string | undefined;
  let finalized = false;
  for (let turn = 1; turn <= 12; turn++) {
    const subjectId = subjects[(turn - 1) % subjects.length]!;
    const result = reduceSolverProgress(state, {
      turnIndex: turn,
      maxTurns: 20,
      graph,
      events: [createEvent(turn, subjectId)],
      issueStates: issues(covered),
      fingerprint: `fp-${turn}-${subjectId}`,
      substantive: true,
      structuredReasoningMissing: false,
      stallRecoveryTurns: 2,
      stallFailTurns: 6,
      localLoopTurns: 8,
    });
    state = result.state;
    if (result.protocolFeedback?.includes("CLOSURE WARNING")) {
      warning = result.protocolFeedback;
    }
    if (result.protocolFeedback?.includes("FINALIZATION REQUIRED")) {
      finalized = true;
    }
  }
  assert.ok(warning);
  assert.match(warning, /submit the best current FINAL_ANSWER/);
  assert.equal(state.stallWarningKind, "closure");
  assert.ok(state.closureWarningTurn);
  assert.ok(finalized || state.phase === "finalization");
  assert.ok((warning?.split("\n").length ?? 0) <= 6);
}

{
  // Observed crosswordbench_0015 (trustA=1): after STALL WARNING, fingerprint
  // churn without coverage/conflict improvement must not resume search.
  const graph: ReasoningGraph = { nodes: [], events: [] };
  const issues = (covered: string[]): IssueConvergenceState[] =>
    ["a", "b", "c", "d"].map((id) => ({
      issueId: id,
      liveClaimIds: covered.includes(id) ? [`${id}-live`] : [],
      unresolved: !covered.includes(id),
      contradictory: false,
      reopened: false,
      conflicts: [],
    }));
  const eventFor = (turn: number, subjectId: string): ReasoningEvent => ({
    id: `e${turn}`,
    seq: turn,
    turnIndex: turn,
    messageId: `m${turn}`,
    actor: turn % 2 === 1 ? "agent_a" : "agent_b",
    intent: { action: "create", nodeType: "claim", text: `${subjectId}-${turn}` },
    operation: {
      type: "create",
      node: {
        id: `n${turn}`,
        type: "claim",
        text: `${subjectId}-${turn}`,
        subjectId,
        createdBy: turn % 2 === 1 ? "agent_a" : "agent_b",
        createdAtTurn: turn,
        status: "open",
        parents: [],
        dependencies: [],
      },
    },
    accepted: true,
    errors: [],
    stateChanged: false,
    diagnostics: ["no_state_change: already the live candidate"],
  });

  let state = emptySolverProgressState();
  state.fingerprints = ["frozen"];
  let warningTurn: number | undefined;
  let finalizationTurn: number | undefined;
  for (let turn = 1; turn <= 10; turn++) {
    const result = reduceSolverProgress(state, {
      turnIndex: turn,
      maxTurns: 40,
      graph,
      events: [eventFor(turn, "a")],
      issueStates: issues(["a"]),
      fingerprint: turn <= 4 ? "frozen" : `churn-${turn}`,
      substantive: true,
      structuredReasoningMissing: false,
      stallRecoveryTurns: 3,
      stallFailTurns: 8,
      localLoopTurns: 20,
    });
    state = result.state;
    if (result.protocolFeedback?.includes("STALL WARNING")) {
      warningTurn = turn;
    }
    if (result.protocolFeedback?.includes("FINALIZATION REQUIRED")) {
      finalizationTurn = turn;
    }
  }
  assert.ok(warningTurn);
  assert.equal(state.stallWarningKind, "semantic_stall");
  assert.notEqual(state.counters.progressResumedAfterWarning, true);
  assert.ok(finalizationTurn);
  assert.ok(finalizationTurn > warningTurn);
  assert.ok(finalizationTurn - warningTurn <= 3);
}

{
  // Observed 0015 turn 12: empty FINAL_ANSWER after the warning should
  // escalate immediately rather than wandering for more recovery turns.
  const graph: ReasoningGraph = { nodes: [], events: [] };
  const issues: IssueConvergenceState[] = ["a", "b"].map((id) => ({
    issueId: id,
    liveClaimIds: id === "a" ? ["a-live"] : [],
    unresolved: true,
    contradictory: false,
    reopened: false,
    conflicts: [],
  }));
  const eventFor = (turn: number): ReasoningEvent => ({
    id: `e${turn}`,
    seq: turn,
    turnIndex: turn,
    messageId: `m${turn}`,
    actor: "agent_a",
    intent: { action: "create", nodeType: "claim", text: "a" },
    operation: {
      type: "create",
      node: {
        id: `n${turn}`,
        type: "claim",
        text: "a",
        subjectId: "a",
        createdBy: "agent_a",
        createdAtTurn: turn,
        status: "open",
        parents: [],
        dependencies: [],
      },
    },
    accepted: true,
    errors: [],
    stateChanged: false,
    diagnostics: ["no_state_change: already the live candidate"],
  });
  let state = emptySolverProgressState();
  state.fingerprints = ["frozen"];
  let sawFinalization = false;
  for (let turn = 1; turn <= 8; turn++) {
    const result = reduceSolverProgress(state, {
      turnIndex: turn,
      maxTurns: 40,
      graph,
      events: [eventFor(turn)],
      issueStates: issues,
      fingerprint: "frozen",
      substantive: true,
      structuredReasoningMissing: false,
      attemptedFinalAnswer: turn === 5,
      stallRecoveryTurns: 3,
      stallFailTurns: 8,
      localLoopTurns: 20,
    });
    state = result.state;
    if (result.protocolFeedback?.includes("FINALIZATION REQUIRED")) {
      sawFinalization = true;
      assert.equal(turn, 5);
    }
  }
  assert.ok(sawFinalization);
  assert.equal(state.phase, "finalization");
}

{
  // Genuine recovery: filling a new issue after the warning returns to normal.
  const graph: ReasoningGraph = { nodes: [], events: [] };
  const issues = (covered: string[]): IssueConvergenceState[] =>
    ["a", "b"].map((id) => ({
      issueId: id,
      liveClaimIds: covered.includes(id) ? [`${id}-live`] : [],
      unresolved: !covered.includes(id),
      contradictory: false,
      reopened: false,
      conflicts: [],
    }));
  const eventFor = (turn: number, subjectId: string): ReasoningEvent => ({
    id: `e${turn}`,
    seq: turn,
    turnIndex: turn,
    messageId: `m${turn}`,
    actor: "agent_a",
    intent: { action: "create", nodeType: "claim", text: `${subjectId}-${turn}` },
    operation: {
      type: "create",
      node: {
        id: `n${turn}`,
        type: "claim",
        text: `${subjectId}-${turn}`,
        subjectId,
        createdBy: "agent_a",
        createdAtTurn: turn,
        status: "open",
        parents: [],
        dependencies: [],
      },
    },
    accepted: true,
    errors: [],
    stateChanged: true,
  });
  let state = emptySolverProgressState();
  state.fingerprints = ["frozen"];
  for (let turn = 1; turn <= 7; turn++) {
    const covered = turn >= 5 ? ["a", "b"] : ["a"];
    const result = reduceSolverProgress(state, {
      turnIndex: turn,
      maxTurns: 40,
      graph,
      events: [eventFor(turn, turn >= 5 ? "b" : "a")],
      issueStates: issues(covered),
      fingerprint: turn >= 5 ? `progress-${turn}` : "frozen",
      substantive: true,
      structuredReasoningMissing: false,
      stallRecoveryTurns: 3,
      stallFailTurns: 8,
      localLoopTurns: 20,
    });
    state = result.state;
  }
  assert.equal(state.counters.progressResumedAfterWarning, true);
  assert.equal(state.phase, "normal");
  assert.equal(state.finalizationRequiredTurn, undefined);
}

console.log(
  "ok — solver progress: canonical identity, malformed fills, stall recovery/finalization",
);
