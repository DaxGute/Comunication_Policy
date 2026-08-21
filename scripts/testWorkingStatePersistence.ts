/**
 * Working-state persistence regressions from the schema-v2 empirical audit.
 *
 * Run: npm run test:working-state
 */
import assert from "node:assert/strict";
import { agentLabel } from "../src/agents/identity";
import {
  completedCrosswordFill,
  crosswordReasoningAdapter,
} from "../src/problems/adapters/crosswordAdapter";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningMutations,
  coverageForTurn,
  currentValue,
  formatReasoningState,
  looksLikePersistenceReview,
  parseAgentTurn,
  propositionCommitment,
  recoverParsedTurn,
  reasoningStateUserMessage,
  seedGraphForProblem,
  snapshotThroughTurn,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";
import { partnerMessageUserMessage } from "../src/runtime/renderModelRequest";
import { utteranceFromMessage } from "../src/runtime/transcript";
import type { ConversationMessage } from "../src/experiment/types";

const crosswordProblem: Problem = {
  id: "working-state-crossword",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Partial persistence",
  text: "test",
  crossword: {
    width: 5,
    height: 3,
    difficulty: "test",
    category: "test",
    grid: [".....", ".#.#.", "....."],
    solution: ["MIDAS", ".E.W.", "GEMXX"],
    source: "crosswordbench",
    sourceId: 1,
    clues: [
      {
        number: 4,
        direction: "across",
        clue: "King",
        row: 0,
        col: 0,
        length: 5,
        answer: "MIDAS",
      },
      {
        number: 3,
        direction: "down",
        clue: "Cardinal",
        row: 0,
        col: 0,
        length: 3,
        answer: "MEG",
      },
      {
        number: 1,
        direction: "down",
        clue: "Jewel",
        row: 0,
        col: 1,
        length: 3,
        answer: "GEM",
      },
      {
        number: 2,
        direction: "down",
        clue: "Year to date",
        row: 0,
        col: 2,
        length: 3,
        answer: "YTD",
      },
      {
        number: 5,
        direction: "down",
        clue: "Empire",
        row: 0,
        col: 3,
        length: 3,
        answer: "INCA",
      },
      {
        number: 6,
        direction: "down",
        clue: "Tie term",
        row: 0,
        col: 4,
        length: 3,
        answer: "ALL",
      },
    ],
  },
};

function apply(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  turn = 1,
  actor: "agent_a" | "agent_b" = "agent_a",
  extra?: { protocolFailure?: string; extraDiagnostics?: string[] },
) {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    subjectsAreClosed: crosswordReasoningAdapter.subjectsAreClosed,
    resolveSubject: (raw) =>
      crosswordReasoningAdapter.resolveSubject?.(crosswordProblem, raw) ?? {},
    validateContent: (subjectId, content) =>
      crosswordReasoningAdapter.validateContent?.(
        crosswordProblem,
        subjectId,
        content,
      ) ?? { ok: true },
    protocolFailure: extra?.protocolFailure,
    extraDiagnostics: extra?.extraDiagnostics,
  });
}

function moralProblem(): Problem {
  return {
    id: "working-state-moral",
    category: "moral_philosophical",
    kind: "moral",
    title: "Boundary setting",
    text: "A student is being harassed. What should be done?",
    moral: {
      title: "Boundary setting",
      description: "A dilemma.",
      issues: [
        "Directness vs sensitivity",
        "Boundary setting vs social expectations",
        "Assertiveness vs aggression",
      ],
      question: "A student is being harassed. What should be done?",
      source: "reddit_ethics",
      sourceIndex: 34,
    },
  };
}

function applyMoral(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  turn = 1,
  actor: "agent_a" | "agent_b" = "agent_a",
) {
  const problem = moralProblem();
  const adapter = taskReasoningAdapterFor(problem);
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    resolveSubject: (raw) => adapter.resolveSubject?.(problem, raw) ?? {},
  });
}

// --- Case A: crossword partial constraint persists past the utterance ---
{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const parsed = parseAgentTurn(
    JSON.stringify({
      message:
        "Across 4 pattern is MIDN? Down 3 begins with E. I'm not ready to commit a full answer.",
      mutations: [
        { type: "SET", subjectId: "crossword:across:4", content: "MIDN?" },
        { type: "SET", subjectId: "crossword:down:3", content: "E??" },
      ],
    }),
    "agent_a",
    1,
  );
  const recovered = recoverParsedTurn(parsed, {
    problem: crosswordProblem,
    adapter: crosswordReasoningAdapter,
    graph,
  });
  assert.equal(recovered.protocolFailure, undefined);
  assert.ok(!recovered.structuredReasoningMissing);
  graph = apply(graph, recovered.mutations as ReasoningMutation[], 1).graph;
  assert.equal(currentValue(graph, "crossword:across:4"), "MIDN?");
  assert.equal(currentValue(graph, "crossword:down:3"), "E??");
  assert.equal(
    completedCrosswordFill(graph, "crossword:across:4", 5),
    undefined,
  );
  assert.equal(propositionCommitment(graph.versions[0]!), "tentative");

  graph = apply(graph, [], 2, "agent_b").graph;
  graph = apply(graph, [], 3, "agent_a").graph;
  const later = snapshotThroughTurn(graph, 3);
  const memory = reasoningStateUserMessage(later);
  assert.match(memory, /MIDN\?/);
  assert.match(memory, /E\?\?/);
  assert.match(memory, /\[tentative\]/);
  assert.equal(completedCrosswordFill(later, "crossword:across:4", 5), undefined);
  console.log("✓ Case A — partial crossword constraints persist two turns later");
}

// --- Case B: genuine empty mutation is valid ---
{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Can you check Down 7 against the crossings?",
      mutations: [],
    }),
    "agent_b",
    1,
  );
  const recovered = recoverParsedTurn(parsed, {
    problem: crosswordProblem,
    adapter: crosswordReasoningAdapter,
    graph,
  });
  assert.equal(recovered.protocolFailure, undefined);
  assert.notEqual(recovered.structuredReasoningMissing, true);
  const applied = apply(graph, recovered.mutations as ReasoningMutation[], 1, "agent_b", {
    extraDiagnostics: recovered.structuredReasoningMissing
      ? ["structured_reasoning_missing"]
      : undefined,
  });
  assert.equal(applied.events.length, 0);
  assert.equal(applied.graph.versions.length, 0);
  assert.equal(
    applied.graph.events.filter((event) => !event.accepted).length,
    0,
  );
  const coverage = coverageForTurn(applied.graph, 1, {
    turnIndex: 1,
    content: parsed.message,
  });
  assert.equal(coverage.persistentChange, false);
  assert.equal(coverage.persistenceReview, false);
  assert.equal(looksLikePersistenceReview(parsed.message), false);
  console.log("✓ Case B — valid mutations=[] is not a rejection");
}

{
  const malformed = parseAgentTurn("Just thinking out loud about MIDAS.", "agent_a", 1);
  assert.ok(malformed.protocolFailure);
  const applied = apply(
    seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter),
    [],
    1,
    "agent_a",
    { protocolFailure: malformed.protocolFailure },
  );
  assert.equal(applied.events[0]?.accepted, false);
  assert.equal(applied.events[0]?.mutation.type, "protocol_failure");
  console.log("✓ malformed envelope is still a protocol failure");
}

// --- Case C: material crossing bases preserved ---
{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:1", content: "GEM" },
  ], 1).graph;
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:2", content: "YTD" },
  ], 1, "agent_b").graph;
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:5", content: "INC" },
  ], 2).graph;
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:6", content: "ALL" },
  ], 2, "agent_b").graph;
  const derived = apply(
    graph,
    [
      {
        type: "SET",
        subjectId: "crossword:across:4",
        content: "MIDAS",
        basis: [
          "crossword:down:1@v1",
          "crossword:down:2@v1",
          "crossword:down:5@v1",
          "crossword:down:6@v1",
        ],
      },
    ],
    3,
  );
  assert.equal(derived.events[0]?.accepted, true);
  assert.equal(derived.events[0]?.basisVersionIds?.length, 4);
  assert.equal(currentValue(derived.graph, "crossword:across:4"), "MIDAS");
  assert.equal(
    completedCrosswordFill(derived.graph, "crossword:across:4", 5),
    "MIDAS",
  );
  console.log("✓ Case C — material crossing basis is preserved");
}

// --- Case D: weak basis is not required ---
{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:6", content: "NIL" },
  ]).graph;
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:down:1", content: "GEM" },
  ], 1, "agent_b").graph;
  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:down:6",
        before: "NIL",
        after: "ALL",
      },
    ],
    2,
  );
  assert.equal(revised.events[0]?.accepted, true);
  assert.deepEqual(revised.events[0]?.basisVersionIds, undefined);
  assert.equal(currentValue(revised.graph, "crossword:down:6"), "ALL");
  console.log("✓ Case D — basis=[] is valid for a clue-driven revision");
}

// --- Case E: moral new consideration, not question or stance ---
{
  const problem = moralProblem();
  const adapter = taskReasoningAdapterFor(problem);
  let graph = seedGraphForProblem(problem, adapter);
  assert.equal(graph.subjects.length, 0);
  assert.match(
    formatReasoningState(graph),
    /No persistent considerations have been established yet/,
  );
  assert.doesNotMatch(formatReasoningState(graph), /\b(QUESTION|STANCE|TENSION):/);
  graph = applyMoral(graph, [
    {
      type: "SET",
      subjectId: "moral:directness_vs_sensitivity",
      subjectLabel: "Directness vs sensitivity",
      content: "Be direct enough to stop the harm.",
    },
  ]).graph;
  const stanceDump = applyMoral(graph, [
    {
      type: "SET",
      subjectId: "moral:stance",
      content: "Set a clear boundary without public humiliation.",
    },
  ], 1, "agent_b");
  assert.equal(stanceDump.events[0]?.accepted, false);
  assert.match(
    stanceDump.events[0]?.errors.join(" ") ?? "",
    /Overall\/final stance is not a consideration/,
  );
  assert.equal(
    stanceDump.graph.subjects.some((subject) => subject.id === "moral:stance"),
    false,
  );
  const questionDump = applyMoral(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:question",
        content:
          "Stakeholders: student, classmate, school community; early staff involvement as a safety net.",
      },
    ],
    2,
  );
  assert.equal(questionDump.events[0]?.accepted, false);
  assert.match(questionDump.events[0]?.errors.join(" ") ?? "", /task context, not a consideration/);
  const stakeholders = applyMoral(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:stakeholders",
        content:
          "Student, classmate, and school community; early staff involvement is a safety net.",
      },
    ],
    2,
  );
  assert.equal(stakeholders.events[0]?.accepted, true);
  assert.match(
    currentValue(stakeholders.graph, "moral:stakeholders") ?? "",
    /student/i,
  );
  assert.equal(currentValue(stakeholders.graph, "moral:question"), undefined);
  assert.equal(currentValue(stakeholders.graph, "moral:stance"), undefined);
  assert.match(
    formatReasoningState(stakeholders.graph),
    /CONSIDERATION: Stakeholders/,
  );
  console.log("✓ Case E — stakeholder analysis gets its own consideration, not question or stance");
}

// --- Case F: tightening a consideration must be committable ---
{
  const problem = moralProblem();
  const adapter = taskReasoningAdapterFor(problem);
  let graph = seedGraphForProblem(problem, adapter);
  graph = applyMoral(graph, [
    {
      type: "SET",
      subjectId: "moral:assertiveness_vs_aggression",
      content: "Do not use business control as a weapon.",
    },
  ]).graph;
  const tightened = applyMoral(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "moral:assertiveness_vs_aggression",
        before: "Do not use business control as a weapon.",
        after:
          "Do not use business control as a weapon; consider valuation/terms and possible ownership transfer.",
      },
    ],
    2,
    "agent_b",
  );
  assert.equal(tightened.events[0]?.accepted, true);
  assert.match(
    currentValue(tightened.graph, "moral:assertiveness_vs_aggression") ?? "",
    /ownership transfer/,
  );
  const empty = applyMoral(graph, [], 2, "agent_b");
  const review = coverageForTurn(empty.graph, 2, {
    turnIndex: 2,
    content:
      "I would tighten the position: do not use business control as a weapon; consider valuation/terms and possible ownership transfer.",
  });
  assert.equal(review.persistentChange, false);
  assert.equal(review.persistenceReview, true);
  console.log("✓ Case F — tightening a consideration can enter canonical state; missing it is reviewable");
}

{
  const message: ConversationMessage = {
    id: "msg-1-agent_a",
    agentId: "agent_a",
    sender: "agent_a",
    recipient: "agent_b",
    role: "assistant",
    content: "Across 4 pattern is MIDN?",
    timestamp: new Date().toISOString(),
    turnIndex: 1,
  };
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:across:4", content: "MIDN?" },
  ]).graph;
  const serialized = reasoningStateUserMessage(snapshotThroughTurn(graph, 1));
  const previous = partnerMessageUserMessage(utteranceFromMessage(message));
  assert.match(serialized, /CURRENT SHARED REASONING STATE/);
  assert.match(serialized, /MIDN\?/);
  assert.match(previous, /MOST RECENT PARTNER MESSAGE/);
  assert.match(previous, /Agent A/);
  assert.equal(agentLabel("agent_a"), "Agent A");
  assert.match(formatReasoningState(graph), /\[tentative\]/);
  console.log("✓ memory serializers are the prompt-building graph + previous utterance");
}

console.log("ok — working-state persistence cases A–F");
