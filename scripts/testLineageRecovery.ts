/**
 * Subject identity, Aug 19 SET/REVISE recovery, and versioned layout.
 *
 * Run: npm run test:lineage
 */
import assert from "node:assert/strict";
import { crosswordReasoningAdapter } from "../src/problems/adapters/crosswordAdapter";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningMutations,
  currentValue,
  formatReasoningState,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  materializeGraph,
  parseReasoningEvent,
  seedGraphForProblem,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";

const crosswordProblem: Problem = {
  id: "lineage-crossword",
  category: "crossword",
  kind: "crossword_puzzle",
  title: "Lineage test",
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
        clue: '"Two Years Before the Mast" author',
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

function apply(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  actor: "agent_a" | "agent_b" = "agent_a",
  turn = 1,
) {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    subjectsAreClosed: true,
    resolveSubject: (raw) =>
      crosswordReasoningAdapter.resolveSubject?.(crosswordProblem, raw) ?? {},
    validateContent: (subjectId, content) =>
      crosswordReasoningAdapter.validateContent?.(
        crosswordProblem,
        subjectId,
        content,
      ) ?? { ok: true },
  }).graph;
}

{
  assert.equal(
    crosswordReasoningAdapter.resolveSubject?.(crosswordProblem, "1-across")?.id,
    "crossword:across:1",
  );
  assert.equal(
    crosswordReasoningAdapter.resolveSubject?.(crosswordProblem, "down 1")?.id,
    "crossword:down:1",
  );
}

{
  let graph = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  graph = apply(graph, [
    { type: "SET", subjectId: "1-across", content: "AB" },
  ]);
  assert.equal(currentValue(graph, "crossword:across:1"), "AB");
  graph = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: "crossword:across:1",
        before: "AB",
        after: "CB",
      },
    ],
    "agent_b",
    2,
  );
  const serialized = formatReasoningState(graph);
  assert.match(serialized, /crossword:across:1/);
  assert.match(serialized, /CB/);
  assert.match(serialized, /Agent A/);
  const layout = layoutReasoningGraph(graph);
  assert.ok(layout.lanes.some((lane) => lane.subjectId === "crossword:across:1"));
  assert.ok(layout.nodes.every((node) => node.kind === "version"));
  assert.ok(layout.edges.some((edge) => edge.kind === "revises"));
}

{
  const events = [
    parseReasoningEvent({
      action: "SET",
      subjectId: "crossword:across:1",
      after: "AB",
      agent: "agent_a",
      turn: 1,
      accepted: true,
    }),
    parseReasoningEvent({
      action: "REVISE",
      subjectId: "crossword:across:1",
      before: "AB",
      after: "CB",
      agent: "agent_b",
      turn: 2,
      accepted: true,
    }),
  ].filter((event): event is NonNullable<typeof event> => Boolean(event));
  const seed = seedGraphForProblem(crosswordProblem, crosswordReasoningAdapter);
  const replayed = materializeGraph(events, seed.subjects);
  const hydrated = hydrateReasoningGraph({
    reasoningSchemaVersion: 2,
    reasoningSubjects: seed.subjects,
    reasoningEvents: events,
  });
  assert.equal(currentValue(replayed, "crossword:across:1"), "CB");
  assert.equal(currentValue(hydrated, "crossword:across:1"), "CB");
  assert.equal(
    replayed.versions.find((version) => version.content === "AB")?.status,
    "superseded",
  );
}

{
  const moral: Problem = {
    id: "moral-subjects",
    category: "moral_philosophical",
    kind: "moral",
    title: "Moral subjects",
    text: "What should be done?",
    moral: {
      title: "Moral subjects",
      description: "A dilemma.",
      issues: ["Responsibility", "Intent", "Foreseeability"],
      question: "What should be done?",
      source: "reddit_ethics",
      sourceIndex: 0,
    },
  };
  const proof: Problem = {
    id: "proof-subjects",
    category: "proof",
    kind: "proof",
    title: "Proof subjects",
    text: "Prove the claim.",
    proof: {
      question: "Prove the claim.",
      referenceProof: "QED",
      source: "proofsolver",
      sourceIndex: 0,
    },
  };
  const moralIds = seedGraphForProblem(
    moral,
    taskReasoningAdapterFor(moral),
  ).subjects.map((subject) => subject.id);
  const proofIds = seedGraphForProblem(
    proof,
    taskReasoningAdapterFor(proof),
  ).subjects.map((subject) => subject.id);
  assert.equal(moralIds.length, 0);
  assert.ok(!moralIds.includes("moral:question"));
  assert.ok(!moralIds.includes("moral:stance"));
  assert.equal(
    seedGraphForProblem(
      moral,
      taskReasoningAdapterFor(moral, {
        moralSubjectSeeding: "explicit-task-seeded",
      }),
    ).subjects.length,
    0,
  );
  assert.equal(
    seedGraphForProblem(
      moral,
      taskReasoningAdapterFor(moral, { moralSubjectSeeding: "none" }),
    ).subjects.length,
    0,
  );
  assert.ok(proofIds.includes("proof:goal"));
  assert.ok(proofIds.includes("proof:lemma:1"));
  assert.ok(proofIds.includes("proof:assumption:1"));
  assert.ok(proofIds.includes("proof:conclusion"));
}

console.log("ok — lineage: stable crossword subjects, Aug 19 replay, revision layout");
