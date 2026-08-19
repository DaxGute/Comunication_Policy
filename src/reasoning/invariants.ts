/**
 * Graph invariants for committed reasoning state.
 *
 * These are instrumentation, not runtime rejection. The engine should already
 * prevent most violations; tests assert the remaining ones.
 */
import type { AtomicReasoningNode, ReasoningEvent, ReasoningGraph, ReasoningNode } from "./types";
import {
  isParaphrase,
  isCandidateType,
  validateCommittedProposition,
} from "./validateProposition";

export type GraphInvariantCode =
  | "ideas_per_turn"
  | "competing_live_ideas"
  | "duplicate_active_idea"
  | "malformed_idea"
  | "revision_missing_ancestry"
  | "final_without_ancestry"
  | "final_differs_from_graph"
  | "orphaned_evidence";

export type GraphInvariantViolation = {
  code: GraphInvariantCode;
  detail: string;
  nodeIds?: string[];
  turnIndex?: number;
  subjectId?: string;
};

function isLive(node: ReasoningNode): boolean {
  return node.status !== "rejected" && node.status !== "superseded";
}

function candidateNodes(graph: ReasoningGraph): AtomicReasoningNode[] {
  return graph.nodes.filter(
    (node): node is AtomicReasoningNode =>
      node.type !== "final_answer" && isCandidateType(node.type),
  );
}

function liveCandidates(graph: ReasoningGraph): AtomicReasoningNode[] {
  return candidateNodes(graph).filter(isLive);
}

function ideasCreatedByTurn(events: ReasoningEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.accepted || event.stateChanged === false) continue;
    if (event.operation.type !== "create") continue;
    const node = event.operation.node;
    if (!isCandidateType(node.type)) continue;
    const key = `${event.turnIndex}::${node.subjectId ?? "__unscoped__"}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function ideasCreatedPerTurn(graph: ReasoningGraph): number[] {
  const byTurn = new Map<number, number>();
  for (const event of graph.events) {
    if (!event.accepted || event.stateChanged === false) continue;
    if (event.operation.type !== "create") continue;
    if (!isCandidateType(event.operation.node.type)) continue;
    byTurn.set(event.turnIndex, (byTurn.get(event.turnIndex) ?? 0) + 1);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, count]) => count);
}

export function maxIdeasCreatedOnOneSubjectInOneTurn(
  graph: ReasoningGraph,
): number {
  const counts = ideasCreatedByTurn(graph.events);
  return counts.size === 0 ? 0 : Math.max(...counts.values());
}

export function checkGraphInvariants(graph: ReasoningGraph): GraphInvariantViolation[] {
  const violations: GraphInvariantViolation[] = [];
  const edges = graph.edges ?? [];

  for (const [key, count] of ideasCreatedByTurn(graph.events)) {
    if (count <= 1) continue;
    const [turnRaw, subjectId] = key.split("::");
    violations.push({
      code: "ideas_per_turn",
      detail: `${count} competing ideas created for ${subjectId} on turn ${turnRaw}`,
      turnIndex: Number(turnRaw),
      subjectId: subjectId === "__unscoped__" ? undefined : subjectId,
    });
  }

  const liveBySubject = new Map<string, ReasoningNode[]>();
  for (const node of liveCandidates(graph)) {
    if (!node.subjectId) continue;
    const list = liveBySubject.get(node.subjectId) ?? [];
    list.push(node);
    liveBySubject.set(node.subjectId, list);
  }
  for (const [subjectId, nodes] of liveBySubject) {
    if (nodes.length <= 1) continue;
    const identities = nodes.map((node) => {
      const identity = node.metadata?.candidateIdentity;
      return typeof identity === "string" ? identity : undefined;
    });
    const exclusive = identities.some(Boolean);
    if (exclusive) {
      violations.push({
        code: "competing_live_ideas",
        detail: `${nodes.length} mutually exclusive live ideas for ${subjectId}`,
        nodeIds: nodes.map((node) => node.id),
        subjectId,
      });
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (!isParaphrase(nodes[i]!.text, nodes[j]!.text)) continue;
        violations.push({
          code: "duplicate_active_idea",
          detail: `${nodes[i]!.id} paraphrases ${nodes[j]!.id} on ${subjectId}`,
          nodeIds: [nodes[i]!.id, nodes[j]!.id],
          subjectId,
        });
      }
    }
  }

  for (const node of liveCandidates(graph)) {
    const kind = node.type === "proposal" ? "proposal" : "claim";
    const validity = validateCommittedProposition(node.text, kind);
    if (validity.ok) continue;
    violations.push({
      code: "malformed_idea",
      detail: `${node.id}: ${validity.reasons.join("; ")}`,
      nodeIds: [node.id],
      subjectId: node.subjectId,
      turnIndex: node.createdAtTurn,
    });
  }

  for (const event of graph.events) {
    if (!event.accepted || event.operation.type !== "revise") continue;
    const replacement = event.operation.replacement;
    const targetId = event.operation.targetId;
    if (replacement.supersedes !== targetId) {
      violations.push({
        code: "revision_missing_ancestry",
        detail: `${replacement.id} does not supersede ${targetId}`,
        nodeIds: [replacement.id, targetId],
        turnIndex: event.turnIndex,
      });
    }
    const revises = edges.some(
      (edge) =>
        edge.type === "revises" &&
        edge.sourceNodeId === replacement.id &&
        edge.targetNodeId === targetId,
    );
    const replacedById =
      event.operation.type === "revise"
        ? (event.operation.replacedActiveNodeId ?? targetId)
        : targetId;
    const replaced = edges.some(
      (edge) =>
        edge.type === "replaced_by" &&
        edge.sourceNodeId === replacedById &&
        edge.targetNodeId === replacement.id,
    );
    if (!revises || !replaced) {
      violations.push({
        code: "revision_missing_ancestry",
        detail: `${replacement.id} is missing revises/replaced_by ancestry to ${targetId}`,
        nodeIds: [replacement.id, targetId],
        turnIndex: event.turnIndex,
      });
    }
  }

  const finalNode = graph.nodes.find((node) => node.type === "final_answer");
  if (finalNode?.type === "final_answer") {
    const liveSupport = finalNode.supportingNodeIds.filter((id) => {
      const node = graph.nodes.find((item) => item.id === id);
      return node && isLive(node) && node.type !== "final_answer";
    });
    if (liveSupport.length === 0 && finalNode.text.trim()) {
      violations.push({
        code: "final_without_ancestry",
        detail: "final answer cites no surviving graph idea",
        nodeIds: ["__final_answer__"],
        turnIndex: finalNode.createdAtTurn,
      });
    }
    if (
      finalNode.supportErrors.some((error) =>
        /differs from surviving graph state/.test(error),
      )
    ) {
      violations.push({
        code: "final_differs_from_graph",
        detail: finalNode.supportErrors.join("; "),
        nodeIds: ["__final_answer__"],
        turnIndex: finalNode.createdAtTurn,
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.type !== "evidence") continue;
    if (node.evidenceOrigin === "task") continue;
    if (!isLive(node)) continue;
    const attached = edges.some(
      (edge) =>
        (edge.sourceNodeId === node.id || edge.targetNodeId === node.id) &&
        (edge.type === "grounds" ||
          edge.type === "supports" ||
          edge.type === "challenges"),
    );
    if (!attached) {
      violations.push({
        code: "orphaned_evidence",
        detail: `${node.id} is not attached to a meaningful proposition`,
        nodeIds: [node.id],
        subjectId: node.subjectId,
        turnIndex: node.createdAtTurn,
      });
    }
  }

  return violations;
}
