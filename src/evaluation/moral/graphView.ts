/**
 * Evaluation view over canonical versioned state.
 * Derived only — never rewrites conversation history.
 */
import { snapshotBeforeTurn } from "../../reasoning";
import { isStateChangeMutation, normalizePropositionContent } from "../../reasoning/types";
import type {
  PropositionVersion,
  ReasoningActor,
  ReasoningEvent,
  ReasoningGraph,
} from "../../reasoning/types";
import type { MoralAgentId, MoralIdeaRecord } from "./types";

export type EvalNode = {
  id: string;
  type: "claim";
  text: string;
  createdBy: ReasoningActor;
  createdAtTurn: number;
  subjectId: string;
  status: string;
  supersedes?: string;
  metadata?: Record<string, unknown>;
};

export function evalNodesFromGraph(graph: ReasoningGraph): EvalNode[] {
  return graph.versions.map((version) => ({
    id: version.id,
    type: "claim" as const,
    text: version.content,
    createdBy: version.agentId,
    createdAtTurn: version.turn,
    subjectId: version.subjectId,
    status:
      version.status === "removed"
        ? "rejected"
        : version.status === "active"
          ? "open"
          : "superseded",
    supersedes: version.previousVersionId,
  }));
}

export function isAgent(actor: ReasoningActor | undefined): actor is MoralAgentId {
  return actor === "agent_a" || actor === "agent_b";
}

export function otherAgent(agent: MoralAgentId): MoralAgentId {
  return agent === "agent_a" ? "agent_b" : "agent_a";
}

export function isIdeaNode(node: EvalNode): boolean {
  return node.type === "claim";
}

export function isAxiomNode(_node: EvalNode): boolean {
  return false;
}

export function isEvaluableNode(node: EvalNode): boolean {
  return isIdeaNode(node);
}

export function canonicalText(text: string): string {
  return normalizePropositionContent(text).toLowerCase();
}

export function edgesOf(graph: ReasoningGraph): Array<{
  type: string;
  sourceNodeId: string;
  targetNodeId: string;
}> {
  return graph.versions
    .filter((version) => version.previousVersionId)
    .map((version) => ({
      type: "revises",
      sourceNodeId: version.id,
      targetNodeId: version.previousVersionId!,
    }));
}

export function parentIdsOf(
  nodeId: string,
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
): string[] {
  return edges
    .filter((edge) => edge.sourceNodeId === nodeId)
    .map((edge) => edge.targetNodeId);
}

export function childIdsOf(
  nodeId: string,
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
): string[] {
  return edges
    .filter((edge) => edge.targetNodeId === nodeId)
    .map((edge) => edge.sourceNodeId);
}

export function ancestorsOf(
  nodeId: string,
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
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
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
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
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
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

export function maxGraphDepth(
  nodeIds: string[],
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
): number | null {
  if (nodeIds.length === 0) return null;
  const cache = new Map<string, number>();
  let max = 0;
  for (const id of nodeIds) {
    max = Math.max(max, nodeDepth(id, edges, cache));
  }
  return max;
}

export function meanGraphDepth(
  nodeIds: string[],
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
): number | null {
  if (nodeIds.length === 0) return null;
  const cache = new Map<string, number>();
  const sum = nodeIds.reduce((acc, id) => acc + nodeDepth(id, edges, cache), 0);
  return Number((sum / nodeIds.length).toFixed(4));
}

export function branchingFactor(
  nodeIds: string[],
  edges: Array<{ type: string; sourceNodeId: string; targetNodeId: string }>,
): number | null {
  const withChildren = nodeIds
    .map((id) => childIdsOf(id, edges).length)
    .filter((n) => n > 0);
  if (withChildren.length === 0) return null;
  const sum = withChildren.reduce((acc, n) => acc + n, 0);
  return Number((sum / withChildren.length).toFixed(4));
}

export function finalAnswerNode(
  graph: ReasoningGraph,
): { text?: string } | undefined {
  return graph.finalAnswer;
}

export function finalSeedIds(graph: ReasoningGraph): string[] {
  return graph.versions
    .filter((version) => version.status === "active")
    .map((version) => version.id);
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
  return event.versionId === nodeId || event.previousVersionId === nodeId;
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
  _graph: ReasoningGraph,
  _nodeId: string,
  _origin: ReasoningActor,
): MoralAgentId[] {
  return [];
}

export function challengingAgentsOf(
  _graph: ReasoningGraph,
  _nodeId: string,
  _origin: ReasoningActor,
): MoralAgentId[] {
  return [];
}

export function supersededByOf(
  graph: ReasoningGraph,
  nodeId: string,
): string[] {
  return graph.versions
    .filter((version) => version.previousVersionId === nodeId)
    .map((version) => version.id);
}

export function isUnsupported(_node: EvalNode, parentIds: string[]): boolean {
  return parentIds.length === 0;
}

export function isSynthesisNode(
  _parentIds: string[],
  _originById: Map<string, ReasoningActor>,
): boolean {
  return false;
}

export function buildCanonicalMap(nodes: EvalNode[]): Map<string, string> {
  const firstByText = new Map<string, string>();
  const byId = new Map<string, string>();
  const ordered = [...nodes].sort(
    (a, b) => a.createdAtTurn - b.createdAtTurn || a.id.localeCompare(b.id),
  );
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
  evaluable: EvalNode[];
};

export function buildMoralGraphView(graph: ReasoningGraph): MoralGraphView {
  const edges = edgesOf(graph);
  const evaluable = evalNodesFromGraph(graph);
  const originById = new Map<string, ReasoningActor>();
  for (const node of evaluable) originById.set(node.id, node.createdBy);
  const canonicalById = buildCanonicalMap(evaluable);
  const finalClosure = finalClosureIds(graph);

  const ideas: MoralIdeaRecord[] = evaluable.map((node) => {
    const parentIds = parentIdsOf(node.id, edges);
    const childIds = childIdsOf(node.id, edges);
    return {
      id: node.id,
      canonicalId: canonicalById.get(node.id) ?? node.id,
      kind: "idea",
      text: node.text,
      originatingAgent: isAgent(node.createdBy) ? node.createdBy : "system",
      firstTurn: node.createdAtTurn,
      subsequentTurns: subsequentTurnsFor(graph, node.id, node.createdAtTurn),
      supportingAgents: [],
      challengingAgents: [],
      supersedes: node.supersedes,
      supersededBy: supersededByOf(graph, node.id),
      parentIds,
      childIds,
      inFinalPosition: finalClosure.has(node.id),
      status: node.status,
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
  return isStateChangeMutation(event.mutation);
}

export function operationTargetId(event: ReasoningEvent): string | undefined {
  return event.versionId ?? event.previousVersionId;
}

export function createdNodeId(event: ReasoningEvent): string | undefined {
  if (event.mutation.type === "SET" || event.mutation.type === "REVISE") {
    return event.versionId;
  }
  return undefined;
}

export function groundingSourceIds(event: ReasoningEvent): string[] {
  return event.basisVersionIds ?? [];
}

export function versionById(
  graph: ReasoningGraph,
  id: string,
): PropositionVersion | undefined {
  return graph.versions.find((version) => version.id === id);
}
