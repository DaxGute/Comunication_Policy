/**
 * Solver-state fingerprint and progress from canonical SET/REVISE/REMOVE.
 *
 * Run: npm run test:solver-progress
 */
import assert from "node:assert/strict";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningMutations,
  deriveIssueConvergenceStates,
  emptySolverProgressState,
  reduceSolverProgress,
  seedGraphForProblem,
  solverStateFingerprint,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";

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
        clue: "Name",
        row: 0,
        col: 0,
        length: 4,
        answer: "DAVE",
      },
      {
        number: 1,
        direction: "down",
        clue: "Bird",
        row: 0,
        col: 0,
        length: 4,
        answer: "DOVE",
      },
    ],
  },
};

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
    subjectsAreClosed: true,
    resolveSubject: (raw) =>
      crosswordReasoningAdapter.resolveSubject?.(mini, raw) ?? {},
    validateContent: (subjectId, content) =>
      crosswordReasoningAdapter.validateContent?.(mini, subjectId, content) ?? {
        ok: true,
      },
  });
}

function fingerprint(graph: ReasoningGraph) {
  const issueStates = deriveIssueConvergenceStates(graph, {
    conflicts: crosswordReasoningAdapter.deriveConflicts?.(mini, graph) ?? [],
  });
  return solverStateFingerprint({
    problem: mini,
    adapter: crosswordReasoningAdapter,
    graph,
    issueStates,
  });
}

{
  let graph = seedGraphForProblem(mini, crosswordReasoningAdapter);
  const emptyFp = fingerprint(graph);
  const set = apply(
    graph,
    [{ type: "SET", subjectId: "crossword:across:6", content: "DAVE" }],
    "agent_a",
    1,
  );
  graph = set.graph;
  const afterSet = fingerprint(graph);
  assert.notEqual(afterSet, emptyFp);

  const noop = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:across:6",
        before: "DAVE",
        after: "DAVE",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(noop.events[0]?.accepted, false);
  assert.equal(fingerprint(noop.graph), afterSet);

  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:across:6",
        before: "DAVE",
        after: "DOVE",
      },
    ],
    "agent_b",
    3,
  );
  assert.notEqual(fingerprint(revised.graph), afterSet);
}

{
  let graph = seedGraphForProblem(mini, crosswordReasoningAdapter);
  let state = emptySolverProgressState();
  const first = apply(
    graph,
    [{ type: "SET", subjectId: "crossword:across:6", content: "DAVE" }],
    "agent_a",
    1,
  );
  graph = first.graph;
  let issueStates = deriveIssueConvergenceStates(graph, {
    conflicts: crosswordReasoningAdapter.deriveConflicts?.(mini, graph) ?? [],
  });
  const progressed = reduceSolverProgress(state, {
    turnIndex: 1,
    maxTurns: 8,
    graph,
    events: first.events,
    issueStates,
    fingerprint: fingerprint(graph),
    substantive: true,
    structuredReasoningMissing: false,
  });
  assert.equal(progressed.stateChanged, true);
  assert.equal(progressed.state.counters.meaningfulStateTransitionCount, 1);
  state = progressed.state;

  const silent = apply(graph, [], "agent_b", 2);
  issueStates = deriveIssueConvergenceStates(silent.graph, {
    conflicts:
      crosswordReasoningAdapter.deriveConflicts?.(mini, silent.graph) ?? [],
  });
  const stalled = reduceSolverProgress(state, {
    turnIndex: 2,
    maxTurns: 8,
    graph: silent.graph,
    events: silent.events,
    issueStates,
    fingerprint: fingerprint(silent.graph),
    substantive: false,
    structuredReasoningMissing: false,
  });
  assert.equal(stalled.stateChanged, false);
}

console.log("ok — solver progress fingerprints canonical SET/REVISE/REMOVE state");
