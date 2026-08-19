/**
 * Evaluation view over the live reasoning graph.
 *
 * Does not mutate graph protocol types. Classifies agent-created claims /
 * proposals as ideas and agent-created evidence as axioms, then computes
 * ancestry, adoption, and final-position membership.
 */
import { normalizeNodeText, snapshotBeforeTurn } from "../../reasoning";
import type {
  ReasoningActor,
  ReasoningEdge,
  ReasoningEvent,
  ReasoningGraph,
  ReasoningNode,
} from "../../reasoning/types";
import type { MoralAgentId, MoralIdeaRecord } from "./types";

const JUSTIFICATION_IN: ReadonlySet<string> = new Set(["supports", "grounds"]);
const JUSTIFICATION_OUT: ReadonlySet<string> = new Set([
  "depends_on",
  "revises",
]);

export function isAgent(actor: ReasoningActor | undefined): actor is MoralAgentId {
  return actor === "agent_a" || actor === "agent_b";
}

export function otherAgent(agent: MoralAgentId): MoralAgentId {
  return agent === "agent_a" ? "agent_b" : "agent_a";
}

export function isIdeaNode(node: ReasoningNode): boolean {
  return node.type === "claim" || node.type === "proposal";
}

export function isAxiomNode(node: ReasoningNode): boolean {
  if (node.type !== "evidence") return false;
  if (!isAgent(node.createdBy)) return false;
  if (node.evidenceOrigin === "task") return false;
  const seeded = node.metadata?.seeded;
  if (seeded === true) return false;
  return true;
}

export function isEvaluableNode(node: ReasoningNode): boolean {
  return isIdeaNode(node) || isAxiomNode(node);
}

export function canonicalText(text: string): string {
  return normalizeNodeText(text);
}

export function edgesOf(graph: ReasoningGraph): ReasoningEdge[] {
  return graph.edges ?? [];
}

export function parentIdsOf(
  nodeId: string,
  edges: ReasoningEdge[],
): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (JUSTIFICATION_IN.has(edge.type) && edge.targetNodeId === nodeId) {
      ids.add(edge.sourceNodeId);
    }
    if (JUSTIFICATION_OUT.has(edge.type) && edge.sourceNodeId === nodeId) {
      ids.add(edge.targetNodeId);
    }
  }
  return [...ids];
}

export function childIdsOf(
  nodeId: string,
  edges: ReasoningEdge[],
): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (JUSTIFICATION_IN.has(edge.type) && edge.sourceNodeId === nodeId) {
      ids.add(edge.targetNodeId);
    }
    if (JUSTIFICATION_OUT.has(edge.type) && edge.targetNodeId === nodeId) {
      ids.add(edge.sourceNodeId);
    }
  }
  return [...ids];
}

export function ancestorsOf(
  nodeId: string,
  edges: ReasoningEdge[],
): Set<string> {
  const out = new Set<string>();
  const stack = [...parentIdsOf(nodeId, edges)];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...parentIdsOf(id, edges));
  }
  return out;
}

export function descendantsOf(
  nodeId: string,
  edges: ReasoningEdge[],
): Set<string> {
  const out = new Set<string>();
  const stack = [...childIdsOf(nodeId, edges)];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...childIdsOf(id, edges));
  }
  return out;
}

export function nodeDepth(
  nodeId: string,
  edges: ReasoningEdge[],
  cache = new Map<string, number>(),
  visiting = new Set<string>(),
): number {
  const cached = cache.get(nodeId);
  if (cached !== undefined) return cached;
  if (visiting.has(nodeId)) return 0;
  visiting.add(nodeId);
  const parents = parentIdsOf(nodeId, edges);
  const depth =
    parents.length === 0
      ? 0
      : 1 + Math.max(...parents.map((id) => nodeDepth(id, edges, cache, visiting)));
  visiting.delete(nodeId);
  cache.set(nodeId, depth);
  return depth;
}

export function maxGraphDepth(nodeIds: string[], edges: ReasoningEdge[]): number | null {
  if (nodeIds.length === 0) return null;
  const cache = new Map<string, number>();
  let max = 0;
  for (const id of nodeIds) {
    max = Math.max(max, nodeDepth(id, edges, cache));
  }
  return max;
}

export function meanGraphDepth(nodeIds: string[], edges: ReasoningEdge[]): number | null {
  if (nodeIds.length === 0) return null;
  const cache = new Map<string, number>();
  const sum = nodeIds.reduce((acc, id) => acc + nodeDepth(id, edges, cache), 0);
  return Number((sum / nodeIds.length).toFixed(4));
}

export function branchingFactor(
  nodeIds: string[],
  edges: ReasoningEdge[],
): number | null {
  const withChildren = nodeIds
    .map((id) => childIdsOf(id, edges).length)
    .filter((n) => n > 0);
  if (withChildren.length === 0) return null;
  const sum = withChildren.reduce((acc, n) => acc + n, 0);
  return Number((sum / withChildren.length).toFixed(4));
}

export function finalAnswerNode(graph: ReasoningGraph): ReasoningNode | undefined {
  return graph.nodes.find((node) => node.type === "final_answer");
}

export function finalSeedIds(graph: ReasoningGraph): string[] {
  const final = finalAnswerNode(graph);
  if (final && final.type === "final_answer") {
    return final.supportingNodeIds.filter(Boolean);
  }
  const accepted = graph.nodes.filter(
    (node) =>
      isEvaluableNode(node) &&
      node.status === "accepted",
  );
  if (accepted.length > 0) return accepted.map((node) => node.id);
  return graph.nodes
    .filter(
      (node) =>
        isEvaluableNode(node) &&
        node.status !== "rejected" &&
        node.status !== "superseded",
    )
    .map((node) => node.id);
}

export function finalClosureIds(graph: ReasoningGraph): Set<string> {
  const edges = edgesOf(graph);
  const seeds = finalSeedIds(graph);
  const closure = new Set<string>(seeds);
  for (const seed of seeds) {
    for (const ancestor of ancestorsOf(seed, edges)) closure.add(ancestor);
  }
  return closure;
}

export function eventTouchesNode(
  event: ReasoningEvent,
  nodeId: string,
): boolean {
  const op = event.operation;
  if (op.type === "create") return op.node.id === nodeId;
  if (op.type === "revise") {
    return op.targetId === nodeId || op.replacement.id === nodeId;
  }
  if (op.type === "support" || op.type === "challenge") {
    return op.sourceNodeId === nodeId || op.targetNodeId === nodeId;
  }
  if (op.type === "final_answer") {
    return op.supportingNodeIds.includes(nodeId);
  }
  if ("targetId" in op) return op.targetId === nodeId;
  return false;
}

export function subsequentTurnsFor(
  graph: ReasoningGraph,
  nodeId: string,
  firstTurn: number,
): number[] {
  const turns = new Set<number>();
  for (const event of graph.events) {
    if (event.turnIndex <= firstTurn) continue;
    if (eventTouchesNode(event, nodeId)) turns.add(event.turnIndex);
  }
  return [...turns].sort((a, b) => a - b);
}

export function supportingAgentsOf(
  graph: ReasoningGraph,
  nodeId: string,
  origin: ReasoningActor,
): MoralAgentId[] {
  const agents = new Set<MoralAgentId>();
  for (const event of graph.events) {
    if (!event.accepted) continue;
    if (!isAgent(event.actor) || event.actor === origin) continue;
    const op = event.operation;
    if (
      (op.type === "support" || op.type === "accept") &&
      (("targetId" in op && op.targetId === nodeId) ||
        ("targetNodeId" in op && op.targetNodeId === nodeId))
    ) {
      agents.add(event.actor);
    }
  }
  return [...agents];
}

export function challengingAgentsOf(
  graph: ReasoningGraph,
  nodeId: string,
  origin: ReasoningActor,
): MoralAgentId[] {
  const agents = new Set<MoralAgentId>();
  for (const event of graph.events) {
    if (!event.accepted) continue;
    if (!isAgent(event.actor) || event.actor === origin) continue;
    const op = event.operation;
    if (
      (op.type === "challenge" || op.type === "reject") &&
      (("targetId" in op && op.targetId === nodeId) ||
        ("targetNodeId" in op && op.targetNodeId === nodeId))
    ) {
      agents.add(event.actor);
    }
  }
  return [...agents];
}

export function supersededByOf(
  graph: ReasoningGraph,
  nodeId: string,
): string[] {
  return graph.nodes
    .filter((node) => node.supersedes === nodeId)
    .map((node) => node.id);
}

export function isUnsupported(node: ReasoningNode, parentIds: string[]): boolean {
  return isIdeaNode(node) && parentIds.length === 0;
}

export function isSynthesisNode(
  parentIds: string[],
  originById: Map<string, ReasoningActor>,
): boolean {
  if (parentIds.length < 2) return false;
  const origins = new Set<MoralAgentId>();
  for (const parentId of parentIds) {
    const origin = originById.get(parentId);
    if (isAgent(origin)) origins.add(origin);
  }
  return origins.has("agent_a") && origins.has("agent_b");
}

export function buildCanonicalMap(nodes: ReasoningNode[]): Map<string, string> {
  const firstByText = new Map<string, string>();
  const byId = new Map<string, string>();
  const ordered = [...nodes]
    .filter(isEvaluableNode)
    .sort((a, b) => a.createdAtTurn - b.createdAtTurn || a.id.localeCompare(b.id));
  for (const node of ordered) {
    const key = canonicalText(node.text);
    const existing = firstByText.get(key);
    if (existing) {
      byId.set(node.id, existing);
    } else {
      firstByText.set(key, node.id);
      byId.set(node.id, node.id);
    }
  }
  return byId;
}

export type MoralGraphView = {
  graph: ReasoningGraph;
  ideas: MoralIdeaRecord[];
  byId: Map<string, MoralIdeaRecord>;
  canonicalById: Map<string, string>;
  originById: Map<string, ReasoningActor>;
  finalClosure: Set<string>;
  evaluable: ReasoningNode[];
};

export function buildMoralGraphView(graph: ReasoningGraph): MoralGraphView {
  const edges = edgesOf(graph);
  const evaluable = graph.nodes.filter(isEvaluableNode);
  const originById = new Map<string, ReasoningActor>();
  for (const node of graph.nodes) originById.set(node.id, node.createdBy);
  const canonicalById = buildCanonicalMap(evaluable);
  const finalClosure = finalClosureIds(graph);

  const ideas: MoralIdeaRecord[] = evaluable.map((node) => {
    const parentIds = parentIdsOf(node.id, edges);
    const childIds = childIdsOf(node.id, edges);
    return {
      id: node.id,
      canonicalId: canonicalById.get(node.id) ?? node.id,
      kind: isAxiomNode(node) ? "axiom" : "idea",
      text: node.text,
      originatingAgent: isAgent(node.createdBy) ? node.createdBy : "system",
      firstTurn: node.createdAtTurn,
      subsequentTurns: subsequentTurnsFor(graph, node.id, node.createdAtTurn),
      supportingAgents: supportingAgentsOf(graph, node.id, node.createdBy),
      challengingAgents: challengingAgentsOf(graph, node.id, node.createdBy),
      supersedes: node.supersedes,
      supersededBy: supersededByOf(graph, node.id),
      parentIds,
      childIds,
      inFinalPosition: finalClosure.has(node.id),
      status: node.status,
      confidence: node.confidence,
      unsupported: isUnsupported(node, parentIds),
    };
  });

  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  return {
    graph,
    ideas,
    byId,
    canonicalById,
    originById,
    finalClosure,
    evaluable,
  };
}

export function graphAtOrBeforeTurn(
  graph: ReasoningGraph,
  turn: number,
): ReasoningGraph {
  return snapshotBeforeTurn(graph, turn + 1);
}

export function eventChangedState(event: ReasoningEvent): boolean {
  if (!event.accepted) return false;
  if (event.stateChanged === false) return false;
  if (
    event.diagnostics?.some(
      (item) =>
        item === "no_state_change" || item.startsWith("no_state_change:"),
    )
  ) {
    return false;
  }
  return true;
}

export function operationTargetId(event: ReasoningEvent): string | undefined {
  const op = event.operation;
  if (op.type === "create") return op.node.id;
  if (op.type === "revise") return op.replacement.id;
  if (op.type === "support" || op.type === "challenge") return op.targetNodeId;
  if ("targetId" in op) return op.targetId;
  return undefined;
}

export function createdNodeId(event: ReasoningEvent): string | undefined {
  const op = event.operation;
  if (op.type === "create") return op.node.id;
  if (op.type === "revise") return op.replacement.id;
  return undefined;
}

export function groundingSourceIds(event: ReasoningEvent): string[] {
  const op = event.operation;
  if (op.type === "create" || op.type === "revise") {
    return (op.grounding ?? []).map((link) => link.sourceNodeId);
  }
  if (op.type === "support" && op.sourceNodeId) return [op.sourceNodeId];
  return [];
}
