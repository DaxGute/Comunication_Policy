/**
 * Crossword lineage / recovery: subject targeting, candidate identity,
 * historical replaced_by, task compatibility, and stable issue lanes.
 *
 * Run: npm run test:lineage
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair, splitAgentPromptLayers } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import {
  crosswordReasoningAdapter,
  deriveCrosswordCandidateLedger,
  deriveCrosswordConflicts,
} from "../src/problems/adapters/crosswordAdapter";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningIntents,
  computeReasoningGraphDiagnostics,
  emptyReasoningGraph,
  LAYOUT_LANE_STEP,
  LAYOUT_ORPHAN_LANES,
  LAYOUT_ROOT_CENTER_X,
  layoutReasoningGraph,
  parseReasoningEvent,
  resolveKnownSubjectId,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";
import { formatReasoningState } from "../src/reasoning/renderState";

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
  intents: ReasoningIntent[],
  actor: "agent_a" | "agent_b" = "agent_a",
  turn = 1,
) {
  return applyReasoningIntents(graph, intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    candidateIdentity: (node) =>
      crosswordReasoningAdapter.candidateIdentity?.(crosswordProblem, node),
    validateCandidate: (node) =>
      crosswordReasoningAdapter.validateCandidate?.(crosswordProblem, node) ?? {
        ok: true,
      },
    conflicts: crosswordReasoningAdapter.deriveConflicts?.(
      crosswordProblem,
      graph,
    ),
  });
}

const issues = crosswordReasoningAdapter.getInitialIssues(crosswordProblem);
const empty = emptyReasoningGraph(issues);

{
  const state = formatReasoningState(empty);
  assert.match(state, /ID: crossword:across:1/);
  assert.match(state, /Across 1/);
  assert.match(state, /CLUE: "Two Years Before the Mast" author/);
  assert.match(state, /Refer to issues by their labels/);
  assert.doesNotMatch(state, /crossword:across:1 — Across 1/);
}

{
  const known = issues.map((issue) => issue.id);
  assert.deepEqual(
    resolveKnownSubjectId(
      'crossword:across:1 — Across 1: "Two Years Before the Mast" author',
      known,
    ),
    {
      id: "crossword:across:1",
      normalizedFrom:
        'crossword:across:1 — Across 1: "Two Years Before the Mast" author',
    },
  );
  const normalized = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId:
        'crossword:across:1 — Across 1: "Two Years Before the Mast" author',
    },
  ]);
  assert.equal(normalized.events[0]?.accepted, true);
  assert.equal(
    normalized.graph.nodes[0]?.subjectId,
    "crossword:across:1",
  );
  assert.match(
    normalized.events[0]?.diagnostics?.join(" ") ?? "",
    /normalized subjectId/,
  );

  const human = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "Across 1",
    },
  ]);
  assert.equal(human.events[0]?.accepted, true);
  assert.equal(human.graph.nodes[0]?.subjectId, "crossword:across:1");

  const ambiguous = resolveKnownSubjectId("crossword:across:1 — maybe", [
    "crossword:across:1",
    "crossword:across:10",
  ]);
  assert.equal(ambiguous.id, "crossword:across:1");
  const unknown = resolveKnownSubjectId("totally-unknown — label", known);
  assert.equal(unknown.id, undefined);
}

{
  const first = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const second = apply(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = CB",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_b",
    2,
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
  assert.equal(
    second.graph.edges?.some((edge) => edge.type === "revises"),
    false,
  );
  const ledger = deriveCrosswordCandidateLedger(crosswordProblem, second.graph);
  const across = ledger.find((item) => item.issueId === "crossword:across:1")!;
  assert.deepEqual(
    across.liveCandidates.map((candidate) => candidate.normalizedAnswer),
    ["AB", "CB"],
  );
  assert.deepEqual(across.triedAnswers, ["AB", "CB"]);
  const state = formatReasoningState(
    second.graph,
    undefined,
    ledger,
  );
  assert.match(state, /CURRENT LIVE CANDIDATES/);
  assert.match(state, /currentCandidate: CB/);
  assert.match(state, /AB:/);
  assert.match(state, /CB:/);
  assert.match(state, /TRIED ANSWERS/);
  assert.match(state, /TASK COMPATIBILITY/);
  assert.doesNotMatch(
    state.split("CURRENT ISSUE STATE")[1]?.split("AVAILABLE ISSUES")[0] ?? "",
    /LIVE CLAIMS: C1, C2/,
  );
}

{
  const explicit = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const revised = apply(
    explicit.graph,
    [
      {
        action: "revise",
        targetId: "C1",
        text: "Across 1 = CB",
        subjectId: "crossword:across:1",
        reason: "crossing requires C",
      },
    ],
    "agent_a",
    2,
  );
  assert.equal(
    revised.graph.edges?.some(
      (edge) =>
        edge.type === "revises" &&
        edge.sourceNodeId === "C2" &&
        edge.targetNodeId === "C1",
    ),
    true,
  );
  assert.equal(
    revised.graph.edges?.some(
      (edge) =>
        edge.type === "replaced_by" &&
        edge.sourceNodeId === "C1" &&
        edge.targetNodeId === "C2",
    ),
    true,
  );
}

{
  const first = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const variant = apply(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 is AB",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(variant.events.at(-1)?.accepted, true);
  assert.equal(variant.events.at(-1)?.stateChanged, false);
  assert.match(variant.events.at(-1)?.diagnostics?.join(" ") ?? "", /no_state_change/);
  assert.equal(variant.graph.nodes.length, 1);
}

{
  const created = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const replaced = apply(
    created.graph,
    [
      {
        action: "revise",
        targetId: "C1",
        text: "Across 1 = CB",
        reason: "crossing forbids A",
      },
    ],
    "agent_b",
    2,
  );
  const revisited = apply(
    replaced.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "I think Across 1 is AB",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_a",
    8,
  );
  assert.equal(revisited.events.at(-1)?.accepted, true);
  assert.equal(revisited.events.at(-1)?.stateChanged, false);
  assert.equal(revisited.graph.nodes.filter((node) => node.type === "claim").length, 2);
  assert.match(
    revisited.events.at(-1)?.diagnostics?.join(" ") ?? "",
    /no_state_change/,
  );
  assert.match(
    revisited.events.at(-1)?.diagnostics?.join(" ") ?? "",
    /already tried/,
  );
  const ledger = deriveCrosswordCandidateLedger(crosswordProblem, revisited.graph);
  const across = ledger.find((item) => item.issueId === "crossword:across:1")!;
  assert.equal(
    across.liveCandidates.some((candidate) => candidate.normalizedAnswer === "AB"),
    false,
  );
  assert.equal(
    across.previousCandidates.some((candidate) => candidate.normalizedAnswer === "AB"),
    true,
  );
  const state = formatReasoningState(revisited.graph, undefined, ledger);
  assert.match(state, /PREVIOUSLY ATTEMPTED/);
}

{
  const graph = apply(empty, [
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
  ]).graph;
  const conflicts = deriveCrosswordConflicts(crosswordProblem, graph);
  assert.ok(conflicts.length > 0);
  const ledger = deriveCrosswordCandidateLedger(crosswordProblem, graph);
  assert.equal(
    ledger.every((item) =>
      item.liveCandidates.some((candidate) => candidate.compatibility === "incompatible"),
    ),
    true,
  );
  assert.equal(
    graph.nodes.every((node) => node.status !== "rejected"),
    true,
  );
  const state = formatReasoningState(
    graph,
    undefined,
    ledger,
  );
  assert.match(state, /UNRESOLVED CONFLICT/);
  assert.match(state, /conflicts with/);
  assert.match(
    state,
    /Resolve this contradiction through challenge, rejection, revision/,
  );

  const extra = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = XX",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_a",
    2,
  );
  assert.equal(extra.events.at(-1)?.accepted, true);
  assert.match(
    extra.events.at(-1)?.diagnostics?.join(" ") ?? "",
    /unresolved conflict/,
  );
}

{
  let graph = empty;
  graph = apply(graph, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]).graph;
  const orphans: ReasoningIntent[] = Array.from({ length: 8 }, (_, index) => ({
    action: "create" as const,
    nodeType: "evidence" as const,
    text: `orphan note ${index + 1}`,
  }));
  graph = apply(graph, orphans, "agent_b", 8).graph;
  graph = apply(
    graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = CB",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_a",
    15,
  ).graph;
  const layout = layoutReasoningGraph(graph);
  const subject = layout.nodes.find((node) => node.id === "crossword:across:1")!;
  const c1 = layout.nodes.find((node) => node.id === "C1")!;
  const c2 = layout.nodes.find((node) => node.id === "C2")!;
  const subjectCenter = subject.x + subject.width / 2;
  assert.equal(c1.x + c1.width / 2, subjectCenter);
  assert.equal(c2.x + c2.width / 2, subjectCenter);
  assert.ok(Math.abs(c1.x + c1.width / 2 - LAYOUT_ROOT_CENTER_X) < 1);
  const spread = Math.abs(c2.x + c2.width / 2 - (c1.x + c1.width / 2));
  assert.ok(spread < LAYOUT_LANE_STEP / 2);
}

{
  const mixed = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
    ...Array.from({ length: 12 }, (_, index) => ({
      action: "create" as const,
      nodeType: "evidence" as const,
      text: `same-turn orphan ${index + 1}`,
    })),
  ]);
  const layout = layoutReasoningGraph(mixed.graph);
  const attached = layout.nodes.find((node) => node.id === "C1")!;
  const subject = layout.nodes.find((node) => node.id === "crossword:across:1")!;
  assert.equal(
    attached.x + attached.width / 2,
    subject.x + subject.width / 2,
  );
}

{
  let graph = emptyReasoningGraph();
  for (let turn = 1; turn <= 12; turn++) {
    graph = apply(graph, [
      {
        action: "create",
        nodeType: "claim",
        text: `orphan hypothesis ${turn}`,
      },
    ], "agent_a", turn).graph;
  }
  const layout = layoutReasoningGraph(graph);
  const xs = layout.nodes
    .filter((node) => node.node.type === "claim")
    .map((node) => node.x);
  const spread = Math.max(...xs) - Math.min(...xs);
  assert.ok(spread <= LAYOUT_ORPHAN_LANES * LAYOUT_LANE_STEP);
}

{
  const created = apply(empty, [
    {
      action: "create",
      nodeType: "evidence",
      text: "crossing requires C",
      localId: "ev",
    },
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const stanceOnly = apply(
    created.graph,
    [{ action: "challenge", targetId: "C1", reason: "I doubt C1" }],
    "agent_b",
    2,
  );
  assert.equal(
    stanceOnly.graph.edges?.some((edge) => edge.type === "challenges"),
    false,
  );
  const withSource = apply(
    created.graph,
    [
      {
        action: "challenge",
        sourceNodeId: "E1",
        targetNodeId: "C1",
      },
    ],
    "agent_b",
    2,
  );
  assert.equal(
    withSource.graph.edges?.some(
      (edge) =>
        edge.type === "challenges" &&
        edge.sourceNodeId === "E1" &&
        edge.targetNodeId === "C1",
    ),
    true,
  );
  const layout = layoutReasoningGraph(withSource.graph);
  assert.equal(
    layout.edges.some((edge) => edge.kind === "challenges"),
    true,
  );
  assert.equal(
    layout.edges.some((edge) => edge.kind === "replaced_by") ||
      withSource.graph.edges?.some((edge) => edge.type === "replaced_by") === false,
    true,
  );
}

{
  const first = apply(empty, [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const second = apply(
    first.graph,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Across 1 = CB",
        subjectId: "crossword:across:1",
      },
    ],
    "agent_b",
    4,
  );
  const layout = layoutReasoningGraph(second.graph);
  assert.equal(
    layout.edges.some(
      (edge) =>
        edge.kind === "replaced_by" &&
        edge.from === "C1" &&
        edge.to === "C2",
    ),
    true,
  );
  const diagnostics = computeReasoningGraphDiagnostics(second.graph, {
    turnCount: 4,
  });
  assert.ok((diagnostics.subjectAttachmentRate ?? 0) > 0.9);
  assert.equal(diagnostics.candidateTransitionsWithReplacedBy, 1);
  assert.ok((diagnostics.crossTurnEdgeRate ?? 0) > 0);
  assert.equal(diagnostics.meanSameIssueXSpread, 0);
}

{
  const legacy = parseReasoningEvent({
    id: "rev-1",
    seq: 1,
    turnIndex: 1,
    messageId: "msg-1",
    actor: "agent_a",
    accepted: true,
    errors: [],
    operation: {
      type: "create",
      node: {
        id: "C1",
        type: "claim",
        text: "old claim",
        createdBy: "agent_a",
        createdAtTurn: 1,
        status: "open",
        parents: [],
        dependencies: [],
        subjectId: "crossword:across:1",
      },
    },
  });
  assert.equal(legacy?.accepted, true);
  assert.equal(legacy?.diagnostics, undefined);
  assert.equal(
    legacy && "replacedActiveNodeId" in legacy.operation
      ? legacy.operation.replacedActiveNodeId
      : undefined,
    undefined,
  );
}

{
  const layers = splitAgentPromptLayers(
    buildAgentPromptPair(createCommunicationPolicy({
      trustA: 0.5,
      trustB: 0.5,
      authority: 0.5,
      familiarity: 0.5,
    })).agentA,
  );
  assert.match(layers.reasoning, /human-readable issue names/);
  assert.match(layers.reasoning, /"moves"/);
  assert.match(layers.reasoning, /kind":"revise"/);
  assert.doesNotMatch(layers.reasoning, /solve faster|turn 20|turn target/i);
}

{
  const left = apply(emptyReasoningGraph(issues), [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = AB",
      subjectId: "crossword:across:1",
    },
  ]);
  const right = apply(emptyReasoningGraph(issues), [
    {
      action: "create",
      nodeType: "claim",
      text: "Across 1 = CB",
      subjectId: "crossword:across:1",
    },
  ]);
  assert.equal(left.graph.nodes[0]?.text, "Across 1 = AB");
  assert.equal(right.graph.nodes[0]?.text, "Across 1 = CB");
  assert.equal(left.graph.nodes[0]?.id, "C1");
  assert.equal(right.graph.nodes[0]?.id, "C1");
}

console.log("ok — lineage recovery");
