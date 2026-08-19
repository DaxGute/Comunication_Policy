/**
 * Committed-graph mutation rules: expensive idea creation, validation,
 * revision ancestry, and final-answer reconstruction.
 *
 * Run: npm run test:committed-graph
 */
import assert from "node:assert/strict";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningIntents,
  checkGraphInvariants,
  emptyReasoningGraph,
  isParaphrase,
  maxIdeasCreatedOnOneSubjectInOneTurn,
  seedGraphForProblem,
  validateCommittedProposition,
  type ReasoningGraph,
  type ReasoningIntent,
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
  intents: ReasoningIntent[],
  turn = 1,
  actor: "agent_a" | "agent_b" = "agent_a",
  extras: {
    finalAnswer?: { text?: string; supportingNodeIds: string[] };
  } = {},
) {
  const adapter = crosswordReasoningAdapter;
  return applyReasoningIntents(graph, intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    finalAnswer: extras.finalAnswer,
    candidateIdentity: (node) => adapter.candidateIdentity?.(crosswordProblem, node),
    validateCandidate: (node) =>
      adapter.validateCandidate?.(crosswordProblem, node) ?? { ok: true },
    reconcileFinalAnswer: (text, supportingNodeIds, liveGraph) =>
      adapter.reconcileFinalAnswer?.(
        crosswordProblem,
        liveGraph,
        text,
        supportingNodeIds,
      ) ?? { supportingNodeIds, errors: [] },
  });
}

{
  assert.equal(validateCommittedProposition("", "claim").ok, false);
  assert.equal(
    validateCommittedProposition("What about Across 5?", "claim").ok,
    false,
  );
  assert.equal(
    validateCommittedProposition("Let me think about Across 5", "claim").ok,
    false,
  );
  assert.equal(
    validateCommittedProposition("Could be EMAIL, ENROL, or EMBER", "claim").ok,
    false,
  );
  assert.equal(
    validateCommittedProposition("{kind: claim, value: undefined}", "claim").ok,
    false,
  );
  assert.equal(
    validateCommittedProposition("Across 5 = EMAIL", "claim").ok,
    true,
  );
  assert.equal(
    isParaphrase("Across 5 = EMAIL", "across 5 is email"),
    true,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const first = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = ENROL",
      subjectId: "crossword:across:5",
      metadata: { answer: "ENROL" },
    },
  ]);
  const created = first.events.filter(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      event.operation.type === "create" &&
      event.operation.node.type === "claim",
  );
  assert.equal(created.length, 1);
  assert.equal(
    first.events.some((event) =>
      event.errors.some((error) => /already committed a candidate/.test(error)),
    ),
    true,
  );
  assert.equal(maxIdeasCreatedOnOneSubjectInOneTurn(first.graph), 1);
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const first = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
  ]);
  const second = apply(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 5 = ENROL",
        subjectId: "crossword:across:5",
        metadata: { answer: "ENROL" },
      },
    ],
    2,
    "agent_b",
  );
  const live = second.graph.nodes.filter(
    (node) =>
      node.type === "claim" &&
      node.status !== "superseded" &&
      node.status !== "rejected",
  );
  assert.equal(live.length, 1);
  assert.match(live[0]?.text ?? "", /ENROL/);
  assert.equal(
    second.graph.edges?.some(
      (edge) =>
        edge.type === "revises" &&
        edge.targetNodeId === "C1" &&
        edge.sourceNodeId === live[0]?.id,
    ),
    true,
  );
  assert.equal(
    checkGraphInvariants(second.graph).some(
      (item) => item.code === "competing_live_ideas",
    ),
    false,
  );
  assert.equal(
    checkGraphInvariants(second.graph).some(
      (item) => item.code === "revision_missing_ancestry",
    ),
    false,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const rejected = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Let me consider EMAIL or ENROL or EMBER",
      subjectId: "crossword:across:5",
    },
  ]);
  assert.equal(
    rejected.events.some(
      (event) =>
        !event.accepted &&
        event.errors.some((error) => /alternatives|process narration/.test(error)),
    ),
    true,
  );
  assert.equal(
    rejected.graph.nodes.some((node) => node.type === "claim"),
    false,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const duplicate = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
  ]);
  const again = apply(
    duplicate.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 5 is EMAIL",
        subjectId: "crossword:across:5",
        metadata: { answer: "EMAIL" },
      },
    ],
    2,
  );
  assert.equal(again.events.at(-1)?.stateChanged, false);
  assert.equal(
    again.graph.nodes.filter((node) => node.type === "claim").length,
    1,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const orphan = apply(graph, [
    {
      action: "create",
      nodeType: "evidence",
      text: "Down 2 requires R in the crossing square",
      subjectId: "crossword:across:5",
      metadata: { evidenceOrigin: "agent" },
    },
  ]);
  assert.equal(
    checkGraphInvariants(orphan.graph).some(
      (item) => item.code === "orphaned_evidence",
    ),
    true,
  );

  const claimed = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
  ]);
  const attached = apply(
    claimed.graph,
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "The clue supports EMAIL",
        subjectId: "crossword:across:5",
        metadata: { evidenceOrigin: "agent" },
      },
    ],
    2,
  );
  assert.equal(
    checkGraphInvariants(attached.graph).some(
      (item) => item.code === "orphaned_evidence",
    ),
    false,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const claimed = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
  ]);
  const grounded = apply(
    claimed.graph,
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "The clue supports EMAIL",
        subjectId: "crossword:across:5",
        localId: "ev",
        metadata: { evidenceOrigin: "agent" },
      },
      {
        action: "support",
        sourceNodeId: "ev",
        targetId: "C1",
      },
    ],
    2,
  );
  assert.equal(
    grounded.graph.nodes.some(
      (node) => node.type === "evidence" && node.evidenceOrigin === "agent",
    ),
    true,
  );
}

{
  const graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const claimed = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 5 = EMAIL",
      subjectId: "crossword:across:5",
      metadata: { answer: "EMAIL" },
    },
  ]);
  const missingAncestry = apply(
    claimed.graph,
    [],
    2,
    "agent_a",
    {
      finalAnswer: {
        text: "Across\n5: ENROL",
        supportingNodeIds: [],
      },
    },
  );
  assert.equal(missingAncestry.finalAnswerSupport?.errors.some((error) =>
    /differs from surviving graph state/.test(error),
  ), true);
  assert.equal(
    checkGraphInvariants(missingAncestry.graph).some(
      (item) => item.code === "final_differs_from_graph",
    ),
    true,
  );

  const aligned = apply(
    claimed.graph,
    [],
    2,
    "agent_a",
    {
      finalAnswer: {
        text: "Across\n5: EMAIL",
        supportingNodeIds: [],
      },
    },
  );
  assert.deepEqual(aligned.finalAnswerSupport?.errors, []);
  assert.ok(
    (aligned.finalAnswerSupport?.supportingNodeIds.length ?? 0) > 0,
  );
  const finalNode = aligned.graph.nodes.find((node) => node.type === "final_answer");
  assert.equal(
    aligned.graph.edges?.some(
      (edge) =>
        edge.type === "supports" &&
        edge.targetNodeId === "__final_answer__" &&
        finalNode &&
        finalNode.type === "final_answer" &&
        finalNode.supportingNodeIds.includes(edge.sourceNodeId),
    ),
    true,
  );
}

{
  const empty = emptyReasoningGraph();
  const none = applyReasoningIntents(
    empty,
    [],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg-1",
      finalAnswer: { text: "42", supportingNodeIds: [] },
    },
  );
  assert.equal(
    none.finalAnswerSupport?.errors.some((error) => /no graph ancestry/.test(error)),
    true,
  );
  assert.equal(
    checkGraphInvariants(none.graph).some(
      (item) => item.code === "final_without_ancestry",
    ),
    true,
  );
}

{
  const moral: Problem = {
    id: "committed-moral",
    category: "moral_philosophical",
    kind: "moral",
    title: "Moral",
    text: "A scenario.",
    moral: {
      title: "Autonomy",
      description: "A diagnosis is hidden.",
      issues: ["autonomy"],
      question: "Should it be disclosed?",
      source: "reddit_ethics",
      sourceIndex: 1,
    },
  };
  const adapter = taskReasoningAdapterFor(moral);
  const graph = seedGraphForProblem(moral, adapter);
  const first = applyReasoningIntents(
    graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Hiding the diagnosis infringes autonomy",
        subjectId: "moral_philosophical:root",
      },
    ],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg-1",
    },
  );
  const second = applyReasoningIntents(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Non-disclosure may still prevent harm",
        subjectId: "moral_philosophical:root",
      },
    ],
    {
      actor: "agent_b",
      turnIndex: 2,
      messageId: "msg-2",
    },
  );
  assert.equal(
    second.graph.nodes.filter((node) => node.type === "claim").length,
    2,
  );
  const sameTurn = applyReasoningIntents(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Non-disclosure may still prevent harm",
        subjectId: "moral_philosophical:root",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Honesty is independently required",
        subjectId: "moral_philosophical:root",
      },
    ],
    {
      actor: "agent_b",
      turnIndex: 2,
      messageId: "msg-2b",
    },
  );
  const created = sameTurn.events.filter(
    (event) =>
      event.accepted &&
      event.operation.type === "create" &&
      event.operation.node.type === "claim",
  );
  assert.equal(created.length, 1);
}

console.log(
  "ok — committed graph: expensive ideas, validation, ancestry, final-answer reconstruction",
);
