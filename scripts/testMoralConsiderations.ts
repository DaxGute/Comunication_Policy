/**
 * Moral consideration seeding, reserved ids, finalBasis, and layout turns.
 *
 * Run: npm run test:moral-considerations
 */
import assert from "node:assert/strict";
import { taskReasoningAdapterFor } from "../src/problems/adapters/registry";
import {
  moralSubjectsForProblem,
  normalizeMoralSubjectSeeding,
  referenceMoralConsiderations,
} from "../src/problems/adapters/openSubjects";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningMutations,
  computeMoralSynthesisDiagnostics,
  formatReasoningState,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  parseAgentTurn,
  resolveFinalBasis,
  seedGraphForProblem,
} from "../src/reasoning";
import { GRAPH_MEMORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";

function moralProblem(): Problem {
  return {
    id: "moral-considerations",
    category: "moral_philosophical",
    kind: "moral",
    title: "Boundary setting",
    text: "Discussion question:\nWhat should be done?\n\nExplore listed considerations.",
    moral: {
      title: "Boundary setting",
      description: "A dilemma.",
      issues: [
        "Directness vs sensitivity",
        "Boundary setting vs social expectations",
      ],
      question: "What should be done?",
      source: "reddit_ethics",
      sourceIndex: 1,
    },
  };
}

{
  assert.equal(normalizeMoralSubjectSeeding("agent-created"), "agent-created");
  assert.equal(normalizeMoralSubjectSeeding("none"), "agent-created");
  assert.equal(normalizeMoralSubjectSeeding("explicit-task-only"), "agent-created");
  assert.equal(normalizeMoralSubjectSeeding("explicit-task-seeded"), "agent-created");
  assert.equal(moralSubjectsForProblem(moralProblem()).length, 0);
  assert.equal(moralSubjectsForProblem(moralProblem(), "explicit-task-seeded").length, 0);
  assert.deepEqual(referenceMoralConsiderations(moralProblem()), [
    "Directness vs sensitivity",
    "Boundary setting vs social expectations",
  ]);
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version, "graph-memory-v3");
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.moralInitialization, "agent-created");
  console.log("✓ moral init is always agent-created empty; issues stay as eval metadata");
}

{
  const problem = moralProblem();
  const adapter = taskReasoningAdapterFor(problem);
  let graph = seedGraphForProblem(problem, adapter);
  assert.equal(graph.subjects.length, 0);
  assert.match(
    formatReasoningState(graph),
    /No persistent considerations have been established yet/,
  );
  const reserved = applyReasoningMutations(
    graph,
    [{ type: "SET", subjectId: "moral:stance", content: "Do the right thing." }],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg-1",
      resolveSubject: (raw) => adapter.resolveSubject?.(problem, raw) ?? {},
    },
  );
  assert.equal(reserved.events[0]?.accepted, false);
  assert.match(reserved.events[0]?.errors[0] ?? "", /Overall\/final stance is not a consideration/);
  assert.equal(
    reserved.graph.subjects.some((subject) => subject.id === "moral:stance"),
    false,
  );
  assert.equal(
    reserved.graph.events.some(
      (event) =>
        "subjectId" in event.mutation && event.mutation.subjectId === "moral:stance",
    ),
    false,
  );
  const question = applyReasoningMutations(
    graph,
    [{ type: "SET", subjectId: "moral:question", content: "What should be done?" }],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg-1",
      resolveSubject: (raw) => adapter.resolveSubject?.(problem, raw) ?? {},
    },
  );
  assert.equal(question.events[0]?.accepted, false);
  graph = applyReasoningMutations(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:autonomy",
        subjectLabel: "Autonomy",
        content: "Be specific about consent.",
      },
    ],
    {
      actor: "agent_a",
      turnIndex: 1,
      messageId: "msg-1",
      resolveSubject: (raw) => adapter.resolveSubject?.(problem, raw) ?? {},
    },
  ).graph;
  const serialized = formatReasoningState(graph);
  assert.match(serialized, /CONSIDERATION: Autonomy/);
  assert.match(serialized, /Created by: Agent A, turn 1/);
  assert.doesNotMatch(serialized, /\b(QUESTION|STANCE|TENSION):/);
  assert.doesNotMatch(serialized, /seeded from task/);
  console.log("✓ empty start; reserved stance/question rejected; agent SET creates lanes");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "FINAL_ANSWER: Set a boundary.",
      mutations: [],
      finalBasis: ["moral:autonomy@v1"],
    }),
    "agent_a",
    3,
  );
  assert.equal(parsed.finalBasisDeclared, true);
  assert.deepEqual(parsed.finalBasisRefs, ["moral:autonomy@v1"]);
  const omitted = parseAgentTurn(
    JSON.stringify({ message: "FINAL_ANSWER: Set a boundary.", mutations: [] }),
    "agent_a",
    3,
  );
  assert.equal(omitted.finalBasisDeclared, false);
  console.log("✓ finalBasis parse distinguishes omitted from declared");
}

{
  const problem = moralProblem();
  const adapter = taskReasoningAdapterFor(problem);
  const graph = applyReasoningMutations(
    seedGraphForProblem(problem, adapter),
    [
      {
        type: "SET",
        subjectId: "moral:autonomy",
        subjectLabel: "Autonomy",
        content: "Be specific.",
      },
      {
        type: "SET",
        subjectId: "moral:stakeholders",
        subjectLabel: "Stakeholders",
        content: "School staff have a duty once risk is known.",
      },
    ],
    {
      actor: "agent_b",
      turnIndex: 2,
      messageId: "msg-2",
      resolveSubject: (raw) => adapter.resolveSubject?.(problem, raw) ?? {},
    },
  ).graph;
  const resolved = resolveFinalBasis(["moral:autonomy@v1"], true, graph);
  assert.equal(resolved.declared, true);
  assert.equal(resolved.versionIds.length, 1);
  const stats = computeMoralSynthesisDiagnostics(graph, {
    finalBasisVersionIds: resolved.versionIds,
    finalBasisDeclared: true,
    referenceConsiderations: problem.moral?.issues,
  });
  assert.equal(stats.seededConsiderationCount, 0);
  assert.equal(stats.agentCreatedConsiderationCount, 2);
  assert.equal(stats.considerationsCreatedB, 2);
  assert.equal(stats.finalBasisCount, 1);
  assert.ok(stats.referenceConsiderationCoverage !== null);
  assert.equal(graph.subjects.every((subject) => subject.source === "agent"), true);
  const layout = layoutReasoningGraph(graph, {
    turns: [
      { turnIndex: 1, agentId: "agent_a", persistentChange: false },
      { turnIndex: 2, agentId: "agent_b", persistentChange: true },
    ],
    finalSynthesis: {
      turnIndex: 2,
      declared: true,
      basisVersionIds: resolved.versionIds,
    },
  });
  assert.equal(layout.turnBands.length, 2);
  assert.equal(layout.turnBands[0]?.persistentChange, false);
  assert.ok(layout.finalSynthesis);
  assert.ok(layout.edges.some((edge) => edge.kind === "final_synthesis"));
  const created = graph.subjects.find((subject) => subject.id === "moral:stakeholders");
  assert.equal(created?.source, "agent");
  assert.equal(created?.createdBy, "agent_b");
  console.log("✓ agent-created diagnostics, empty-turn columns, created provenance");
}

{
  const hydrated = hydrateReasoningGraph({
    reasoningSchemaVersion: 2,
    reasoningSubjects: [
      {
        id: "moral:question",
        label: "Question",
        source: "task",
        metadata: { role: "question" },
      },
      {
        id: "moral:stance",
        label: "Joint stance",
        source: "task",
        metadata: { role: "stance" },
      },
      {
        id: "moral:intent",
        label: "Intent",
        source: "agent",
        createdBy: "agent_a",
        createdAtTurn: 1,
      },
    ],
    reasoningVersions: [
      {
        id: "pv-1",
        subjectId: "moral:stance",
        content: "Do the right thing.",
        agentId: "agent_a",
        turn: 1,
        sourceUtteranceTurn: 1,
        status: "active",
      },
      {
        id: "pv-2",
        subjectId: "moral:intent",
        content: "Harm was not intended.",
        agentId: "agent_a",
        turn: 1,
        sourceUtteranceTurn: 1,
        status: "active",
      },
    ],
    reasoningEvents: [],
  });
  assert.deepEqual(
    hydrated.subjects.map((subject) => subject.id),
    ["moral:intent"],
  );
  assert.equal(hydrated.versions.length, 1);
  assert.equal(hydrated.versions[0]?.subjectId, "moral:intent");
  const serialized = formatReasoningState(hydrated);
  assert.match(serialized, /CONSIDERATION: Intent/);
  assert.doesNotMatch(serialized, /Question|Joint stance|stance|moral:question/i);
  const layout = layoutReasoningGraph(hydrated);
  assert.deepEqual(
    layout.lanes.map((lane) => lane.subjectId),
    ["moral:intent"],
  );
  console.log("✓ retired question/stance subjects are scrubbed on hydrate");
}

console.log("ok — moral agent-created considerations, reserved ids, finalBasis, layout");
