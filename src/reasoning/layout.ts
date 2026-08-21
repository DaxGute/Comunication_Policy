/**
 * Subject-lane, time-left-to-right layout for the provenance DAG.
 * Only `revises` and `derived_from` edges are drawn in the kernel.
 * Final-synthesis geometry is inspector overlay, not a canonical edge kind.
 */
import type { AgentId } from "../agents/types";
import { provenanceEdges } from "./provenance";
import { subjectDisplayTitle } from "./ids";
import type {
  PropositionVersion,
  ProvenanceEdgeKind,
  ReasoningActor,
  ReasoningGraph,
  ReasoningSubject,
  ReasoningSubjectSource,
} from "./types";

export type LayoutEdgeKind = ProvenanceEdgeKind | "final_synthesis";

export type GraphLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  turnIndex: number;
  depth: number;
  kind: "version";
  subjectId: string;
  version: PropositionVersion;
  subject?: ReasoningSubject;
  laneIndex: number;
};

export type GraphLayoutEdge = {
  from: string;
  to: string;
  kind: LayoutEdgeKind;
  declaredBy?: string;
  turnIndex?: number;
};

export type GraphLayoutLane = {
  subjectId: string;
  label: string;
  y: number;
  height: number;
  source?: ReasoningSubjectSource;
  createdAtTurn?: number;
  createdBy?: ReasoningActor;
};

export type GraphLayoutTurnBand = {
  turnIndex: number;
  x: number;
  nodeX: number;
  width: number;
  agentId?: AgentId;
  persistentChange?: boolean;
};

export type GraphLayoutFinalSynthesis = {
  x: number;
  y: number;
  width: number;
  height: number;
  turnIndex: number;
  declared: boolean;
  basisVersionIds: string[];
};

export type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  lanes: GraphLayoutLane[];
  turnBands: GraphLayoutTurnBand[];
  finalSynthesis?: GraphLayoutFinalSynthesis;
};

export type LayoutTurnSpec = {
  turnIndex: number;
  agentId?: AgentId;
  persistentChange?: boolean;
};

export type ReasoningGraphLayoutOptions = {
  currentStateOnly?: boolean;
  agentFilter?: "all" | "agent_a" | "agent_b";
  edgeFilter?: "all" | "revises" | "derived_from";
  statusFilter?: "all" | "active" | "superseded" | "removed";
  subjectId?: string;
  turnMin?: number;
  turnMax?: number;
  /** When set, every listed turn gets a column, including zero-change turns. */
  turns?: LayoutTurnSpec[];
  finalSynthesis?: {
    turnIndex?: number;
    declared?: boolean;
    basisVersionIds?: string[];
  };
};

const NODE_W = 188;
const NODE_H = 78;
const GAP_X = 56;
const ROW_H = 148;
const LANE_LABEL_W = 196;
const PAD_X = 24;
const TURN_HEADER_H = 52;
const SYNTHESIS_H = 96;
const SYNTHESIS_GAP = 28;

export const LAYOUT_ROOT_CENTER_X = LANE_LABEL_W + PAD_X + NODE_W / 2;
export const LAYOUT_LANE_STEP = NODE_W + GAP_X;
export const LAYOUT_ORPHAN_LANES = 0;
export const UNASSIGNED_REGION_ID = "__unassigned__";

function subjectList(graph: ReasoningGraph): ReasoningSubject[] {
  if (graph.subjects.length > 0) return graph.subjects;
  return [...new Set(graph.versions.map((version) => version.subjectId))].map(
    (id) => ({ id, source: "agent" as const }),
  );
}

function visibleVersions(
  graph: ReasoningGraph,
  options: ReasoningGraphLayoutOptions,
): PropositionVersion[] {
  let versions = graph.versions;
  if (options.subjectId) {
    versions = versions.filter((version) => version.subjectId === options.subjectId);
  }
  if (options.agentFilter && options.agentFilter !== "all") {
    versions = versions.filter((version) => version.agentId === options.agentFilter);
  }
  if (options.statusFilter && options.statusFilter !== "all") {
    versions = versions.filter((version) => version.status === options.statusFilter);
  }
  if (options.turnMin !== undefined) {
    versions = versions.filter((version) => version.turn >= options.turnMin!);
  }
  if (options.turnMax !== undefined) {
    versions = versions.filter((version) => version.turn <= options.turnMax!);
  }
  if (options.currentStateOnly) {
    const active = new Set(
      versions.filter((version) => version.status === "active").map((version) => version.id),
    );
    const keep = new Set(active);
    for (const version of graph.versions) {
      if (!active.has(version.id)) continue;
      for (const sourceId of version.derivedFromVersionIds ?? []) keep.add(sourceId);
    }
    versions = graph.versions.filter((version) => keep.has(version.id));
    if (options.subjectId) {
      versions = versions.filter(
        (version) => version.subjectId === options.subjectId || keep.has(version.id),
      );
    }
  }
  return versions;
}

export function layoutReasoningGraph(
  graph: ReasoningGraph,
  options: ReasoningGraphLayoutOptions = {},
): GraphLayout {
  const visible = visibleVersions(graph, options);
  const visibleIds = new Set(visible.map((version) => version.id));
  const subjects = subjectList(graph).filter(
    (subject) =>
      visible.some((version) => version.subjectId === subject.id) ||
      (!options.currentStateOnly &&
        !options.subjectId &&
        graph.subjects.some(
          (item) => item.id === subject.id && item.source === "task",
        )),
  );
  const subjectIndex = new Map(subjects.map((subject, index) => [subject.id, index]));
  const extra = [
    ...new Set(
      visible
        .map((version) => version.subjectId)
        .filter((id) => !subjectIndex.has(id)),
    ),
  ];
  extra.forEach((id) => {
    subjectIndex.set(id, subjects.length);
    subjects.push({ id, source: "agent" });
  });

  const turnSpecs: LayoutTurnSpec[] =
    options.turns && options.turns.length > 0
      ? [...options.turns].sort((a, b) => a.turnIndex - b.turnIndex)
      : [...new Set(visible.map((version) => version.turn))]
          .sort((a, b) => a - b)
          .map((turnIndex) => ({ turnIndex }));
  const turns = turnSpecs.map((item) => item.turnIndex);
  const turnIndex = new Map(turns.map((turn, index) => [turn, index]));
  const occupancy = new Map<string, number>();
  const padY = TURN_HEADER_H + 12;

  const nodes: GraphLayoutNode[] = [];
  let maxX = LANE_LABEL_W + 320;
  for (const version of visible) {
    const lane = subjectIndex.get(version.subjectId) ?? 0;
    const col = turnIndex.get(version.turn) ?? turns.length;
    const key = `${lane}:${col}`;
    const stack = occupancy.get(key) ?? 0;
    occupancy.set(key, stack + 1);
    const x = LANE_LABEL_W + PAD_X + col * (NODE_W + GAP_X);
    const y = padY + lane * ROW_H + stack * 18;
    nodes.push({
      id: version.id,
      x,
      y,
      width: NODE_W,
      height: NODE_H,
      turnIndex: version.turn,
      depth: col + 1,
      kind: "version",
      subjectId: version.subjectId,
      version,
      subject: subjects[lane],
      laneIndex: lane,
    });
    maxX = Math.max(maxX, x + NODE_W + PAD_X);
  }
  if (turns.length > 0) {
    maxX = Math.max(
      maxX,
      LANE_LABEL_W + PAD_X + turns.length * (NODE_W + GAP_X),
    );
  }

  const edgeKind = options.edgeFilter ?? "all";
  const edges: GraphLayoutEdge[] = [];
  for (const edge of provenanceEdges(graph)) {
    if (edgeKind !== "all" && edge.kind !== edgeKind) continue;
    if (options.currentStateOnly && edge.kind === "revises") continue;
    if (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)) continue;
    const target = graph.versions.find((version) => version.id === edge.to);
    edges.push({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      declaredBy: target?.agentId,
      turnIndex: target?.turn,
    });
  }

  const lanes: GraphLayoutLane[] = subjects.map((subject, index) => ({
    subjectId: subject.id,
    label: subjectDisplayTitle(subject),
    y: padY + index * ROW_H - 16,
    height: ROW_H,
    source: subject.source,
    createdAtTurn: subject.createdAtTurn,
    createdBy: subject.createdBy,
  }));

  const turnBands: GraphLayoutTurnBand[] = turnSpecs.map((spec, index) => ({
    turnIndex: spec.turnIndex,
    x: LANE_LABEL_W + PAD_X + index * (NODE_W + GAP_X),
    nodeX: LANE_LABEL_W + PAD_X + index * (NODE_W + GAP_X),
    width: NODE_W,
    agentId: spec.agentId,
    persistentChange: spec.persistentChange,
  }));

  let finalSynthesis: GraphLayoutFinalSynthesis | undefined;
  const laneBottom =
    subjects.length > 0
      ? padY + subjects.length * ROW_H
      : padY + ROW_H;
  if (options.finalSynthesis && (options.edgeFilter ?? "all") === "all") {
    const finalTurn =
      options.finalSynthesis.turnIndex ??
      turns[turns.length - 1] ??
      1;
    const col = turnIndex.get(finalTurn) ?? Math.max(0, turns.length - 1);
    const boxX = LANE_LABEL_W + 8;
    const boxY = laneBottom + SYNTHESIS_GAP;
    const boxW = Math.max(320, maxX - boxX - 16);
    finalSynthesis = {
      x: boxX,
      y: boxY,
      width: boxW,
      height: SYNTHESIS_H,
      turnIndex: finalTurn,
      declared: options.finalSynthesis.declared === true,
      basisVersionIds: options.finalSynthesis.basisVersionIds ?? [],
    };
    for (const versionId of finalSynthesis.basisVersionIds) {
      if (!visibleIds.has(versionId) && !graph.versions.some((item) => item.id === versionId)) {
        continue;
      }
      edges.push({
        from: versionId,
        to: "__final_synthesis__",
        kind: "final_synthesis",
        turnIndex: finalTurn,
      });
    }
    void col;
  }

  const height = Math.max(
    280,
    (finalSynthesis ? finalSynthesis.y + finalSynthesis.height + 24 : laneBottom + 24),
  );
  return {
    width: Math.max(640, maxX),
    height,
    nodes,
    edges,
    lanes,
    turnBands,
    finalSynthesis,
  };
}
