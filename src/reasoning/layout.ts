import type { ReasoningGraph, ReasoningNode } from "./types";

export type LayoutEdgeKind = "parent" | "dependency" | "supersedes" | "final";

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
const ROOT_CENTER_X = 220;
const ROOT_LANE_STEP = NODE_W + GAP_X * 2;
const MIN_CANVAS_W = 640;

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
): string[] {
  const neighbors = new Set([
    ...node.parents,
    ...node.dependencies,
    ...(node.supersedes ? [node.supersedes] : []),
  ]);
  for (const candidate of nodes) {
    if (
      candidate.parents.includes(node.id) ||
      candidate.dependencies.includes(node.id) ||
      candidate.supersedes === node.id
    ) {
      neighbors.add(candidate.id);
    }
  }
  return [...neighbors];
}

function placeTurnRow(
  row: ReasoningNode[],
  allNodes: ReasoningNode[],
  positionedById: Map<string, GraphLayoutNode>,
  nextRootCenter: { value: number },
  y: number,
): GraphLayoutNode[] {
  const rowIds = new Set(row.map((node) => node.id));
  const desiredCenter = new Map<string, number>();

  for (const node of row) {
    const prior = structuralNeighbors(node, allNodes)
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

  // Propagate a known semantic lane through relationships created in this
  // same turn. Remaining components receive a stable new lane.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of row) {
      if (desiredCenter.has(node.id)) continue;
      const relatedCenters = structuralNeighbors(node, allNodes)
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
      for (const neighbor of structuralNeighbors(currentNode, allNodes)) {
        if (!rowIds.has(neighbor) || component.has(neighbor)) continue;
        component.add(neighbor);
        queue.push(neighbor);
      }
    }
    const center = nextRootCenter.value;
    nextRootCenter.value += ROOT_LANE_STEP;
    for (const id of component) desiredCenter.set(id, center);
  }

  const ordered = [...row].sort((a, b) => {
    const centerDelta =
      (desiredCenter.get(a.id) ?? 0) - (desiredCenter.get(b.id) ?? 0);
    return centerDelta || a.id.localeCompare(b.id);
  });

  // Start each equal-anchor group around its semantic center, then sweep once
  // for collision avoidance. Y remains identical for the whole turn.
  const groupSizes = new Map<number, number>();
  for (const node of ordered) {
    const center = Math.round(desiredCenter.get(node.id) ?? 0);
    groupSizes.set(center, (groupSizes.get(center) ?? 0) + 1);
  }
  const groupIndexes = new Map<number, number>();
  let rightEdge = PAD_X - GAP_X;
  const out: GraphLayoutNode[] = [];
  for (const node of ordered) {
    const width = node.type === "issue" ? ISSUE_W : NODE_W;
    const center = Math.round(desiredCenter.get(node.id) ?? ROOT_CENTER_X);
    const index = groupIndexes.get(center) ?? 0;
    const count = groupSizes.get(center) ?? 1;
    groupIndexes.set(center, index + 1);
    const centeredOffset = (index - (count - 1) / 2) * (NODE_W + GAP_X);
    const x = Math.max(
      PAD_X,
      rightEdge + GAP_X,
      center + centeredOffset - width / 2,
    );
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
    rightEdge = x + width;
  }
  return out;
}

/**
 * Chronological layout. Canonical node provenance owns the vertical axis;
 * structural relationships influence horizontal lanes only. A synthetic
 * FINAL node is layout-only and is not persisted.
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
  const nextRootCenter = { value: ROOT_CENTER_X };

  for (let turn = minTurn; turn <= maxTurn; turn++) {
    const bandY = PAD_Y + (turn - minTurn) * TURN_STEP;
    const nodeY = bandY + 28;
    turnBands.push({ turnIndex: turn, y: bandY, nodeY });
    positioned.push(
      ...placeTurnRow(
        turns.get(turn) ?? [],
        nodes,
        positionedById,
        nextRootCenter,
        nodeY,
      ),
    );
  }

  const maxNodeRight = positioned.reduce(
    (max, item) => Math.max(max, item.x + item.width),
    0,
  );
  const maxWidth = Math.max(MIN_CANVAS_W, maxNodeRight + PAD_X);
  const heightWithoutFinal =
    turnBands.length > 0
      ? turnBands[turnBands.length - 1]!.nodeY + NODE_H + PAD_Y
      : 220;

  const edges: GraphLayoutEdge[] = [];
  for (const node of nodes) {
    for (const parentId of node.parents) {
      if (byId.has(parentId)) {
        edges.push({ from: parentId, to: node.id, kind: "parent" });
      }
    }
    for (const depId of node.dependencies) {
      if (byId.has(depId)) {
        edges.push({ from: depId, to: node.id, kind: "dependency" });
      }
    }
    if (node.supersedes && byId.has(node.supersedes)) {
      edges.push({ from: node.supersedes, to: node.id, kind: "supersedes" });
    }
  }

  let width = maxWidth;
  let height = heightWithoutFinal;

  const finalAnswer = options.finalAnswer;
  if (finalAnswer?.text) {
    const finalId = "__final_answer__";
    const finalWidth = Math.min(280, Math.max(ISSUE_W, maxWidth * 0.35));
    const finalY = heightWithoutFinal + 8;
    const finalX = (maxWidth - finalWidth) / 2;
    const synthetic: ReasoningNode = {
      id: finalId,
      type: "claim",
      text: finalAnswer.text,
      createdBy: "agent_a",
      createdAtTurn: 0,
      status: "accepted",
      parents: [...finalAnswer.supportingNodeIds],
      dependencies: [],
    };
    const layoutNode: GraphLayoutNode = {
      id: finalId,
      x: finalX,
      y: finalY,
      width: finalWidth,
      height: NODE_H,
      turnIndex: maxTurn + 1,
      depth: maxTurn + 1,
      node: synthetic,
    };
    positioned.push(layoutNode);
    height = finalY + NODE_H + PAD_Y;
    const supports =
      finalAnswer.supportingNodeIds.length > 0
        ? finalAnswer.supportingNodeIds
        : nodes.filter((n) => n.status === "accepted").map((n) => n.id);
    for (const id of supports) {
      if (positionedById.has(id)) {
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
