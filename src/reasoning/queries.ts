/**
 * Read-only queries over a materialized reasoning graph.
 *
 * Intent validation and graph mutation live in graph.ts; these helpers support
 * transcript linking, audit replay, and graph-detail views.
 */
import { materializeGraph } from "./graph";
import type { ReasoningEvent, ReasoningGraph, ReasoningNode } from "./types";

/** Reconstruct the graph as it existed before `turn` (for request replay). */
export function snapshotBeforeTurn(
  graph: ReasoningGraph,
  turn: number,
): ReasoningGraph {
  return materializeGraph(
    graph.events.filter((event) => event.turnIndex < turn),
    graph.subjects,
  );
}

export function nodesCreatedInMessage(
  graph: ReasoningGraph,
  messageId: string,
): ReasoningNode[] {
  return graph.nodes.filter((node) => node.sourceMessageId === messageId);
}

export function eventsForMessage(
  graph: ReasoningGraph,
  messageId: string,
): ReasoningEvent[] {
  return graph.events.filter((event) => event.messageId === messageId);
}

export function nodeIdsTouchedByMessage(
  graph: ReasoningGraph,
  messageId: string,
): string[] {
  const ids = new Set<string>();
  for (const node of nodesCreatedInMessage(graph, messageId)) {
    ids.add(node.id);
  }
  for (const event of eventsForMessage(graph, messageId)) {
    if (!event.accepted) continue;
    const op = event.operation;
    if (op.type === "create") ids.add(op.node.id);
    else if (op.type === "revise") {
      ids.add(op.targetId);
      ids.add(op.replacement.id);
    } else if (op.type === "support" || op.type === "challenge") {
      if (op.sourceNodeId) ids.add(op.sourceNodeId);
      ids.add(op.targetNodeId);
    } else if (op.type === "final_answer") {
      ids.add("__final_answer__");
      for (const id of op.supportingNodeIds) ids.add(id);
    } else if ("targetId" in op && op.targetId) {
      ids.add(op.targetId);
    }
  }
  return [...ids].filter(Boolean);
}

export function eventsForNode(
  graph: ReasoningGraph,
  nodeId: string,
): ReasoningEvent[] {
  return graph.events.filter((event) => {
    const op = event.operation;
    if (op.type === "create") return op.node.id === nodeId;
    if (op.type === "revise") {
      return op.targetId === nodeId || op.replacement.id === nodeId;
    }
    if (op.type === "support" || op.type === "challenge") {
      return op.sourceNodeId === nodeId || op.targetNodeId === nodeId;
    }
    if (op.type === "final_answer") {
      return (
        nodeId === "__final_answer__" || op.supportingNodeIds.includes(nodeId)
      );
    }
    if ("targetId" in op) return op.targetId === nodeId;
    return false;
  });
}
