import assert from "node:assert/strict";
import {
  applyReasoningMutations,
  deriveGenericReadiness,
  deriveIssueConvergenceStates,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";
import {
  crosswordReasoningAdapter,
  deriveCrosswordConflicts,
} from "../src/problems/adapters/crosswordAdapter";
import type { Problem } from "../src/problems/types";

function apply(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  actor: "agent_a" | "agent_b",
  turn: number,
) {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `m-${turn}-${actor}`,
  }).graph;
}

{
  let graph = emptyReasoningGraph([
    {
      id: "task:root",
      kind: "task_defined",
      label: "Root issue",
      source: "task",
    },
  ]);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: "task:root", content: "Resolution" }],
    "agent_a",
    1,
  );
  const states = deriveIssueConvergenceStates(graph);
  assert.equal(states.length, 1);
  assert.equal(states[0]?.liveClaimIds.length, 1);
  assert.equal(states[0]?.unresolved, false);
  assert.deepEqual(deriveGenericReadiness(states), {
    allRequiredIssuesSettled: true,
    unresolvedIssueCount: 0,
    unresolvedConflictCount: 0,
  });
}

{
  const crossword: Problem = {
    id: "conv-crossword",
    category: "crossword",
    kind: "crossword_puzzle",
    title: "Conflicts",
    text: "test",
    crossword: {
      width: 2,
      height: 2,
      difficulty: "test",
      category: "test",
      grid: ["..", ".."],
      solution: ["AB", "AC"],
      source: "crosswordbench",
      sourceId: 1,
      clues: [
        {
          number: 1,
          direction: "across",
          clue: "A",
          row: 0,
          col: 0,
          length: 2,
          answer: "AB",
        },
        {
          number: 1,
          direction: "down",
          clue: "D",
          row: 0,
          col: 0,
          length: 2,
          answer: "AC",
        },
      ],
    },
  };
  let graph = emptyReasoningGraph(
    crosswordReasoningAdapter.getInitialIssues(crossword),
  );
  graph = apply(
    graph,
    [{ type: "SET", subjectId: "crossword:across:1", content: "AB" }],
    "agent_a",
    1,
  );
  graph = apply(
    graph,
    [{ type: "SET", subjectId: "crossword:down:1", content: "XY" }],
    "agent_b",
    2,
  );
  const conflicts = deriveCrosswordConflicts(crossword, graph);
  assert.ok(conflicts.length > 0);
  const states = deriveIssueConvergenceStates(graph, { conflicts });
  assert.ok(states.some((state) => state.contradictory));
}

console.log("ok — convergence from canonical subject state");
