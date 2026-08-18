import assert from "node:assert/strict";
import {
  applyReasoningIntents,
  deriveGenericReadiness,
  deriveIssueConvergenceStates,
  deriveReasoningProgress,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";
import {
  crosswordCandidateIdentity,
  crosswordReasoningAdapter,
  deriveCrosswordConflicts,
  deriveCrosswordForcedLetters,
} from "../src/problems/adapters/crosswordAdapter";
import type { Problem } from "../src/problems/types";

function apply(
  graph: ReasoningGraph,
  intents: ReasoningIntent[],
  actor: "agent_a" | "agent_b",
  turn: number,
) {
  return applyReasoningIntents(graph, intents, {
    actor,
    turnIndex: turn,
    messageId: `m-${turn}-${actor}`,
  }).graph;
}

function settleSingleIssue(subjectId = "task:root") {
  let graph = emptyReasoningGraph([
    {
      id: subjectId,
      kind: "task_defined",
      label: "Root issue",
      source: "task",
    },
  ]);
  graph = apply(
    graph,
    [{ action: "create", nodeType: "claim", text: "Resolution", subjectId }],
    "agent_a",
    1,
  );
  graph = apply(
    graph,
    [{ action: "accept", targetId: "C1" }],
    "agent_a",
    2,
  );
  graph = apply(
    graph,
    [{ action: "accept", targetId: "C1" }],
    "agent_b",
    3,
  );
  return graph;
}

{
  const graph = settleSingleIssue();
  const states = deriveIssueConvergenceStates(graph);
  assert.equal(states.length, 1);
  assert.deepEqual(states[0]?.liveClaimIds, ["C1"]);
  assert.equal(states[0]?.settledClaimId, "C1");
  assert.deepEqual(deriveGenericReadiness(states), {
    allRequiredIssuesSettled: true,
    unresolvedIssueCount: 0,
    unresolvedConflictCount: 0,
  });
  const unrelatedAlternative = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Untriggered replacement",
        subjectId: "task:root",
      },
    ],
    "agent_b",
    4,
  );
  assert.equal(unrelatedAlternative.nodes.length, graph.nodes.length);
  assert.match(
    unrelatedAlternative.events.at(-1)?.errors.join(" ") ?? "",
    /is settled/,
  );

  const challenged = apply(
    graph,
    [{ action: "challenge", targetId: "C1", reason: "counterexample" }],
    "agent_b",
    4,
  );
  const reopened = deriveIssueConvergenceStates(challenged)[0]!;
  assert.equal(reopened.reopened, true);
  assert.equal(reopened.unresolved, true);
  assert.equal(reopened.contradictory, true);
  const challengedThenReplaced = apply(
    graph,
    [
      { action: "challenge", targetId: "C1", reason: "counterexample" },
      {
        action: "create",
        nodeType: "claim",
        text: "Triggered alternative",
        subjectId: "task:root",
      },
    ],
    "agent_b",
    4,
  );
  assert.equal(challengedThenReplaced.nodes.some((node) => node.id === "C2"), true);

  const withEvidence = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "A newly observed counterexample",
        localId: "counterexample",
      },
      {
        action: "challenge",
        sourceNodeId: "counterexample",
        targetNodeId: "C1",
      },
    ],
    "agent_b",
    4,
  );
  assert.equal(deriveIssueConvergenceStates(withEvidence)[0]?.reopened, true);

  const taskReopened = deriveIssueConvergenceStates(graph, {
    conflicts: [
      {
        issueId: "task:root",
        nodeIds: ["C1"],
        source: "task_constraint",
        description: "deterministic constraint failed",
      },
    ],
  })[0]!;
  assert.equal(taskReopened.reopened, true);
  assert.equal(taskReopened.contradictory, true);
}

{
  let graph = emptyReasoningGraph();
  graph = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "issue",
        text: "Can the lemma be established?",
        localId: "lemma",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Yes, by induction",
        subjectId: "lemma",
      },
    ],
    "agent_a",
    1,
  );
  assert.equal(deriveIssueConvergenceStates(graph)[0]?.issueId, "I1");
  const progress = deriveReasoningProgress(
    graph,
    deriveIssueConvergenceStates(graph),
    { currentTurn: 5, stallThresholdTurns: 3 },
  );
  assert.equal(progress.unresolvedIssueCount, 1);
  assert.equal(progress.likelyStalled, true);
  assert.ok(progress.reasons.length > 0);
}

const crosswordProblem: Problem = {
  id: "crossword-adapter-test",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Adapter test",
  text: "test",
  crossword: {
    width: 2,
    height: 2,
    difficulty: "test",
    category: "test",
    grid: ["..", ".#"],
    solution: ["AB", "C#"],
    source: "crosswordbench",
    sourceId: 1,
    clues: [
      {
        number: 1,
        direction: "across",
        clue: "Across prompt",
        row: 0,
        col: 0,
        length: 2,
        answer: "AB",
      },
      {
        number: 1,
        direction: "down",
        clue: "Down prompt",
        row: 0,
        col: 0,
        length: 2,
        answer: "AC",
      },
    ],
  },
};

{
  const issues = crosswordReasoningAdapter.getInitialIssues(crosswordProblem);
  assert.equal(issues.length, crosswordProblem.crossword?.clues.length);
  assert.equal(new Set(issues.map((issue) => issue.id)).size, issues.length);
  assert.deepEqual(issues[0]?.metadata, {
    direction: "across",
    number: 1,
    row: 0,
    col: 0,
    length: 2,
  });
  assert.equal(JSON.stringify(issues).includes('"answer"'), false);
  assert.equal(
    crosswordCandidateIdentity("crossword:across:1", "A-B"),
    "crossword:across:1:AB",
  );

  let graph = emptyReasoningGraph(issues);
  graph = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = AB",
        subjectId: "crossword:across:1",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Down 1 = AC",
        subjectId: "crossword:down:1",
      },
    ],
    "agent_a",
    1,
  );
  for (const actor of ["agent_a", "agent_b"] as const) {
    graph = apply(
      graph,
      [
        { action: "accept", targetId: "C1" },
        { action: "accept", targetId: "C2" },
      ],
      actor,
      actor === "agent_a" ? 2 : 3,
    );
  }
  const conflicts = deriveCrosswordConflicts(crosswordProblem, graph);
  assert.equal(conflicts.length, 0);
  assert.equal(deriveCrosswordForcedLetters(crosswordProblem, graph).length, 2);
  const states = deriveIssueConvergenceStates(graph, { conflicts });
  assert.equal(states.every((state) => Boolean(state.settledClaimId)), true);
  const generic = deriveGenericReadiness(states);
  const readiness = crosswordReasoningAdapter.deriveProblemReadiness!(
    crosswordProblem,
    states,
    graph,
    generic,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.details?.completeGrid, true);

  let conflicting = emptyReasoningGraph(issues);
  conflicting = apply(
    conflicting,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = AB",
        subjectId: "crossword:across:1",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Down 1 = CB",
        subjectId: "crossword:down:1",
      },
    ],
    "agent_a",
    1,
  );
  for (const actor of ["agent_a", "agent_b"] as const) {
    conflicting = apply(
      conflicting,
      [
        { action: "accept", targetId: "C1" },
        { action: "accept", targetId: "C2" },
      ],
      actor,
      actor === "agent_a" ? 2 : 3,
    );
  }
  const crossingConflicts = deriveCrosswordConflicts(
    crosswordProblem,
    conflicting,
  );
  assert.equal(crossingConflicts.length, 2);
  assert.equal(
    conflicting.nodes.every(
      (node) => node.status !== "rejected" && node.status !== "superseded",
    ),
    true,
  );
  const reopened = deriveIssueConvergenceStates(conflicting, {
    conflicts: crossingConflicts,
  });
  assert.equal(reopened.every((state) => state.reopened), true);
  assert.equal(
    reopened.every((state) =>
      state.liveClaimIds.some(
        (id) => state.claimCompatibility?.[id] === "incompatible",
      ),
    ),
    true,
  );
}

console.log("ok — generic convergence and crossword task adapter");
