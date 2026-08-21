/**
 * Crossword SET/REVISE validation and versioned fills.
 *
 * Run: npm run test:committed-graph
 */
import assert from "node:assert/strict";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningMutations,
  currentValue,
  seedGraphForProblem,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";

const crosswordProblem: Problem = {
  id: "committed-crossword",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Committed graph",
  text: "test",
  crossword: {
    width: 5,
    height: 1,
    difficulty: "test",
    category: "test",
    grid: ["....."],
    solution: ["EMAIL"],
    source: "crosswordbench",
    sourceId: 1,
    clues: [
      {
        number: 5,
        direction: "across",
        clue: "Enrollment record",
        row: 0,
        col: 0,
        length: 5,
        answer: "EMAIL",
      },
    ],
  },
};

function apply(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  turn = 1,
  actor: "agent_a" | "agent_b" = "agent_a",
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
  });
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const created = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:5", content: "EMAIL" },
  ]);
  assert.equal(created.events[0]?.accepted, true);
  assert.equal(currentValue(created.graph, "crossword:across:5"), "EMAIL");
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const normalized = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:5", content: "email" },
  ]);
  assert.equal(normalized.events[0]?.accepted, true);
  assert.equal(currentValue(normalized.graph, "crossword:across:5"), "EMAIL");
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const bad = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:5", content: "NO" },
  ]);
  assert.equal(bad.events[0]?.accepted, false);
  assert.equal(currentValue(bad.graph, "crossword:across:5"), undefined);
}

{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:across:5", content: "EMAIL" },
  ]).graph;
  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:across:5",
        before: "EMAIL",
        after: "ENROL",
      },
    ],
    2,
    "agent_b",
  );
  assert.equal(revised.events[0]?.accepted, true);
  assert.equal(currentValue(revised.graph, "crossword:across:5"), "ENROL");
  assert.equal(
    revised.graph.versions.find((version) => version.content === "EMAIL")?.status,
    "superseded",
  );
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const unknown = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:99", content: "EMAIL" },
  ]);
  assert.equal(unknown.events[0]?.accepted, false);
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const pattern = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:5", content: "EMAI?" },
  ]);
  assert.equal(pattern.events[0]?.accepted, true);
  assert.equal(currentValue(pattern.graph, "crossword:across:5"), "EMAI?");
}

{
  const seeded = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const padded = apply(seeded, [
    { type: "SET", subjectId: "crossword:across:5", content: "EM?" },
  ]);
  assert.equal(padded.events[0]?.accepted, true);
  assert.equal(currentValue(padded.graph, "crossword:across:5"), "EM???");
}

{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "crossword:across:5", content: "email" },
  ]).graph;
  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:across:5",
        before: "email",
        after: "enrol",
      },
    ],
    2,
  );
  assert.equal(revised.events[0]?.accepted, true);
  assert.equal(currentValue(revised.graph, "crossword:across:5"), "ENROL");
}

console.log("ok — committed crossword SET/REVISE validation");
