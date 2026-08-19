/**
 * Structured reasoning graph protocol.
 *
 * Run: npm run test:reasoning
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair, splitAgentPromptLayers } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import { serializeConversation } from "../src/experiment/serializeConversation";
import { FULL_HISTORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";
import type { ExperimentRun } from "../src/experiment/types";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import type { Problem } from "../src/problems/types";
import { reasoningSubjectsForProblem } from "../src/problems/reasoningSubjects";
import {
  applyReasoningIntents,
  computeReasoningGraphDiagnostics,
  emptyReasoningGraph,
  hasStructuredReasoning,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  materializeGraph,
  parseAgentTurn,
  snapshotBeforeTurn,
  stancesForNode,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";
import { formatReasoningState } from "../src/reasoning/renderState";
import { parseReasoningEvent } from "../src/reasoning/parseStored";
import { runProblem } from "../src/runtime/runProblem";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";
import { buildTurnRequestForAgent } from "../src/runtime/renderModelRequest";

function apply(
  g: ReasoningGraph,
  intents: ReasoningIntent[],
  actor: "agent_a" | "agent_b" = "agent_a",
  turn = 1,
  extras: {
    protocolFailure?: string;
    finalAnswer?: { text?: string; supportingNodeIds: string[] };
    candidateIdentity?: Parameters<
      typeof applyReasoningIntents
    >[2]["candidateIdentity"];
    validateCandidate?: Parameters<
      typeof applyReasoningIntents
    >[2]["validateCandidate"];
  } = {},
) {
  return applyReasoningIntents(g, intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    protocolFailure: extras.protocolFailure,
    finalAnswer: extras.finalAnswer,
    candidateIdentity: extras.candidateIdentity,
    validateCandidate: extras.validateCandidate,
  });
}

function createProposal(
  text: string,
  extras: Partial<Extract<ReasoningIntent, { action: "create" }>> = {},
): ReasoningIntent {
  return {
    action: "create",
    nodeType: "proposal",
    text,
    ...extras,
  };
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  assert.equal(created.events.at(-1)?.accepted, true);
  assert.equal(created.graph.nodes[0]?.id, "P1");
  assert.equal(created.graph.nodes[0]?.createdBy, "agent_a");
  assert.equal(created.graph.nodes[0]?.status, "open");
  assert.equal(created.graph.nodes[0]?.createdAtTurn, 1);
  assert.equal(created.graph.nodes[0]?.sourceMessageId, "msg-1-agent_a");

  const revised = apply(
    created.graph,
    [
      {
        action: "revise",
        targetId: "P1",
        text: "4 Across is EON",
      },
    ],
    "agent_a",
    2,
  );
  const p1 = revised.graph.nodes.find((n) => n.id === "P1");
  const p2 = revised.graph.nodes.find((n) => n.id === "P2");
  assert.equal(p1?.text, "4 Across is ERA");
  assert.equal(p1?.status, "superseded");
  assert.equal(p2?.text, "4 Across is EON");
  assert.equal(p2?.supersedes, "P1");
  assert.deepEqual(p2?.parents, []);
  assert.equal(
    revised.graph.edges?.some(
      (edge) =>
        edge.type === "revises" &&
        edge.sourceNodeId === "P2" &&
        edge.targetNodeId === "P1",
    ),
    true,
  );
}

{
  const subjects = [
    {
      id: "crossword:across:1",
      label: "Across 1",
      description: "Top of a suit?",
      source: "task" as const,
    },
  ];
  const identityOf = (node: { text: string; subjectId?: string }) =>
    node.subjectId
      ? `${node.subjectId}:${node.text.replace(/[^A-Za-z]/g, "").toUpperCase()}`
      : undefined;
  const first = apply(
    emptyReasoningGraph(subjects),
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = SITE",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_a",
    1,
    { candidateIdentity: identityOf },
  );
  const second = apply(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = SITH",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_b",
    3,
    { candidateIdentity: identityOf },
  );
  const c1 = second.graph.nodes.find((node) => node.id === "C1");
  const c2 = second.graph.nodes.find((node) => node.id === "C2");
  assert.equal(c1?.status, "superseded");
  assert.equal(c2?.supersedes, "C1");
  assert.equal(
    second.graph.edges?.some(
      (edge) =>
        edge.type === "revises" &&
        edge.sourceNodeId === "C2" &&
        edge.targetNodeId === "C1",
    ),
    true,
  );
  assert.equal(
    second.graph.edges?.some(
      (edge) =>
        edge.type === "replaced_by" &&
        edge.sourceNodeId === "C1" &&
        edge.targetNodeId === "C2",
    ),
    true,
  );
  assert.match(
    second.events.at(-1)?.diagnostics?.join(" ") ?? "",
    /promoted_create_to_revise/,
  );
  const layout = layoutReasoningGraph(second.graph);
  const layoutC1 = layout.nodes.find((node) => node.id === "C1")!;
  const layoutC2 = layout.nodes.find((node) => node.id === "C2")!;
  assert.equal(layoutC1.x + layoutC1.width / 2, layoutC2.x + layoutC2.width / 2);
  assert.ok(layoutC1.y < layoutC2.y);
  assert.equal(
    layout.nodes.some(
      (node) =>
        node.id === "crossword:across:1" &&
        node.node.metadata?.taskDefined === true,
    ),
    true,
  );
  const state = formatReasoningState(second.graph);
  assert.match(state, /AVAILABLE ISSUES/);
  assert.match(state, /Refer to issues by their labels/);
  assert.match(state, /ID: crossword:across:1/);
  assert.match(state, /Across 1/);
  assert.match(state, /CLUE: Top of a suit\?/);
  assert.doesNotMatch(state, /crossword:across:1 — Across 1/);
  assert.match(state, /C1 \[Agent A\] claim/);
  assert.match(state, /C2 \[Agent B\] claim/);

  const spoofed = apply(
    second.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Unknown answer",
        subjectId: "crossword:down:99",
      },
    ],
    "agent_a",
    4,
  );
  assert.equal(spoofed.events.at(-1)?.accepted, false);
  assert.match(spoofed.events.at(-1)?.errors.join(" ") ?? "", /unknown issue/);
}

{
  const emergent = apply(emptyReasoningGraph(), [
    {
      action: "create",
      nodeType: "issue",
      text: "Is f continuous?",
      localId: "continuity",
    },
    {
      action: "create",
      nodeType: "claim",
      text: "f is continuous",
      subjectId: "continuity",
    },
  ]);
  assert.equal(emergent.events.every((event) => event.accepted), true);
  assert.equal(
    emergent.graph.nodes.find((node) => node.id === "C1")?.type ===
      "final_answer"
      ? undefined
      : emergent.graph.nodes.find((node) => node.id === "C1")?.subjectId,
    "I1",
  );
  assert.equal(
    emergent.graph.edges?.some(
      (edge) =>
        edge.type === "answers" &&
        edge.sourceNodeId === "C1" &&
        edge.targetNodeId === "I1",
    ),
    true,
  );
}

{
  const turn1 = apply(
    emptyReasoningGraph(),
    [createProposal("root proposal")],
    "agent_a",
    1,
  );
  const turn2 = apply(
    turn1.graph,
    [
      createProposal("supporting branch", { parents: ["P1"] }),
      createProposal("parallel branch"),
    ],
    "agent_b",
    2,
  );
  const turn5 = apply(
    turn2.graph,
    [{ action: "revise", targetId: "P2", text: "revised branch" }],
    "agent_a",
    5,
  );
  const layout = layoutReasoningGraph(turn5.graph);
  assert.equal(
    turn2.graph.edges?.some(
      (edge) =>
        edge.type === "supports" &&
        edge.sourceNodeId === "P1" &&
        edge.targetNodeId === "P2",
    ),
    false,
  );
  const at = (id: string) => layout.nodes.find((node) => node.id === id)!;

  assert.ok(at("P1").y < at("P2").y);
  assert.equal(at("P2").y, at("P3").y);
  assert.ok(at("P3").y < at("P4").y);
  assert.equal(at("P1").turnIndex, 1);
  assert.deepEqual(
    layout.turnBands.map((band) => band.turnIndex),
    [1, 2, 3, 4, 5],
  );

  const extended = apply(
    turn5.graph,
    [createProposal("later independent branch")],
    "agent_b",
    6,
  );
  const extendedLayout = layoutReasoningGraph(extended.graph);
  for (const id of ["P1", "P2", "P3", "P4"]) {
    const before = at(id);
    const after = extendedLayout.nodes.find((node) => node.id === id)!;
    assert.deepEqual(
      { x: after.x, y: after.y },
      { x: before.x, y: before.y },
    );
  }
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const passed = apply(
    created.graph,
    [{ action: "pass", targetId: "P1", reason: "not evaluating yet" }],
    "agent_b",
    2,
  );
  assert.equal(passed.graph.nodes.find((n) => n.id === "P1")?.status, "open");
  assert.equal(stancesForNode(passed.graph, "P1")[0]?.kind, "pass");
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const one = apply(
    created.graph,
    [{ action: "accept", targetId: "P1", reason: "looks good" }],
    "agent_b",
    2,
  );
  assert.equal(one.graph.nodes.find((n) => n.id === "P1")?.status, "open");
  const both = apply(
    one.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_a",
    3,
  );
  assert.equal(both.graph.nodes.find((n) => n.id === "P1")?.status, "accepted");
}

{
  const self = apply(emptyReasoningGraph(), [
    createProposal("depends on itself", {
      localId: "p",
      dependencies: ["p"],
    }),
  ]);
  assert.equal(self.graph.nodes.length, 0);
  assert.equal(self.events.at(-1)?.accepted, false);
  assert.match(self.events.at(-1)?.errors.join(" ") ?? "", /unknown target p|itself|cycle/);

  const created = apply(emptyReasoningGraph(), [createProposal("root")]);
  const unknown = apply(
    created.graph,
    [{ action: "challenge", targetId: "P99", reason: "no such node" }],
    "agent_b",
    2,
  );
  assert.equal(unknown.events.at(-1)?.accepted, false);
  assert.match(unknown.events.at(-1)?.errors.join(" ") ?? "", /unknown target P99/);
  assert.equal(unknown.events.at(-1)?.intent.action, "challenge");
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const dup = apply(
    created.graph,
    [createProposal("4 Across is ERA")],
    "agent_b",
    2,
  );
  assert.equal(dup.events.at(-1)?.accepted, true);
  assert.equal(dup.events.at(-1)?.stateChanged, false);
  assert.match(dup.events.at(-1)?.diagnostics?.join(" ") ?? "", /already the live candidate/);
  assert.equal(dup.graph.nodes.filter((n) => n.type === "proposal").length, 1);
}

{
  const chained = apply(emptyReasoningGraph(), [
    createProposal("root claim", { localId: "root" }),
    createProposal("depends on root", {
      localId: "mid",
      dependencies: ["root"],
    }),
    createProposal("depends on mid", { dependencies: ["mid"] }),
  ]);
  assert.equal(
    chained.events.filter((e) => e.operation.type === "create").every((e) => e.accepted),
    true,
  );
  assert.deepEqual(
    chained.graph.nodes.find((n) => n.id === "P3")?.dependencies,
    ["P2"],
  );
  assert.equal(chained.graph.nodes.find((n) => n.id === "P3")?.status, "unresolved");
  assert.equal(
    chained.graph.edges?.some(
      (edge) =>
        edge.type === "depends_on" &&
        edge.sourceNodeId === "P3" &&
        edge.targetNodeId === "P2",
    ),
    true,
  );
}

{
  const cycle = apply(emptyReasoningGraph(), [
    createProposal("one", { localId: "one" }),
    createProposal("two", { localId: "two", dependencies: ["one"] }),
  ]);
  const closer = apply(cycle.graph, [
    {
      action: "create",
      nodeType: "proposal",
      text: "self loop",
      localId: "loop",
      dependencies: ["loop"],
    },
  ]);
  assert.equal(closer.events.at(-1)?.accepted, false);
  assert.match(closer.events.at(-1)?.errors.join(" ") ?? "", /itself/);
}

{
  const malformed = apply(emptyReasoningGraph(), [
    { action: "invalid", raw: { nope: true } },
    { action: "create" },
    { action: "reject", targetId: "P1" },
    { action: "support" },
  ]);
  assert.equal(malformed.events.length, 4);
  assert.equal(malformed.events.every((event) => event.accepted === false), true);
  assert.equal(malformed.graph.nodes.length, 0);
  assert.match(malformed.events[0]?.errors.join(" ") ?? "", /malformed/);
  assert.match(malformed.events[1]?.errors.join(" ") ?? "", /node type|node text/);
  assert.match(malformed.events[2]?.errors.join(" ") ?? "", /unknown target|reason/);
  assert.match(malformed.events[3]?.errors.join(" ") ?? "", /missing targetId/);
}

{
  const parsedBad = parseAgentTurn("Just chatting.\nFINAL_ANSWER: 42", "agent_b", 2);
  assert.equal(parsedBad.parsedAsJson, false);
  assert.ok(parsedBad.protocolFailure);
  assert.equal(parsedBad.intents.length, 0);
  const failed = apply(emptyReasoningGraph(), parsedBad.intents, "agent_b", 2, {
    protocolFailure: parsedBad.protocolFailure,
    finalAnswer: parsedBad.finalAnswerSupport,
  });
  assert.equal(failed.events[0]?.operation.type, "protocol_failure");
  assert.equal(failed.events[0]?.accepted, false);
  assert.equal(failed.graph.nodes.length, 1);
  assert.equal(failed.graph.nodes[0]?.type, "final_answer");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "I think 4-Across is EON.",
      reasoningIntents: [
        {
          action: "create",
          nodeType: "proposal",
          text: "4-Across is EON",
          createdBy: "agent_b",
          id: "HACK",
          status: "accepted",
          createdAtTurn: 99,
        },
      ],
      finalAnswer: { text: "EON", supportingNodeIds: ["P1"] },
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.parsedAsJson, true);
  assert.equal(parsed.intents[0]?.action, "create");
  const applied = apply(emptyReasoningGraph(), parsed.intents, "agent_a", 1, {
    finalAnswer: parsed.finalAnswerSupport,
  });
  const node = applied.graph.nodes[0];
  assert.equal(node?.id, "P1");
  assert.equal(node?.createdBy, "agent_a");
  assert.equal(node?.createdAtTurn, 1);
  assert.equal(node?.status, "open");
  assert.notEqual(node?.id, "HACK");
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "Atomic graph",
      reasoningIntents: [
        { action: "evidence", text: "Observed datum", localId: "datum" },
        { action: "claim", text: "Atomic conclusion", localId: "conclusion" },
        {
          action: "support",
          sourceNodeId: "datum",
          targetNodeId: "conclusion",
          reason: "The datum bears on the conclusion",
        },
      ],
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.intents[0]?.action, "create");
  assert.equal(
    parsed.intents[0]?.action === "create" ? parsed.intents[0].nodeType : "",
    "evidence",
  );
  const applied = apply(emptyReasoningGraph(), parsed.intents);
  assert.equal(applied.graph.edges?.length, 1);
  assert.deepEqual(
    {
      type: applied.graph.edges?.[0]?.type,
      source: applied.graph.edges?.[0]?.sourceNodeId,
      target: applied.graph.edges?.[0]?.targetNodeId,
      event: applied.graph.edges?.[0]?.sourceEventId,
    },
    { type: "supports", source: "E1", target: "C1", event: "rev-3" },
  );

  const invalidSource = apply(
    applied.graph,
    [
      {
        action: "challenge",
        sourceNodeId: "C404",
        targetNodeId: "C1",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(invalidSource.events.at(-1)?.accepted, false);
  assert.match(invalidSource.events.at(-1)?.errors.join(" ") ?? "", /source.*C404/);

  const legacyStance = apply(
    applied.graph,
    [{ action: "support", targetId: "C1", reason: "legacy stance" }],
    "agent_b",
    2,
  );
  assert.equal(legacyStance.events.at(-1)?.accepted, true);
  assert.equal(legacyStance.graph.edges?.length, 1);
  assert.deepEqual(
    materializeGraph(legacyStance.graph.events).edges,
    legacyStance.graph.edges,
  );
}

{
  const many = Array.from({ length: 66 }, (_, index) =>
    createProposal(`atomic proposal ${index + 1}`),
  );
  const capped = apply(emptyReasoningGraph(), many);
  assert.equal(capped.graph.nodes.length, 64);
  assert.equal(capped.events.length, 66);
  assert.match(capped.events[64]?.errors.join(" ") ?? "", /per-turn cap of 64/);
  assert.match(capped.events[65]?.errors.join(" ") ?? "", /per-turn cap of 64/);
}

{
  const created = apply(
    emptyReasoningGraph(),
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "Crossing requires N",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = EON",
      },
      {
        action: "create",
        nodeType: "claim",
        text: "Unrelated same-turn claim",
      },
    ],
    "agent_a",
    1,
  );
  const related = apply(
    created.graph,
    [
      {
        action: "support",
        sourceNodeId: "E1",
        targetNodeId: "C1",
      },
      {
        action: "challenge",
        sourceNodeId: "C2",
        targetNodeId: "C1",
      },
    ],
    "agent_b",
    3,
  );
  assert.equal(
    related.graph.edges?.some(
      (edge) =>
        edge.type === "supports" &&
        edge.sourceNodeId === "E1" &&
        edge.targetNodeId === "C1",
    ),
    true,
  );
  assert.equal(
    related.graph.edges?.some(
      (edge) =>
        edge.type === "challenges" &&
        edge.sourceNodeId === "C2" &&
        edge.targetNodeId === "C1",
    ),
    true,
  );
  assert.equal(
    created.graph.edges?.some(
      (edge) => edge.sourceNodeId === "C1" || edge.targetNodeId === "C1",
    ),
    false,
  );
  const consecutive = apply(
    created.graph,
    [createProposal("Unrelated next-turn proposal")],
    "agent_b",
    2,
  );
  assert.equal(consecutive.graph.edges?.length, 0);
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("live claim")]);
  const text = formatReasoningState(created.graph);
  assert.match(text, /CURRENT REASONING STATE/);
  assert.match(text, /P1/);
  assert.match(text, /Agent A proposed/);
  assert.doesNotMatch(text, /trustA|authority|familiarity/i);
}

{
  const first = apply(
    emptyReasoningGraph(),
    Array.from({ length: 64 }, (_, index) =>
      createProposal(`older atomic claim ${index + 1}`),
    ),
    "agent_a",
    1,
  );
  const recent = apply(
    first.graph,
    Array.from({ length: 10 }, (_, index) =>
      createProposal(`recent atomic claim ${index + 1}`),
    ),
    "agent_b",
    2,
  );
  const state = formatReasoningState(recent.graph);
  assert.match(state, /P74/);
  assert.match(state, /10 more nodes omitted/);
}

{
  const t1 = apply(emptyReasoningGraph(), [createProposal("claim")], "agent_a", 1);
  const t2 = apply(
    t1.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    2,
  );
  const before2 = snapshotBeforeTurn(t2.graph, 2);
  assert.equal(before2.nodes.length, 1);
  assert.ok(before2.events.every((e) => e.turnIndex < 2));
  const replayed = materializeGraph(t2.graph.events);
  assert.deepEqual(
    replayed.nodes.map((n) => ({ id: n.id, status: n.status, text: n.text })),
    t2.graph.nodes.map((n) => ({ id: n.id, status: n.status, text: n.text })),
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("first")]);
  const onSuperseded = apply(
    apply(created.graph, [{ action: "revise", targetId: "P1", text: "second" }], "agent_a", 2)
      .graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    3,
  );
  assert.equal(onSuperseded.events.at(-1)?.accepted, false);
  assert.match(
    onSuperseded.events.at(-1)?.errors.join(" ") ?? "",
    /superseded; reference the live revision P2/,
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("bad idea")]);
  const rejected = apply(
    created.graph,
    [{ action: "reject", targetId: "P1", reason: "no" }],
    "agent_a",
    2,
  );
  assert.equal(rejected.graph.nodes[0]?.status, "rejected");
  const acceptRejected = apply(
    rejected.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    3,
  );
  assert.equal(acceptRejected.events.at(-1)?.accepted, false);
  assert.match(acceptRejected.events.at(-1)?.errors.join(" ") ?? "", /rejected; revise/);
  const reopen = apply(
    rejected.graph,
    [{ action: "revise", targetId: "P1", text: "better idea" }],
    "agent_a",
    3,
  );
  assert.equal(reopen.events.at(-1)?.accepted, true);
  assert.equal(reopen.graph.nodes.find((n) => n.id === "P2")?.text, "better idea");
}

{
  const seed = {
    id: "I1",
    type: "issue" as const,
    text: "A",
    createdBy: "agent_a" as const,
    createdAtTurn: 1,
    status: "open" as const,
    parents: ["I2"],
    dependencies: [],
  };
  const cyclicParents: ReasoningGraph = {
    nodes: [
      seed,
      { ...seed, id: "I2", text: "B", parents: ["I1"] },
    ],
    events: [],
  };
  const blocked = apply(cyclicParents, [createProposal("new")]);
  assert.equal(blocked.events.at(-1)?.accepted, false);
  assert.match(blocked.events.at(-1)?.errors.join(" ") ?? "", /parent cycle/);
}

{
  const base = {
    type: "claim" as const,
    createdBy: "agent_a" as const,
    status: "open" as const,
    parents: [],
    dependencies: [],
  };
  const legacy: ReasoningGraph = {
    nodes: [
      { ...base, id: "C1", text: "old", createdAtTurn: 1 },
      {
        ...base,
        id: "C2",
        text: "new",
        createdAtTurn: 2,
        dependencies: ["C1"],
        supersedes: "C1",
      },
    ],
    events: [],
  };
  const fallback = layoutReasoningGraph(legacy);
  assert.equal(
    fallback.edges.some(
      (edge) =>
        edge.kind === "dependency" &&
        edge.from === "C2" &&
        edge.to === "C1",
    ),
    true,
  );
  assert.equal(
    fallback.edges.some(
      (edge) =>
        edge.kind === "supersedes" &&
        edge.from === "C2" &&
        edge.to === "C1",
    ),
    true,
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("answer")]);
  const unknownSupport = apply(created.graph, [], "agent_a", 2, {
    finalAnswer: { text: "42", supportingNodeIds: ["P88"] },
  });
  assert.equal(unknownSupport.finalAnswerSupport?.errors[0], "P88 does not exist");
  assert.equal(
    unknownSupport.events.at(-1)?.errors.join(" "),
    "Supporting-node linkage invalid: P88 does not exist",
  );
  assert.equal(unknownSupport.events.at(-1)?.accepted, false);
  const finalNode = unknownSupport.graph.nodes.find(
    (node) => node.type === "final_answer",
  );
  assert.equal(finalNode?.sourceEventId, unknownSupport.events.at(-1)?.id);
  assert.deepEqual(
    finalNode?.type === "final_answer" ? finalNode.supportingNodeIds : [],
    ["P88"],
  );
  assert.match(
    finalNode?.type === "final_answer" ? finalNode.supportErrors.join(" ") : "",
    /P88 does not exist/,
  );

  const superseded = apply(
    created.graph,
    [{ action: "revise", targetId: "P1", text: "new answer" }],
    "agent_a",
    2,
  );
  const badLink = apply(superseded.graph, [], "agent_a", 3, {
    finalAnswer: { text: "x", supportingNodeIds: ["P1"] },
  });
  assert.match(badLink.finalAnswerSupport?.errors.join(" ") ?? "", /superseded/);

  const rejected = apply(
    created.graph,
    [{ action: "reject", targetId: "P1", reason: "nope" }],
    "agent_a",
    2,
  );
  const rejectedLink = apply(rejected.graph, [], "agent_a", 3, {
    finalAnswer: { text: "x", supportingNodeIds: ["P1"] },
  });
  assert.match(rejectedLink.finalAnswerSupport?.errors.join(" ") ?? "", /rejected/);
}

{
  const atomic = apply(emptyReasoningGraph(), [
    {
      action: "create",
      nodeType: "proposal",
      text: "1A = HUT",
      localId: "oneAcross",
    },
    {
      action: "create",
      nodeType: "proposal",
      text: "3A = MARC; 5A = SEE; 7A = TEN",
    },
    {
      action: "create",
      nodeType: "evidence",
      text: "2D requires U at the crossing",
      localId: "crossing",
    },
    {
      action: "support",
      sourceNodeId: "crossing",
      targetNodeId: "oneAcross",
    },
  ]);
  assert.equal(
    atomic.events.some(
      (event) =>
        !event.accepted &&
        event.errors.some((error) => /alternatives/.test(error)),
    ),
    true,
  );
  const finalized = apply(atomic.graph, [], "agent_a", 3, {
    finalAnswer: {
      text: "ACROSS\n1: HUT\n3: MARC",
      supportingNodeIds: ["P1"],
    },
  });
  const diagnostics = computeReasoningGraphDiagnostics(finalized.graph, {
    turnCount: 3,
    finalAnswer: "ACROSS\n1: HUT\n3: MARC",
  });
  assert.equal(diagnostics.evidenceCount, 1);
  assert.equal(diagnostics.atomicityWarningCount, 0);
  assert.equal(diagnostics.relationshipCount, 1);
  assert.equal(diagnostics.finalSupportingNodeCount, 1);
  // Generic diagnostics only compute coverage from explicit issue attachment;
  // parsing Across/Down answer blocks belongs to the crossword adapter.
  assert.equal(diagnostics.finalSupportCoverage, undefined);

  const layout = layoutReasoningGraph(finalized.graph, { throughTurn: 3 });
  const final = layout.nodes.find((node) => node.id === "__final_answer__");
  const proposal = layout.nodes.find((node) => node.id === "P1");
  assert.equal(final?.turnIndex, 3);
  assert.ok((final?.y ?? 0) > (proposal?.y ?? 0));
  assert.equal(
    layout.edges.some(
      (edge) =>
        edge.kind === "final" &&
        edge.from === "P1" &&
        edge.to === "__final_answer__",
    ),
    true,
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("keep")]);
  const json = created.graph.events.map((event) => JSON.parse(JSON.stringify(event)));
  const parsedEvents = json.map((raw) => parseReasoningEvent(raw));
  assert.equal(parsedEvents.every(Boolean), true);
  const reloaded = hydrateReasoningGraph({
    reasoningNodes: [{ ...created.graph.nodes[0]!, text: "stale cache", status: "accepted" }],
    reasoningEvents: parsedEvents.filter((e) => Boolean(e)),
  });
  assert.equal(reloaded.nodes[0]?.text, "keep");
  assert.equal(reloaded.nodes[0]?.status, "open");
  assert.equal(reloaded.events.length, created.graph.events.length);
}

{
  const low = splitAgentPromptLayers(
    buildAgentPromptPair(
      createCommunicationPolicy({
        trustA: 0.1,
        trustB: 0.1,
        authority: 0.1,
        familiarity: 0.1,
      }),
    ).agentA,
  );
  const high = splitAgentPromptLayers(
    buildAgentPromptPair(
      createCommunicationPolicy({
        trustA: 0.9,
        trustB: 0.9,
        authority: 0.9,
        familiarity: 0.9,
      }),
    ).agentA,
  );
  assert.equal(low.reasoning, high.reasoning);
  assert.match(low.reasoning, /"moves"/);
  assert.match(low.reasoning, /committed idea/);
  assert.match(low.reasoning, /human-readable issue names/);
  assert.match(low.reasoning, /kind":"claim"/);
  assert.match(low.reasoning, /kind":"revise"/);
  assert.match(low.reasoning, /Empty moves are a valid outcome/);
  assert.doesNotMatch(low.reasoning, /One agent's accept does not globally settle/);
  assert.doesNotMatch(low.reasoning, /nodeType/);
  assert.notEqual(low.trust, high.trust);
}

class JsonClient implements ModelClient {
  constructor(private readonly tag: string) {}
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const problemId = input.meta?.problem.id ?? "unknown";
    const turn = input.meta?.turnIndex ?? 1;
    const payload = {
      message:
        turn >= 2
          ? `FINAL_ANSWER: ${this.tag}-${problemId}`
          : `Proposal for ${problemId}`,
      reasoningIntents:
        turn === 1
          ? [
              {
                action: "create",
                nodeType: "proposal",
                text: `${this.tag}:${problemId}`,
                createdBy: "agent_b",
                id: "SPOOF",
                status: "accepted",
              },
            ]
          : [
              {
                action: "accept",
                actor: "agent_a",
                targetId: "P1",
                reason: "locking the proposal",
              },
            ],
      finalAnswer:
        turn >= 2
          ? { text: `${this.tag}-${problemId}`, supportingNodeIds: ["P1"] }
          : undefined,
    };
    return { content: JSON.stringify(payload), provider: "mock" };
  }
}

{
  const subjects = reasoningSubjectsForProblem({
    id: "crossword-subject-test",
    category: "crossword",
    title: "Subject test",
    text: "Puzzle",
    kind: "crossword_puzzle",
    crossword: {
      width: 3,
      height: 1,
      difficulty: "test",
      category: "test",
      grid: ["..."],
      solution: ["EON"],
      source: "crosswordbench",
      sourceId: 1,
      clues: [
        {
          number: 1,
          direction: "across",
          clue: "Long period",
          row: 0,
          col: 0,
          length: 3,
          answer: "EON",
        },
      ],
    },
  });
  assert.deepEqual(
    subjects.map(({ id, label, description }) => ({
      id,
      label,
      description,
    })),
    [
      {
        id: "crossword:across:1",
        label: "Across 1",
        description: "Long period",
      },
    ],
  );
  assert.equal(JSON.stringify(subjects).includes("EON"), false);
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

function problem(id: string, secret: string): Problem {
  return {
    id,
    category: "proof",
    title: `Title ${id}`,
    text: `Solve. TOKEN=${secret}`,
    kind: "generic",
  };
}

const client = new JsonClient("iso");
const [left, right] = await Promise.all([
  runProblem({
    problem: problem("g-a", "SECRET_A"),
    policy,
    config,
    client,
    agentPrompts: prompts,
  }),
  runProblem({
    problem: problem("g-b", "SECRET_B"),
    policy,
    config,
    client,
    agentPrompts: prompts,
  }),
]);

assert.ok(hasStructuredReasoning(left));
assert.ok(hasStructuredReasoning(right));
const leftProposal = left.reasoningNodes?.find((node) => node.id === "P1");
const rightProposal = right.reasoningNodes?.find((node) => node.id === "P1");
assert.equal(leftProposal?.text.includes("g-a"), true);
assert.equal(rightProposal?.text.includes("g-b"), true);
assert.equal(leftProposal?.text.includes("g-b"), false);
assert.equal(rightProposal?.text.includes("g-a"), false);
assert.equal(leftProposal?.createdBy, "agent_a");
assert.deepEqual(left.finalAnswerSupport?.supportingNodeIds, ["P1"]);
assert.deepEqual(left.finalAnswerSupport?.errors, []);
assert.match(left.messages[0]?.content ?? "", /Proposal for g-a/);
assert.ok(left.messages[0]?.rawContent?.includes("reasoningIntents"));
assert.equal(left.stoppedReason, "final_answer");
assert.equal(
  left.reasoningEvents?.some((event) => event.operation.type === "accept" && event.actor === "agent_b"),
  true,
);

const request = buildTurnRequestForAgent({
  agentId: "agent_a",
  agentPrompts: prompts,
  problemText: "P",
  utterances: [],
  turn: 1,
  maxTurns: 8,
  reasoningGraph: emptyReasoningGraph(),
});
assert.ok(
  request.messages.some((m) => m.content.startsWith("CURRENT REASONING STATE")),
);
assert.match(request.messages.at(-1)?.content ?? "", /"moves"/);

const run: ExperimentRun = {
  id: "run-r",
  createdAt: new Date().toISOString(),
  policy,
  agentPrompts: prompts,
  transcriptProtocol: FULL_HISTORY_TRANSCRIPT_PROTOCOL,
  config,
  conversations: [left],
  status: "completed",
};
const exported = serializeConversation(left, run);
assert.equal(exported.schema_version, "1.5");
assert.ok(exported.reasoning);
assert.equal(exported.reasoning.nodes.length, left.reasoningNodes?.length);
assert.ok((exported.reasoning.edges.length ?? 0) >= 1);
assert.ok(exported.reasoning.diagnostics);
assert.ok(exported.messages[0]?.raw_content);
assert.deepEqual(exported.result.supporting_node_ids, ["P1"]);

assert.equal(hasStructuredReasoning({}), false);

console.log(
  "ok — reasoning graph: intent engine, no silent drops, replay, isolation, simplified prompt",
);
