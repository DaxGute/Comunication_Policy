import type { ReasoningEdge, ReasoningGraph, ReasoningNode } from "./types";

export type LayoutEdgeKind =
  | "parent"
  | "dependency"
  | "supersedes"
  | "final"
  | "answers"
  | "supports"
  | "challenges"
  | "depends_on"
  | "revises"
  | "replaced_by"
  | "grounds";

export type GraphLayoutNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  turnIndex: number;
  depth: number;
  node: ReasoningNode;
};

export type GraphLayoutEdge = {
  from: string;
  to: string;
  kind: LayoutEdgeKind;
};

export type GraphLayout = {
  width: number;
  height: number;
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
  turnBands: GraphLayoutTurnBand[];
};

export type GraphLayoutTurnBand = {
  turnIndex: number;
  y: number;
  nodeY: number;
};

const NODE_W = 176;
const NODE_H = 72;
const ISSUE_W = 200;
const GAP_X = 36;
const TURN_STEP = 148;
const PAD_X = 76;
const PAD_Y = 36;
const SUBJECT_GAP_Y = 104;
const ROOT_CENTER_X = 220;
const ROOT_LANE_STEP = NODE_W + GAP_X * 2;
const MIN_CANVAS_W = 640;
const LOCAL_OFFSET = 28;
const ORPHAN_LANES = 2;

export const LAYOUT_ROOT_CENTER_X = ROOT_CENTER_X;
export const LAYOUT_LANE_STEP = ROOT_LANE_STEP;
export const LAYOUT_ORPHAN_LANES = ORPHAN_LANES;
export const UNASSIGNED_REGION_ID = "__unassigned__";

export type LayoutOptions = {
  /** Include empty chronological bands through the current conversation turn. */
  throughTurn?: number;
  finalAnswer?: {
    text: string;
    supportingNodeIds: string[];
  };
};

function uniqueEdges(edges: GraphLayoutEdge[]): GraphLayoutEdge[] {
  const seen = new Set<string>();
  const out: GraphLayoutEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.kind}:${edge.from}->${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edge);
  }
  return out;
}

function structuralNeighbors(
  node: ReasoningNode,
  nodes: ReasoningNode[],
  edges: ReasoningEdge[],
): string[] {
  const neighbors = new Set([
    ...node.parents,
    ...node.dependencies,
    ...(node.type !== "final_answer" && node.subjectId
      ? [node.subjectId]
      : []),
    ...(node.type !== "final_answer" && node.supersedes
      ? [node.supersedes]
      : []),
  ]);
  for (const candidate of nodes) {
    if (
      candidate.parents.includes(node.id) ||
      candidate.dependencies.includes(node.id) ||
      (candidate.type !== "final_answer" &&
        candidate.subjectId === node.id) ||
      (candidate.type !== "final_answer" && candidate.supersedes === node.id)
    ) {
      neighbors.add(candidate.id);
    }
  }
  for (const edge of edges) {
    if (edge.sourceNodeId === node.id) neighbors.add(edge.targetNodeId);
    if (edge.targetNodeId === node.id) neighbors.add(edge.sourceNodeId);
  }
  return [...neighbors];
}

function placeTurnRow(
  row: ReasoningNode[],
  allNodes: ReasoningNode[],
  positionedById: Map<string, GraphLayoutNode>,
  orphanCursor: { index: number },
  subjectCenters: Map<string, number>,
  orphanOrigin: number,
  y: number,
  edges: ReasoningEdge[],
): GraphLayoutNode[] {
  const rowIds = new Set(row.map((node) => node.id));
  const desiredCenter = new Map<string, number>();
  const attachedIds = new Set<string>();

  for (const node of row) {
    if (node.type !== "final_answer" && node.subjectId) {
      const subjectCenter = subjectCenters.get(node.subjectId);
      if (subjectCenter !== undefined) {
        desiredCenter.set(node.id, subjectCenter);
        attachedIds.add(node.id);
      }
    }
  }

  for (const node of row) {
    if (desiredCenter.has(node.id)) continue;
    const prior = structuralNeighbors(node, allNodes, edges)
      .map((id) => positionedById.get(id))
      .filter((item): item is GraphLayoutNode => Boolean(item));
    if (prior.length > 0) {
      desiredCenter.set(
        node.id,
        prior.reduce((sum, item) => sum + item.x + item.width / 2, 0) /
          prior.length,
      );
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of row) {
      if (desiredCenter.has(node.id) || attachedIds.has(node.id)) continue;
      const relatedCenters = structuralNeighbors(node, allNodes, edges)
        .filter((id) => rowIds.has(id))
        .map((id) => desiredCenter.get(id))
        .filter((value): value is number => value !== undefined);
      if (relatedCenters.length > 0) {
        desiredCenter.set(
          node.id,
          relatedCenters.reduce((sum, value) => sum + value, 0) /
            relatedCenters.length,
        );
        changed = true;
      }
    }
  }

  for (const node of row) {
    if (desiredCenter.has(node.id)) continue;
    const component = new Set<string>([node.id]);
    const queue = [node.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentNode = row.find((candidate) => candidate.id === current);
      if (!currentNode) continue;
      for (const neighbor of structuralNeighbors(currentNode, allNodes, edges)) {
        if (!rowIds.has(neighbor) || component.has(neighbor)) continue;
        if (attachedIds.has(neighbor)) continue;
        component.add(neighbor);
        queue.push(neighbor);
      }
    }
    const center =
      orphanOrigin + (orphanCursor.index % ORPHAN_LANES) * ROOT_LANE_STEP;
    orphanCursor.index += 1;
    for (const id of component) desiredCenter.set(id, center);
  }

  const ordered = [...row].sort((a, b) => {
    const centerDelta =
      (desiredCenter.get(a.id) ?? 0) - (desiredCenter.get(b.id) ?? 0);
    return centerDelta || a.id.localeCompare(b.id);
  });

  const groupSizes = new Map<number, number>();
  for (const node of ordered) {
    const center = Math.round(desiredCenter.get(node.id) ?? 0);
    groupSizes.set(center, (groupSizes.get(center) ?? 0) + 1);
  }
  const groupIndexes = new Map<number, number>();
  const out: GraphLayoutNode[] = [];
  for (const node of ordered) {
    const width =
      node.type === "final_answer"
        ? 280
        : node.type === "issue"
          ? ISSUE_W
          : NODE_W;
    const center = Math.round(desiredCenter.get(node.id) ?? ROOT_CENTER_X);
    const index = groupIndexes.get(center) ?? 0;
    const count = groupSizes.get(center) ?? 1;
    groupIndexes.set(center, index + 1);
    const centeredOffset = (index - (count - 1) / 2) * LOCAL_OFFSET;
    const x = Math.max(PAD_X, center + centeredOffset - width / 2);
    const item: GraphLayoutNode = {
      id: node.id,
      x,
      y,
      width,
      height: NODE_H,
      turnIndex: node.createdAtTurn,
      depth: node.createdAtTurn,
      node,
    };
    out.push(item);
    positionedById.set(node.id, item);
  }
  return out;
}

/**
 * Chronological layout. Canonical node provenance owns the vertical axis;
 * structural relationships influence horizontal lanes only. Final-answer
 * nodes stay in their terminating turn and sit below that turn's reasoning.
 */
export function layoutReasoningGraph(
  graph: ReasoningGraph,
  options: LayoutOptions = {},
): GraphLayout {
  const nodes = [...graph.nodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const turns = new Map<number, ReasoningNode[]>();
  for (const node of nodes) {
    const list = turns.get(node.createdAtTurn) ?? [];
    list.push(node);
    turns.set(node.createdAtTurn, list);
  }

  for (const list of turns.values()) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  const eventTurns = graph.events.map((event) => event.turnIndex);
  const nodeTurns = nodes.map((node) => node.createdAtTurn);
  const allTurns = [...eventTurns, ...nodeTurns].filter(Number.isFinite);
  const minTurn = allTurns.length > 0 ? Math.min(1, ...allTurns) : 1;
  const latestProvenanceTurn =
    allTurns.length > 0 ? Math.max(...allTurns) : minTurn;
  const maxTurn = Math.max(
    latestProvenanceTurn,
    options.throughTurn ?? latestProvenanceTurn,
  );
  const turnBands: GraphLayoutTurnBand[] = [];
  const positioned: GraphLayoutNode[] = [];
  const positionedById = new Map<string, GraphLayoutNode>();
  const subjectCenters = new Map<string, number>();
  const subjects = graph.subjects ?? [];
  for (let index = 0; index < subjects.length; index++) {
    const subject = subjects[index]!;
    const center = ROOT_CENTER_X + index * ROOT_LANE_STEP;
    subjectCenters.set(subject.id, center);
    const synthetic: ReasoningNode = {
      id: subject.id,
      type: "issue",
      text: subject.description ?? subject.label,
      createdBy: "agent_a",
      createdAtTurn: 0,
      status: "open",
      parents: [],
      dependencies: [],
      metadata: {
        ...(subject.metadata ?? {}),
        taskDefined: true,
        subjectLabel: subject.label,
      },
    };
    const item: GraphLayoutNode = {
      id: subject.id,
      x: center - ISSUE_W / 2,
      y: PAD_Y,
      width: ISSUE_W,
      height: NODE_H,
      turnIndex: 0,
      depth: 0,
      node: synthetic,
    };
    positioned.push(item);
    positionedById.set(item.id, item);
  }
  const orphanOrigin =
    subjects.length > 0
      ? ROOT_CENTER_X + subjects.length * ROOT_LANE_STEP
      : ROOT_CENTER_X;
  const orphanCursor = { index: 0 };
  const layoutEdges = graph.edges ?? [];

  for (let turn = minTurn; turn <= maxTurn; turn++) {
    const bandY =
      PAD_Y +
      (subjects.length > 0 ? SUBJECT_GAP_Y : 0) +
      (turn - minTurn) * TURN_STEP;
    const nodeY = bandY + 28;
    turnBands.push({ turnIndex: turn, y: bandY, nodeY });
    positioned.push(
      ...placeTurnRow(
        turns.get(turn) ?? [],
        nodes,
        positionedById,
        orphanCursor,
        subjectCenters,
        orphanOrigin,
        nodeY,
        layoutEdges,
      ),
    );
  }

  const hasOrphans = nodes.some(
    (node) =>
      node.type !== "final_answer" &&
      !(node.subjectId && subjectCenters.has(node.subjectId)),
  );
  if (hasOrphans && subjects.length > 0) {
    const item: GraphLayoutNode = {
      id: UNASSIGNED_REGION_ID,
      x: orphanOrigin - ISSUE_W / 2,
      y: PAD_Y,
      width: ISSUE_W,
      height: NODE_H,
      turnIndex: 0,
      depth: 0,
      node: {
        id: UNASSIGNED_REGION_ID,
        type: "issue",
        text: "Unassigned / emergent reasoning",
        createdBy: "agent_a",
        createdAtTurn: 0,
        status: "open",
        parents: [],
        dependencies: [],
        metadata: { taskDefined: true, subjectLabel: "Unassigned" },
      },
    };
    positioned.push(item);
    positionedById.set(item.id, item);
  }

  const maxNodeRight = positioned.reduce(
    (max, item) => Math.max(max, item.x + item.width),
    0,
  );
  const maxWidth = Math.max(MIN_CANVAS_W, maxNodeRight + PAD_X);
  const embeddedFinal = positioned.find(
    (item) => item.node.type === "final_answer",
  );
  if (embeddedFinal) {
    embeddedFinal.x = (maxWidth - embeddedFinal.width) / 2;
    embeddedFinal.y += NODE_H + 24;
  }
  const heightWithoutFinal =
    positioned.length > 0
      ? Math.max(...positioned.map((item) => item.y + item.height)) + PAD_Y
      : 220;

  const edges: GraphLayoutEdge[] = [];
  if ((graph.edges?.length ?? 0) === 0) {
    for (const node of nodes) {
      for (const parentId of node.parents) {
        if (byId.has(parentId)) {
          edges.push({ from: parentId, to: node.id, kind: "parent" });
        }
      }
      for (const depId of node.dependencies) {
        if (byId.has(depId)) {
          edges.push({ from: node.id, to: depId, kind: "dependency" });
        }
      }
      if (
        node.type !== "final_answer" &&
        node.subjectId &&
        positionedById.has(node.subjectId)
      ) {
        edges.push({ from: node.id, to: node.subjectId, kind: "answers" });
      }
      if (
        node.type !== "final_answer" &&
        node.supersedes &&
        byId.has(node.supersedes)
      ) {
        edges.push({ from: node.id, to: node.supersedes, kind: "supersedes" });
      }
    }
  }
  for (const edge of graph.edges ?? []) {
    edges.push({
      from: edge.sourceNodeId,
      to: edge.targetNodeId,
      kind:
        edge.targetNodeId === "__final_answer__" ? "final" : edge.type,
    });
  }

  let width = maxWidth;
  let height = heightWithoutFinal;

  const finalAnswer = options.finalAnswer;
  if (finalAnswer?.text && !byId.has("__final_answer__")) {
    const finalId = "__final_answer__";
    const finalWidth = Math.min(280, Math.max(ISSUE_W, maxWidth * 0.35));
    const finalY = heightWithoutFinal + 8;
    const finalX = (maxWidth - finalWidth) / 2;
    const synthetic: ReasoningNode = {
      id: finalId,
      type: "final_answer",
      text: finalAnswer.text,
      createdBy: "agent_a",
      createdAtTurn: maxTurn,
      sourceMessageId: `legacy-final-turn-${maxTurn}`,
      sourceEventId: `legacy-final-turn-${maxTurn}`,
      status: "accepted",
      parents: [...finalAnswer.supportingNodeIds],
      dependencies: [],
      supportingNodeIds: [...finalAnswer.supportingNodeIds],
      supportErrors: [],
    };
    const layoutNode: GraphLayoutNode = {
      id: finalId,
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: NODE_H,
      turnIndex: maxTurn,
      depth: maxTurn,
      node: synthetic,
    };
    positioned.push(layoutNode);
    height = finalY + NODE_H + PAD_Y;
    for (const id of finalAnswer.supportingNodeIds) {
      const support = byId.get(id);
      if (
        positionedById.has(id) &&
        support &&
        support.status !== "rejected" &&
        support.status !== "superseded"
      ) {
        edges.push({ from: id, to: finalId, kind: "final" });
      }
    }
  }

  if (positioned.length === 0) {
    return { width: 420, height: 220, nodes: [], edges: [], turnBands: [] };
  }

  return {
    width: Math.max(width, 360),
    height: Math.max(height, 220),
    nodes: positioned,
    edges: uniqueEdges(edges),
    turnBands,
  };
}
