/**
 * Canonical reasoning architecture: versioned SET / REVISE / REMOVE state,
 * event-sourced persistence, and graph-as-memory prompt context.
 *
 * Run: npm run test:reasoning
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import { serializeConversation } from "../src/experiment/serializeConversation";
import { GRAPH_MEMORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";
import type { ExperimentRun } from "../src/experiment/types";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import {
  activeVersion,
  applyReasoningMutations,
  checkGraphInvariants,
  computeCanonicalReasoningMetrics,
  currentValue,
  derivedFromCycleIds,
  derivedFromEdges,
  emptyReasoningGraph,
  formatReasoningState,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  materializeGraph,
  parseAgentTurn,
  parseReasoningEvent,
  parseReasoningSubject,
  REASONING_SCHEMA_VERSION,
  revisesEdges,
  snapshotThroughTurn,
  type ParsedMutation,
  type ReasoningGraph,
} from "../src/reasoning";
import { collectInteractionEvents } from "../src/evaluation/interaction/events";
import { buildInteractionView } from "../src/evaluation/interaction/objects";
import { runProblem } from "../src/runtime/runProblem";
import {
  assistantHistoryContents,
  buildTurnRequestForAgent,
} from "../src/runtime/renderModelRequest";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import type { AgentId } from "../src/agents/types";
import type { Problem } from "../src/problems/types";

const SUBJECT = "proof:lemma:1";
const SEED = [
  {
    id: SUBJECT,
    label: "Lemma 1",
    source: "task" as const,
    kind: "task_defined" as const,
  },
];

function apply(
  graph: ReasoningGraph,
  mutations: ParsedMutation[],
  actor: AgentId,
  turn: number,
) {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
  });
}

function versionsOf(graph: ReasoningGraph, subjectId = SUBJECT) {
  return graph.versions
    .filter((version) => version.subjectId === subjectId)
    .sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
}

function canonicalSnapshot(graph: ReasoningGraph) {
  return {
    schemaVersion: graph.schemaVersion,
    subjects: graph.subjects
      .map((subject) => ({
        id: subject.id,
        source: subject.source,
        label: subject.label,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    versions: graph.versions
      .map((version) => ({
        id: version.id,
        subjectId: version.subjectId,
        content: version.content,
        agentId: version.agentId,
        turn: version.turn,
        previousVersionId: version.previousVersionId ?? null,
        status: version.status,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    current: Object.fromEntries(
      graph.subjects.map((subject) => [
        subject.id,
        currentValue(graph, subject.id) ?? null,
      ]),
    ),
    owners: Object.fromEntries(
      graph.subjects.map((subject) => [
        subject.id,
        activeVersion(graph, subject.id)?.agentId ?? null,
      ]),
    ),
  };
}

{
  let graph = emptyReasoningGraph(SEED);
  const first = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "Continuity is required." }],
    "agent_a",
    1,
  );
  graph = first.graph;
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.accepted, true);
  assert.equal(currentValue(graph, SUBJECT), "Continuity is required.");
  assert.equal(activeVersion(graph, SUBJECT)?.agentId, "agent_a");
  assert.equal(activeVersion(graph, SUBJECT)?.status, "active");
  assert.equal(versionsOf(graph).length, 1);
  console.log("✓ SET creates first active version");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const dup = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "Y" }],
    "agent_b",
    2,
  );
  assert.equal(dup.events[0]?.accepted, false);
  assert.match(dup.events[0]?.errors[0] ?? "", /duplicate SET/);
  assert.equal(currentValue(dup.graph, SUBJECT), "X");
  assert.equal(versionsOf(dup.graph).length, 1);
  console.log("✓ duplicate SET rejected");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const stale = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "Z", after: "Y" }],
    "agent_b",
    2,
  );
  assert.equal(stale.events[0]?.accepted, false);
  assert.match(stale.events[0]?.errors[0] ?? "", /stale before/);
  assert.equal(currentValue(stale.graph, SUBJECT), "X");
  console.log("✓ stale REVISE rejected");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const current = activeVersion(graph, SUBJECT)!;
  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: SUBJECT,
        fromVersionId: current.id,
        after: "Y",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(revised.events[0]?.accepted, true);
  const stored = revised.events[0]?.mutation;
  assert.equal(stored?.type, "REVISE");
  if (stored?.type === "REVISE") {
    assert.equal(stored.fromVersionId, current.id);
    assert.equal(stored.before, "X");
    assert.equal(stored.after, "Y");
  }
  assert.equal(currentValue(revised.graph, SUBJECT), "Y");
  const staleId = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: SUBJECT,
        fromVersionId: "pv-99",
        after: "Z",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(staleId.events[0]?.accepted, false);
  assert.match(staleId.events[0]?.errors[0] ?? "", /stale fromVersionId/);
  const chrome = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: SUBJECT,
        before: `v1 — Agent A, turn 1\n"X"`,
        after: "Z",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(chrome.events[0]?.accepted, false);
  console.log("✓ REVISE fromVersionId is the staleness check; display chrome is rejected");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const v1 = activeVersion(graph, SUBJECT)!;
  const revised = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "X", after: "Y" }],
    "agent_b",
    3,
  );
  graph = revised.graph;
  assert.equal(revised.events[0]?.accepted, true);
  const v2 = activeVersion(graph, SUBJECT)!;
  assert.equal(v2.content, "Y");
  assert.equal(v2.agentId, "agent_b");
  assert.equal(v2.previousVersionId, v1.id);
  assert.equal(graph.versions.find((version) => version.id === v1.id)?.status, "superseded");
  assert.equal(versionsOf(graph).length, 2);
  console.log("✓ REVISE requires matching before and supersedes prior version");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const noop = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "X", after: "X" }],
    "agent_b",
    2,
  );
  assert.equal(noop.events[0]?.accepted, false);
  assert.match(noop.events[0]?.errors[0] ?? "", /no-op REVISE/);
  const whitespace = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "X", after: "  X  " }],
    "agent_b",
    3,
  );
  assert.equal(whitespace.events[0]?.accepted, false);
  console.log("✓ no-op REVISE rejected");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const v1 = activeVersion(graph, SUBJECT)!;
  const removed = apply(
    graph,
    [{ type: "REMOVE", subjectId: SUBJECT, before: "X" }],
    "agent_b",
    2,
  );
  graph = removed.graph;
  assert.equal(removed.events[0]?.accepted, true);
  assert.equal(currentValue(graph, SUBJECT), undefined);
  const kept = graph.versions.find((version) => version.id === v1.id);
  assert.equal(kept?.status, "removed");
  assert.equal(kept?.content, "X");
  assert.equal(versionsOf(graph).length, 1);
  console.log("✓ REMOVE clears active state without deleting history");
}

{
  const graph = emptyReasoningGraph(SEED);
  const none = apply(graph, [], "agent_a", 1);
  assert.equal(none.events.length, 0);
  assert.equal(none.graph.versions.length, 0);
  assert.equal(none.graph.subjects.length, 1);
  console.log("✓ zero-mutation turn valid");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  graph = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "X", after: "Y" }],
    "agent_b",
    3,
  ).graph;
  graph = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "Y", after: "Z" }],
    "agent_a",
    6,
  ).graph;
  const replayed = materializeGraph(
    graph.events,
    SEED,
  );
  assert.deepEqual(canonicalSnapshot(replayed), canonicalSnapshot(graph));
  const hydrated = hydrateReasoningGraph({
    reasoningSchemaVersion: 2,
    reasoningSubjects: graph.subjects,
    reasoningEvents: graph.events,
  });
  assert.deepEqual(canonicalSnapshot(hydrated), canonicalSnapshot(graph));
  assert.equal(currentValue(hydrated, SUBJECT), "Z");
  assert.equal(activeVersion(hydrated, SUBJECT)?.agentId, "agent_a");
  const chain = versionsOf(hydrated);
  assert.equal(chain[0]?.content, "X");
  assert.equal(chain[1]?.content, "Y");
  assert.equal(chain[2]?.content, "Z");
  assert.equal(chain[2]?.previousVersionId, chain[1]?.id);
  assert.equal(chain[1]?.previousVersionId, chain[0]?.id);
  console.log("✓ replay/hydrate preserves current value, ownership, and revision chain");
}

{
  const parsed = parseReasoningEvent({
    action: "SET",
    subjectId: SUBJECT,
    after: "X",
    agent: "agent_a",
    turn: 1,
    accepted: true,
  });
  assert.ok(parsed);
  assert.equal(parsed?.mutation.type, "SET");
  if (parsed?.mutation.type === "SET") {
    assert.equal(parsed.mutation.content, "X");
  }
  const dense = parseReasoningEvent({
    operation: { type: "create", node: { type: "claim", text: "X" } },
    actor: "agent_a",
    turnIndex: 1,
  });
  assert.equal(dense, undefined);
  const fromAug19Log = hydrateReasoningGraph({
    reasoningSubjects: SEED,
    reasoningEvents: [
      {
        id: "ie-1",
        seq: 1,
        subjectId: SUBJECT,
        turn: 1,
        agent: "agent_a",
        action: "SET",
        before: null,
        after: "BALE",
        messageId: "msg-1",
        accepted: true,
        errors: [],
      },
    ],
  });
  assert.equal(fromAug19Log.schemaVersion, 2);
  assert.equal(currentValue(fromAug19Log, SUBJECT), "BALE");
  assert.equal(fromAug19Log.events[0]?.mutation.type, "SET");
  const schema1 = hydrateReasoningGraph({
    reasoningSchemaVersion: 1,
    reasoningEvents: [
      {
        id: "legacy",
        seq: 1,
        turnIndex: 1,
        messageId: "m1",
        actor: "agent_a",
        mutation: { type: "SET", subjectId: SUBJECT, content: "X" },
        accepted: true,
        errors: [],
      },
    ],
  });
  assert.equal(schema1.schemaVersion, 1);
  assert.equal(schema1.versions.length, 0);
  assert.equal(schema1.events.length, 0);
  console.log("✓ Aug 19 SET/REVISE records parse; schema-1 dense graphs are not converted");
}

{
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  graph = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "X", after: "Y" }],
    "agent_b",
    3,
  ).graph;
  graph = apply(
    graph,
    [{ type: "REVISE", subjectId: SUBJECT, before: "Y", after: "Z" }],
    "agent_a",
    6,
  ).graph;
  const metrics = computeCanonicalReasoningMetrics(graph);
  assert.equal(metrics.introductionCount, 1);
  assert.equal(metrics.revisionCount, 2);
  assert.equal(metrics.crossAgentRevisionCount, 2);
  assert.equal(metrics.partnerOverwriteAtoB, 1);
  assert.equal(metrics.partnerOverwriteBtoA, 1);
  assert.equal(metrics.directionalInfluenceAB, 0);
  assert.equal(metrics.directionalInfluenceBA, 0);
  assert.equal(metrics.agentOwnershipFinal.agent_a, 1);
  console.log("✓ graph-derived metrics: introductions, revisions, A↔B influence");
}

{
  const prompts = buildAgentPromptPair(
    createCommunicationPolicy({
      trustA: 0.5,
      trustB: 0.5,
      authority: 0.5,
      familiarity: 0.5,
    }),
  );
  let graph = emptyReasoningGraph(SEED);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: SUBJECT, content: "X" }],
    "agent_a",
    1,
  ).graph;
  const request = buildTurnRequestForAgent({
    agentId: "agent_b",
    agentPrompts: prompts,
    problemText: "Prove the claim.",
    utterances: [
      {
        id: "u1",
        sender: "agent_a",
        recipient: "agent_b",
        turn: 1,
        content: "TURN1_UNIQUE_UTTERANCE sets X",
      },
      {
        id: "u2",
        sender: "agent_b",
        recipient: "agent_a",
        turn: 2,
        content: "TURN2_UNIQUE_UTTERANCE question",
      },
      {
        id: "u3",
        sender: "agent_a",
        recipient: "agent_b",
        turn: 3,
        content: "TURN3_UNIQUE_UTTERANCE still thinking",
      },
    ],
    turn: 4,
    maxTurns: 8,
    reasoningGraph: graph,
  });
  const blob = request.messages.map((message) => message.content).join("\n");
  assert.equal(request.messages[0]?.role, "system");
  assert.match(request.messages[0]?.content ?? "", /You are Agent B/);
  assert.match(request.messages[0]?.content ?? "", /COMMUNICATION POLICY/);
  assert.match(blob, /Shared problem:\nProve the claim/);
  assert.match(blob, /CURRENT SHARED REASONING STATE/);
  assert.match(blob, /proof:lemma:1/);
  assert.match(blob, /\bX\b/);
  assert.match(blob, /MOST RECENT PARTNER MESSAGE/);
  assert.match(blob, /TURN3_UNIQUE_UTTERANCE/);
  assert.doesNotMatch(blob, /TURN1_UNIQUE_UTTERANCE/);
  assert.doesNotMatch(blob, /TURN2_UNIQUE_UTTERANCE/);
  assert.equal(assistantHistoryContents(request.messages).length, 0);
  assert.equal(request.telemetry.historicalTranscriptCharsIncluded, 0);
  assert.ok((request.telemetry.previousUtteranceChars ?? 0) > 0);
  assert.ok((request.telemetry.graphSubjectCount ?? 0) >= 1);
  assert.equal(request.telemetry.graphActiveValueCount, 1);
  assert.doesNotMatch(blob, /trustA|trustB|0\.5/);
  console.log("✓ model input is task + policy + graph + previous utterance only");
}

{
  const json = parseAgentTurn(
    JSON.stringify({
      message: "I don't think NOLAN works anymore.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "crossword:down:6",
          before: "NOLAN",
          after: "ATARI",
        },
      ],
    }),
    "agent_a",
    1,
  );
  assert.equal(json.message, "I don't think NOLAN works anymore.");
  assert.deepEqual(json.mutations, [
    {
      type: "REVISE",
      subjectId: "crossword:down:6",
      before: "NOLAN",
      after: "ATARI",
    },
  ]);
  const envelope = parseAgentTurn(
    [
      "MESSAGE:",
      "Please clarify the lemma.",
      "MUTATIONS:",
      "[]",
    ].join("\n"),
    "agent_b",
    2,
  );
  assert.equal(envelope.message, "Please clarify the lemma.");
  assert.deepEqual(envelope.mutations, []);
  const prose = parseAgentTurn("Just a question — what follows from X?", "agent_a", 3);
  assert.equal(prose.mutations.length, 0);
  assert.ok(prose.protocolFailure);
  console.log("✓ speaker-authored mutations parse; prose does not invent graph changes");
}

const policy = createCommunicationPolicy({
  trustA: 0.5,
  trustB: 0.5,
  authority: 0.5,
  familiarity: 0.5,
});
const prompts = buildAgentPromptPair(policy);
const config = normalizeRunConfig(
  {
    problemCategory: "proof",
    problemCount: 1,
    runModel: MOCK_MODEL_ID,
    maxTurns: 4,
    temperature: 0,
  },
  { ...DEFAULT_RUN_CONFIG, runModel: MOCK_MODEL_ID, provider: "mock" },
);
const problem: Problem = {
  id: "graph-memory",
  category: "proof",
  title: "Graph memory",
  text: "Prove that X survives only through the graph.",
  kind: "generic",
};

type Call = { turn: number; agentId: AgentId; messages: ModelRequest["messages"] };

class ScriptedClient implements ModelClient {
  calls: Call[] = [];
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const meta = input.meta;
    if (!meta) throw new Error("missing meta");
    this.calls.push({
      turn: meta.turnIndex,
      agentId: meta.agentId,
      messages: input.messages,
    });
    const payloads: Record<number, unknown> = {
      1: {
        message: "TURN1_SECRET_UTTERANCE introducing X",
        mutations: [{ type: "SET", subjectId: "proof:root", content: "PERSISTENT_X" }],
      },
      2: {
        message: "TURN2_PARTNER asking a question about the lemma.",
        mutations: [],
      },
      3: {
        message: "TURN3_PARTNER still thinking out loud.",
        mutations: [],
      },
      4: {
        message: "I can see X only because it is in the graph. FINAL_ANSWER: PERSISTENT_X",
        mutations: [],
      },
    };
    return {
      content: JSON.stringify(payloads[meta.turnIndex] ?? { message: "noop", mutations: [] }),
      provider: "mock",
      usage: { totalTokens: 8, source: "estimated" },
    };
  }
}

const client = new ScriptedClient();
const conversation = await runProblem({
  problem,
  policy,
  config,
  client,
  agentPrompts: prompts,
});

assert.equal(conversation.reasoningSchemaVersion, REASONING_SCHEMA_VERSION);
assert.equal(currentValue(
  hydrateReasoningGraph({
    reasoningSchemaVersion: conversation.reasoningSchemaVersion,
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningEvents: conversation.reasoningEvents,
  }),
  "proof:root",
), "PERSISTENT_X");
assert.equal(conversation.messages.length, 4);
assert.match(conversation.messages[0]!.content, /TURN1_SECRET_UTTERANCE/);

const turn4 = client.calls.find((call) => call.turn === 4);
assert.ok(turn4);
const turn4Blob = turn4.messages.map((message) => message.content).join("\n");
assert.match(turn4Blob, /PERSISTENT_X/);
assert.match(turn4Blob, /CURRENT SHARED REASONING STATE/);
assert.match(turn4Blob, /TURN3_PARTNER/);
assert.doesNotMatch(turn4Blob, /TURN1_SECRET_UTTERANCE/);
assert.doesNotMatch(turn4Blob, /TURN2_PARTNER/);
assert.equal(assistantHistoryContents(turn4.messages).length, 0);
assert.equal(
  conversation.messages[3]?.requestTelemetry?.historicalTranscriptCharsIncluded,
  0,
);
assert.equal(conversation.messages[3]?.requestTelemetry?.graphActiveValueCount, 1);

const persisted = JSON.parse(
  JSON.stringify({
    reasoningSchemaVersion: conversation.reasoningSchemaVersion,
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningEvents: conversation.reasoningEvents,
  }),
) as {
  reasoningSchemaVersion: 1 | 2;
  reasoningSubjects: unknown[];
  reasoningEvents: unknown[];
};
const rehydrated = hydrateReasoningGraph({
  reasoningSchemaVersion: persisted.reasoningSchemaVersion,
  reasoningSubjects: persisted.reasoningSubjects as never,
  reasoningEvents: persisted.reasoningEvents as never,
});
const live = hydrateReasoningGraph({
  reasoningSchemaVersion: conversation.reasoningSchemaVersion,
  reasoningSubjects: conversation.reasoningSubjects,
  reasoningEvents: conversation.reasoningEvents,
});
assert.deepEqual(canonicalSnapshot(rehydrated), canonicalSnapshot(live));

const exported = serializeConversation(conversation, {
  id: "run-graph-memory",
  createdAt: new Date().toISOString(),
  policy,
  agentPrompts: prompts,
  transcriptProtocol: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL,
  config,
  conversations: [conversation],
  status: "completed",
} satisfies ExperimentRun);
const exportedClone = JSON.parse(JSON.stringify(exported)) as {
  reasoning?: { subjects?: unknown[]; events?: unknown[] };
};
const fromExport = materializeGraph(
  (exportedClone.reasoning?.events ?? [])
    .map(parseReasoningEvent)
    .filter((event): event is NonNullable<typeof event> => Boolean(event)),
  (exportedClone.reasoning?.subjects ?? [])
    .map(parseReasoningSubject)
    .filter((subject): subject is NonNullable<typeof subject> => Boolean(subject))
    .filter((subject) => subject.source === "task"),
);
assert.equal(currentValue(fromExport, "proof:root"), "PERSISTENT_X");
assert.equal(
  materializeGraph(
    live.events.filter((event) => event.accepted),
    live.subjects.filter((subject) => subject.source === "task"),
  ).versions.find((version) => version.status === "active")?.content,
  "PERSISTENT_X",
);
console.log("✓ cross-turn: X is visible at turn 4 only via the graph, not the transcript");
console.log("✓ source of truth: stripping older messages from model context still runs");

{
  const intent = "moral:intent";
  const responsibility = "moral:responsibility";
  const seed = [
    { id: intent, label: "Intent", source: "task" as const },
    { id: responsibility, label: "Responsibility", source: "task" as const },
  ];
  let graph = emptyReasoningGraph(seed);
  const setX = apply(
    graph,
    [{ type: "SET", subjectId: intent, content: "The actor intended the harm." }],
    "agent_a",
    1,
  );
  graph = setX.graph;
  assert.equal(setX.events[0]?.accepted, true);
  const xId = setX.events[0]?.versionId;
  assert.ok(xId);

  const missingOk = apply(
    graph,
    [{ type: "SET", subjectId: responsibility, content: "The actor is fully responsible." }],
    "agent_b",
    2,
  );
  assert.equal(missingOk.events[0]?.accepted, true);
  assert.deepEqual(missingOk.graph.versions.find((v) => v.id === missingOk.events[0]?.versionId)?.derivedFromVersionIds, undefined);

  graph = emptyReasoningGraph(seed);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: intent, content: "The actor intended the harm." }],
    "agent_a",
    1,
  ).graph;
  const withBasis = apply(
    graph,
    [
      {
        type: "SET",
        subjectId: responsibility,
        content: "Responsibility is reduced but not eliminated.",
        basis: [`${intent}@v1`, `${intent}@v1`, "pv-1"],
      },
    ],
    "agent_b",
    2,
  );
  graph = withBasis.graph;
  assert.equal(withBasis.events[0]?.accepted, true);
  assert.deepEqual(withBasis.events[0]?.basisVersionIds, ["pv-1"]);
  const y = activeVersion(graph, responsibility)!;
  assert.deepEqual(y.derivedFromVersionIds, ["pv-1"]);
  assert.equal(currentValue(graph, intent), "The actor intended the harm.");

  const revised = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: responsibility,
        before: "Responsibility is reduced but not eliminated.",
        after: "Responsibility is mitigated when harm was unforeseeable.",
        basis: [`${intent}@v1`, "pv-1"],
      },
    ],
    "agent_a",
    3,
  );
  graph = revised.graph;
  assert.equal(revised.events[0]?.accepted, true);
  assert.equal(revised.events[0]?.basisVersionIds?.length, 1);

  const missing = apply(
    graph,
    [
      {
        type: "SET",
        subjectId: "moral:fairness",
        content: "Fairness requires notice.",
        basis: ["moral:missing@v1"],
      },
    ],
    "agent_a",
    4,
  );
  assert.equal(missing.events[0]?.accepted, false);
  assert.match(missing.events[0]?.errors.join(" ") ?? "", /nonexistent basis/);

  const selfRef = apply(
    emptyReasoningGraph(seed),
    [
      {
        type: "SET",
        subjectId: intent,
        content: "Self.",
        basis: ["pv-1"],
      },
    ],
    "agent_a",
    1,
  );
  assert.equal(selfRef.events[0]?.accepted, false);
  assert.match(selfRef.events[0]?.errors.join(" ") ?? "", /self-reference/);

  let futureGraph = emptyReasoningGraph(seed);
  futureGraph = apply(
    futureGraph,
    [{ type: "SET", subjectId: intent, content: "Early." }],
    "agent_a",
    1,
  ).graph;
  futureGraph = apply(
    futureGraph,
    [{ type: "SET", subjectId: responsibility, content: "Later." }],
    "agent_b",
    2,
  ).graph;
  const future = apply(
    futureGraph,
    [
      {
        type: "SET",
        subjectId: "moral:harm",
        content: "Harm occurred.",
        basis: [`${responsibility}@v1`],
      },
    ],
    "agent_a",
    1,
  );
  assert.equal(future.events[0]?.accepted, false);
  assert.match(future.events[0]?.errors.join(" ") ?? "", /future basis/);

  const persisted = JSON.parse(JSON.stringify({
    reasoningSchemaVersion: 2,
    reasoningSubjects: graph.subjects,
    reasoningVersions: graph.versions,
    reasoningEvents: graph.events,
  }));
  const reloaded = hydrateReasoningGraph(persisted);
  assert.deepEqual(
    reloaded.versions.find((version) => version.subjectId === responsibility && version.status === "active")
      ?.derivedFromVersionIds,
    ["pv-1"],
  );
  console.log("✓ basis: valid, missing, duplicates, self, future, persist");
}

{
  const intent = "moral:intent";
  const foresee = "moral:foreseeability";
  const responsibility = "moral:responsibility";
  let graph = emptyReasoningGraph([
    { id: intent, label: "Intent", source: "task" },
    { id: foresee, label: "Foreseeability", source: "task" },
    { id: responsibility, label: "Responsibility", source: "task" },
  ]);
  graph = apply(graph, [{ type: "SET", subjectId: intent, content: "Intent v1" }], "agent_a", 1).graph;
  graph = apply(graph, [{ type: "SET", subjectId: foresee, content: "Foresee v1" }], "agent_b", 2).graph;
  graph = apply(
    graph,
    [
      {
        type: "SET",
        subjectId: responsibility,
        content: "Responsibility v1",
        basis: [`${intent}@v1`, `${foresee}@v1`],
      },
    ],
    "agent_a",
    3,
  ).graph;
  graph = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: responsibility,
        before: "Responsibility v1",
        after: "Responsibility v2",
        basis: [`${foresee}@v1`],
      },
    ],
    "agent_b",
    4,
  ).graph;

  const derived = derivedFromEdges(graph);
  const revises = revisesEdges(graph);
  assert.equal(derived.filter((edge) => edge.to === "pv-3").length, 2);
  assert.ok(revises.some((edge) => edge.from === "pv-3" && edge.to === "pv-4"));
  assert.equal(derivedFromCycleIds(graph).length, 0);
  assert.equal(checkGraphInvariants(graph).length, 0);
  assert.match(formatReasoningState(graph), /Derived from:/);
  assert.equal(currentValue(graph, responsibility), "Responsibility v2");
  const layout = layoutReasoningGraph(graph);
  assert.equal(layout.nodes.length, graph.versions.length);
  assert.ok(layout.edges.some((edge) => edge.kind === "revises"));
  assert.ok(layout.edges.some((edge) => edge.kind === "derived_from"));
  assert.ok(layout.lanes.some((lane) => lane.subjectId === responsibility));
  const currentOnly = layoutReasoningGraph(graph, { currentStateOnly: true });
  assert.ok(currentOnly.nodes.some((node) => node.version.status === "active"));
  assert.ok(currentOnly.edges.every((edge) => edge.kind === "derived_from"));
  const filtered = layoutReasoningGraph(graph, { subjectId: intent });
  assert.ok(filtered.nodes.every((node) => node.subjectId === intent));
  const emptyLayout = layoutReasoningGraph(emptyReasoningGraph());
  assert.equal(emptyLayout.nodes.length, 0);
  const schema1 = hydrateReasoningGraph({ reasoningSchemaVersion: 1, reasoningEvents: [{ operation: { type: "create" } }] });
  assert.equal(schema1.schemaVersion, 1);
  assert.doesNotThrow(() => layoutReasoningGraph(schema1));
  const through2 = snapshotThroughTurn(graph, 2);
  assert.equal(through2.versions.length, 2);
  assert.equal(currentValue(through2, responsibility), undefined);
  console.log("✓ provenance graph: revises, derived_from, lanes, current-state, schema-1 safe");
}

{
  const x = "moral:x";
  const y = "moral:y";
  let graph = emptyReasoningGraph([
    { id: x, label: "X", source: "task" },
    { id: y, label: "Y", source: "task" },
  ]);
  graph = apply(graph, [{ type: "SET", subjectId: x, content: "X1" }], "agent_a", 1).graph;
  graph = apply(
    graph,
    [{ type: "SET", subjectId: y, content: "Y1", basis: [`${x}@v1`] }],
    "agent_b",
    2,
  ).graph;
  let metrics = computeCanonicalReasoningMetrics(graph);
  assert.equal(metrics.directionalInfluenceAB, 1);
  assert.equal(metrics.directionalInfluenceBA, 0);
  assert.equal(metrics.crossAgentDerivedFromAtoB, 1);
  graph = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: x,
        before: "X1",
        after: "X2",
        basis: [`${y}@v1`],
      },
    ],
    "agent_a",
    3,
  ).graph;
  metrics = computeCanonicalReasoningMetrics(graph);
  assert.equal(metrics.directionalInfluenceAB, 1);
  assert.equal(metrics.directionalInfluenceBA, 1);
  const events = collectInteractionEvents(buildInteractionView(graph, "moral_philosophical"), []);
  assert.equal(events.filter((event) => event.type === "adopted").length, 0);
  assert.ok(events.some((event) => event.type === "referenced"));
  console.log("✓ cross-agent derived_from influence; no adoption labels");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Trying a bad mutation.",
      mutations: [
        { type: "SET", subjectId: "proof:goal", content: "G" },
        { notAMutation: true },
      ],
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.mutations.length, 2);
  assert.equal(parsed.mutations[1]?.type, "invalid");
  const applied = apply(
    emptyReasoningGraph([{ id: "proof:goal", label: "Goal", source: "task" }]),
    parsed.mutations,
    "agent_a",
    1,
  );
  assert.equal(applied.events.length, 2);
  assert.equal(applied.events[0]?.accepted, true);
  assert.equal(applied.events[1]?.accepted, false);
  console.log("✓ malformed mutation entries are rejected, not dropped");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Can you check whether the lemma still holds?",
      mutations: [],
    }),
    "agent_b",
    2,
  );
  assert.equal(parsed.mutations.length, 0);
  assert.equal(parsed.protocolFailure, undefined);
  const applied = applyReasoningMutations(
    emptyReasoningGraph([{ id: "proof:goal", label: "Goal", source: "task" }]),
    parsed.mutations,
    {
      actor: "agent_b",
      turnIndex: 2,
      messageId: "msg-empty",
      extraDiagnostics: ["structured_reasoning_missing"],
    },
  );
  assert.equal(applied.events.length, 0);
  assert.equal(applied.graph.events.length, 0);
  console.log("✓ valid empty mutations are not rejected graph events");
}

console.log("ok — canonical versioned reasoning architecture");
