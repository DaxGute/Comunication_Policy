/**
 * Tiny semantic-move protocol: task evidence, subject aliases, grounding,
 * Nano shape recovery, crossword extraction, and stall handling.
 *
 * Run: npm run test:reasoning-moves
 */
import assert from "node:assert/strict";
import { createCommunicationPolicy } from "../src/communication/policy";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningIntents,
  compileReasoningMoves,
  normalizeReasoningMove,
  parseAgentTurn,
  recoverParsedTurn,
  seedGraphForProblem,
  STRUCTURED_REASONING_STALL_FEEDBACK,
  type ReasoningGraph,
} from "../src/reasoning";
import { extractCrosswordFillMoves } from "../src/problems/crossword/extract";
import { resolveCrosswordSubject } from "../src/problems/crossword/refs";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import { runProblem } from "../src/runtime/runProblem";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { buildTurnRequestForAgent } from "../src/runtime/renderModelRequest";

const crosswordProblem: Problem = {
  id: "moves-crossword",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Moves test",
  text: "test",
  crossword: {
    width: 5,
    height: 2,
    difficulty: "test",
    category: "test",
    grid: [".....", "....."],
    solution: ["EMAIL", "YURTA"],
    source: "crosswordbench",
    sourceId: 1,
    clues: [
      {
        number: 1,
        direction: "across",
        clue: "Top of a suit?",
        row: 0,
        col: 0,
        length: 5,
        answer: "EMAIL",
      },
      {
        number: 5,
        direction: "across",
        clue: "Enrollment record",
        row: 1,
        col: 0,
        length: 5,
        answer: "ENROL",
      },
      {
        number: 2,
        direction: "down",
        clue: "Tent home",
        row: 0,
        col: 1,
        length: 5,
        answer: "YURTA",
      },
    ],
  },
};

const moralProblem: Problem = {
  id: "moves-moral",
  category: "moral_philosophical",
  kind: "moral",
  title: "Moral",
  text: "A scenario about autonomy.",
  moral: {
    title: "Autonomy",
    description: "The agent hides a diagnosis.",
    issues: ["autonomy", "beneficence"],
    question: "Should the diagnosis be disclosed?",
    source: "reddit_ethics",
    sourceIndex: 1,
  },
};

const proofProblem: Problem = {
  id: "moves-proof",
  category: "proof",
  kind: "proof",
  title: "Proof",
  text: "Prove that 1+1=2.",
  proof: {
    question: "Prove that 1+1=2.",
    referenceProof: "By Peano axioms.",
    source: "proofsolver",
    sourceIndex: 1,
  },
};

function applyTurn(
  graph: ReasoningGraph,
  raw: string,
  problem: Problem,
  actor: "agent_a" | "agent_b" = "agent_a",
  turn = 1,
) {
  const adapter = taskReasoningAdapterFor(problem);
  const parsed = recoverParsedTurn(parseAgentTurn(raw, actor, turn), {
    problem,
    adapter,
    graph,
  });
  const applied = applyReasoningIntents(graph, parsed.intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    protocolFailure: parsed.protocolFailure,
    candidateIdentity: (node) => adapter.candidateIdentity?.(problem, node),
    validateCandidate: (node) =>
      adapter.validateCandidate?.(problem, node) ?? { ok: true },
    resolveSubjectAlias: (rawSubject) =>
      adapter.resolveSubject?.(problem, rawSubject) ?? {},
    resolveBasis: (basis, subjectId) => {
      const resolved = adapter.resolveBasis?.(problem, graph, basis, { subjectId });
      if (!resolved) return {};
      return {
        id: resolved.id,
        relation: resolved.relation,
        error: resolved.error,
      };
    },
    autoGround: (subjectId) => {
      const node = graph.nodes.find(
        (item) =>
          item.type === "evidence" &&
          item.subjectId === subjectId &&
          item.evidenceOrigin === "task",
      );
      return node ? { nodeId: node.id, relation: "grounds" } : undefined;
    },
    extraDiagnostics: [
      ...(parsed.normalizedFromMalformedShape ? ["normalizedFromMalformedShape"] : []),
      ...(parsed.extractedFromMessage ? ["extracted_from_message"] : []),
      ...(parsed.structuredReasoningMissing ? ["structured_reasoning_missing"] : []),
    ],
  });
  return { ...applied, parsed };
}

{
  const adapter = crosswordReasoningAdapter;
  const graph = seedGraphForProblem(crosswordProblem, adapter);
  assert.ok((graph.subjects?.length ?? 0) >= 3);
  const clues = graph.nodes.filter(
    (node) => node.type === "evidence" && node.evidenceOrigin === "task",
  );
  assert.equal(clues.length, 3);
  assert.equal(clues[0]?.createdBy, "system");
  assert.equal(clues[0]?.createdAtTurn, 0);
  assert.ok(clues.some((node) => node.text === "Top of a suit?"));
  assert.ok(
    clues.some(
      (node) =>
        node.subjectId === "crossword:across:1" &&
        Array.isArray(node.metadata?.aliases) &&
        node.metadata.aliases.includes("clue"),
    ),
  );
}

{
  assert.equal(resolveCrosswordSubject(crosswordProblem, "Across 5").id, "crossword:across:5");
  assert.equal(resolveCrosswordSubject(crosswordProblem, "5A").id, "crossword:across:5");
  assert.equal(resolveCrosswordSubject(crosswordProblem, "A5").id, "crossword:across:5");
  assert.equal(resolveCrosswordSubject(crosswordProblem, "2D").id, "crossword:down:2");
  assert.equal(resolveCrosswordSubject(crosswordProblem, "Down 2").id, "crossword:down:2");
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const applied = applyTurn(
    graph,
    JSON.stringify({
      message: "I think Across 5 is EMAIL.",
      moves: [{ kind: "claim", subject: "Across 5", value: "EMAIL", basis: ["clue"] }],
    }),
    crosswordProblem,
  );
  const claim = applied.graph.nodes.find((node) => node.type === "claim");
  assert.equal(claim?.subjectId, "crossword:across:5");
  assert.equal(claim?.text.includes("EMAIL"), true);
  const clue = applied.graph.nodes.find(
    (node) =>
      node.type === "evidence" && node.subjectId === "crossword:across:5",
  );
  assert.ok(clue);
  assert.equal(
    applied.graph.edges?.some(
      (edge) =>
        edge.type === "grounds" &&
        edge.sourceNodeId === clue?.id &&
        edge.targetNodeId === claim?.id,
    ),
    true,
  );
  assert.equal(claim?.evidenceOrigin, undefined);
  assert.equal(clue?.evidenceOrigin, "task");
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const alias = applyTurn(
    graph,
    JSON.stringify({
      message: "5A EMAIL",
      moves: [{ kind: "claim", subject: "5A", value: "EMAIL", basis: ["clue"] }],
    }),
    crosswordProblem,
  );
  assert.equal(
    alias.graph.nodes.find((node) => node.type === "claim")?.subjectId,
    "crossword:across:5",
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const first = applyTurn(
    graph,
    JSON.stringify({
      message: "Across 5 = EMAIL",
      moves: [{ kind: "claim", subject: "Across 5", value: "EMAIL", basis: ["clue"] }],
    }),
    crosswordProblem,
  );
  const agreed = applyTurn(
    first.graph,
    JSON.stringify({
      message: "Agreed on Across 5.",
      moves: [{ kind: "agree", subject: "Across 5" }],
    }),
    crosswordProblem,
    "agent_b",
    2,
  );
  const claim = first.graph.nodes.find((node) => node.type === "claim");
  assert.equal(
    agreed.events.some(
      (event) => event.accepted && event.operation.type === "accept",
    ),
    true,
  );
  assert.ok(claim);
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const first = applyTurn(
    graph,
    JSON.stringify({
      message: "two live candidates",
      moves: [{ kind: "claim", subject: "Across 5", value: "EMAIL", basis: ["clue"] }],
    }),
    crosswordProblem,
  );
  const second = applyReasoningIntents(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 5 = ENROL",
        subjectId: "crossword:across:5",
      },
    ],
    {
      actor: "agent_b",
      turnIndex: 2,
      messageId: "msg-2",
      candidateIdentity: (node) =>
        crosswordReasoningAdapter.candidateIdentity?.(crosswordProblem, node),
    },
  );
  const ambiguous = applyTurn(
    second.graph,
    JSON.stringify({
      message: "I agree.",
      moves: [{ kind: "agree", subject: "Across 5" }],
    }),
    crosswordProblem,
    "agent_a",
    3,
  );
  assert.equal(
    ambiguous.events.some((event) => !event.accepted && event.errors.some((error) => /ambiguous/.test(error))),
    true,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const first = applyTurn(
    graph,
    JSON.stringify({
      message: "Across 5 = EMAIL",
      moves: [{ kind: "claim", subject: "Across 5", value: "EMAIL", basis: ["clue"] }],
    }),
    crosswordProblem,
  );
  const revised = applyTurn(
    first.graph,
    JSON.stringify({
      message: "Change Across 5 to ENROL because of the crossing.",
      moves: [
        {
          kind: "revise",
          subject: "Across 5",
          value: "ENROL",
          basis: ["crossing with Down 2"],
        },
      ],
    }),
    crosswordProblem,
    "agent_a",
    2,
  );
  const old = revised.graph.nodes.find((node) => node.text.includes("EMAIL"));
  const next = revised.graph.nodes.find((node) => node.text.includes("ENROL"));
  assert.equal(old?.status, "superseded");
  assert.ok(next);
  assert.equal(
    revised.graph.edges?.some(
      (edge) =>
        edge.type === "revises" &&
        edge.sourceNodeId === next?.id &&
        edge.targetNodeId === old?.id,
    ),
    true,
  );
  assert.equal(
    revised.graph.edges?.some(
      (edge) =>
        edge.type === "replaced_by" &&
        edge.sourceNodeId === old?.id &&
        edge.targetNodeId === next?.id,
    ),
    true,
  );
  assert.equal(
    revised.graph.edges?.some(
      (edge) => edge.type === "grounds" && edge.targetNodeId === next?.id,
    ) ||
      revised.graph.edges?.some(
        (edge) => edge.type === "supports" && edge.targetNodeId === next?.id,
      ),
    true,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const malformed = applyTurn(
    graph,
    JSON.stringify({
      message: "Across 5 is EMAIL",
      moves: [{ create: "claim", text: "EMAIL", subject: "Across 5" }],
    }),
    crosswordProblem,
  );
  assert.equal(malformed.parsed.normalizedFromMalformedShape, true);
  assert.ok(malformed.graph.nodes.some((node) => node.type === "claim"));
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const malformed = applyTurn(
    graph,
    JSON.stringify({
      message: "Across 5 is EMAIL",
      moves: [{ nodeType: "claim", text: "EMAIL", subject: "Across 5" }],
    }),
    crosswordProblem,
  );
  assert.equal(malformed.parsed.normalizedFromMalformedShape, true);
  assert.ok(malformed.graph.nodes.some((node) => node.type === "claim"));
}

{
  const rejected = normalizeReasoningMove({ foo: 1, bar: 2 });
  assert.equal(rejected.invalid, true);
  assert.equal(rejected.move, undefined);
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const extracted = applyTurn(
    graph,
    JSON.stringify({
      message: "Across 5 = EMAIL and Down 2 is YURTA",
      moves: [],
    }),
    crosswordProblem,
  );
  assert.equal(extracted.parsed.extractedFromMessage, true);
  assert.equal(
    extracted.graph.nodes.filter((node) => node.type === "claim").length,
    2,
  );
  assert.deepEqual(
    extractCrosswordFillMoves("5A EMAIL").map((move) =>
      move.kind === "claim" ? move.value : undefined,
    ),
    ["EMAIL"],
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const missing = applyTurn(
    graph,
    JSON.stringify({
      message: "EMAIL cannot be right because the crossing requires R.",
      moves: [],
    }),
    crosswordProblem,
  );
  assert.equal(missing.parsed.structuredReasoningMissing, true);
  assert.equal(
    missing.events.some((event) =>
      event.diagnostics?.includes("structured_reasoning_missing"),
    ),
    true,
  );
  assert.equal(missing.parsed.message.includes("EMAIL cannot be"), true);
}

{
  const graph = seedGraphForProblem(moralProblem, taskReasoningAdapterFor(moralProblem));
  const facts = graph.nodes.filter((node) => node.evidenceOrigin === "task");
  assert.ok(facts.some((node) => node.metadata?.aliases?.includes("scenario_fact_1")));
  const applied = applyTurn(
    graph,
    JSON.stringify({
      message: "Hiding the diagnosis infringes autonomy.",
      moves: [
        {
          kind: "claim",
          subject: "Main moral question",
          value: "The action infringes autonomy",
          basis: ["scenario_fact_1"],
        },
      ],
    }),
    moralProblem,
  );
  const claim = applied.graph.nodes.find((node) => node.type === "claim");
  assert.ok(claim);
  assert.equal(
    applied.graph.edges?.some(
      (edge) => edge.type === "grounds" && edge.targetNodeId === claim?.id,
    ),
    true,
  );
  const extracted = extractCrosswordFillMoves(applied.parsed.message);
  assert.equal(extracted.length, 0);
}

{
  const graph = seedGraphForProblem(proofProblem, taskReasoningAdapterFor(proofProblem));
  assert.ok(
    graph.nodes.some(
      (node) =>
        node.type === "evidence" &&
        Array.isArray(node.metadata?.aliases) &&
        node.metadata.aliases.includes("goal"),
    ),
  );
  const applied = applyTurn(
    graph,
    JSON.stringify({
      message: "From the given, 1+1=2.",
      moves: [
        {
          kind: "claim",
          subject: "Prove the theorem",
          value: "1+1=2 follows from the axioms",
          basis: ["given_1"],
        },
      ],
    }),
    proofProblem,
  );
  assert.ok(applied.graph.nodes.some((node) => node.type === "claim"));
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const compiled = compileReasoningMoves(
    [{ kind: "claim", subject: "Across 5", value: "EMAIL", basis: ["clue"] }],
    {
      problem: crosswordProblem,
      adapter: crosswordReasoningAdapter,
      graph,
    },
  );
  assert.equal(compiled.intents[0]?.action, "create");
  assert.equal(
    compiled.intents.some((intent) => "parents" in intent && intent.parents?.length),
    false,
  );
}

class StallClient implements ModelClient {
  async generate(_input: ModelRequest): Promise<ModelResponse> {
    return {
      content: JSON.stringify({
        message:
          "EMAIL cannot work because Down 2 requires R. The crossing requires a change.",
        moves: [],
      }),
      provider: "mock",
    };
  }
}

{
  const policy = createCommunicationPolicy({
    trustA: 0.5,
    trustB: 0.5,
    authority: 0.5,
    familiarity: 0.5,
  });
  const conversation = await runProblem({
    problem: crosswordProblem,
    policy,
    config: normalizeRunConfig(
      {
        problemCategory: "crossword",
        runModel: MOCK_MODEL_ID,
        maxTurns: 10,
        stallRecoveryTurns: 1,
        stallFailTurns: 2,
      },
      { ...DEFAULT_RUN_CONFIG, runModel: MOCK_MODEL_ID, provider: "mock" },
    ),
    client: new StallClient(),
    agentPrompts: buildAgentPromptPair(policy),
  });
  assert.equal(conversation.stoppedReason, "reasoning_protocol_stalled");
  assert.ok(conversation.messages.every((message) => message.content.includes("EMAIL cannot work")));
  const request = buildTurnRequestForAgent({
    agentId: "agent_a",
    agentPrompts: buildAgentPromptPair(policy),
    problemText: "P",
    utterances: [],
    turn: 2,
    maxTurns: 8,
    reasoningGraph: seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter),
    protocolFeedback: STRUCTURED_REASONING_STALL_FEEDBACK,
  });
  assert.ok(
    request.messages.some((message) =>
      message.content.includes("STRUCTURED REASONING STALLED"),
    ),
  );
}

console.log(
  "ok — reasoning moves: task evidence, aliases, grounding, recovery, extraction, stall",
);
