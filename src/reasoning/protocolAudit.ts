import type { ConversationMessage } from "../experiment/types";
import type { ReasoningGraph } from "./types";

export type ReasoningProtocolAudit = {
  acceptedMutationsPerTurn: number;
  allIntentsRejectedTurns: number;
  emptyMoveSubstantiveTurns: number;
  unknownTargetErrors: number;
  malformedIntentErrors: number;
  subjectAttachmentRate: number;
  groundedClaimRate: number;
  crossTurnLineageRate: number;
  candidateRevisionRate: number;
  candidateRevisitRate: number;
  stallStreakLength: number;
  maxTurnTimeout: boolean;
  protocolStalled: boolean;
};

/**
 * Deterministic protocol-health snapshot for a finished conversation.
 */
export function auditReasoningProtocol(args: {
  graph: ReasoningGraph;
  messages: ConversationMessage[];
  stoppedReason: string;
}): ReasoningProtocolAudit {
  const { graph, messages, stoppedReason } = args;
  const turns = messages.length;
  const acceptedByTurn = new Map<number, number>();
  const rejectedAll = new Set<number>();
  const attempted = new Set<number>();
  let unknownTargetErrors = 0;
  let malformedIntentErrors = 0;
  for (const event of graph.events) {
    if (event.turnIndex < 1) continue;
    attempted.add(event.turnIndex);
    if (event.accepted) {
      acceptedByTurn.set(
        event.turnIndex,
        (acceptedByTurn.get(event.turnIndex) ?? 0) + 1,
      );
    }
    if (event.errors.some((error) => /unknown target/.test(error))) {
      unknownTargetErrors += 1;
    }
    if (event.errors.some((error) => /malformed/.test(error))) {
      malformedIntentErrors += 1;
    }
  }
  for (const turn of attempted) {
    if ((acceptedByTurn.get(turn) ?? 0) === 0) rejectedAll.add(turn);
  }
  const emptyMoveSubstantiveTurns = graph.events.filter((event) =>
    event.diagnostics?.includes("structured_reasoning_missing"),
  ).length;
  const claims = graph.nodes.filter(
    (node) => node.type === "claim" || node.type === "proposal",
  );
  const subjects = new Set((graph.subjects ?? []).map((subject) => subject.id));
  const attached = claims.filter(
    (node) => node.type !== "final_answer" && node.subjectId && subjects.has(node.subjectId),
  ).length;
  const grounded = new Set(
    (graph.edges ?? [])
      .filter((edge) => edge.type === "grounds" || edge.type === "supports")
      .map((edge) => edge.targetNodeId),
  );
  const revises = (graph.edges ?? []).filter((edge) => edge.type === "revises").length;
  const replaced = (graph.edges ?? []).filter((edge) => edge.type === "replaced_by").length;
  const revisits = graph.events.filter((event) =>
    event.diagnostics?.some((item) => item.startsWith("candidate_revisit")),
  ).length;
  const typedEdges = (graph.edges ?? []).filter(
    (edge) => edge.targetNodeId !== "__final_answer__",
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const crossTurn = typedEdges.filter((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return source && target && source.createdAtTurn !== target.createdAtTurn;
  }).length;
  let stallStreak = 0;
  let current = 0;
  for (const message of messages) {
    const accepted = acceptedByTurn.get(message.turnIndex) ?? 0;
    const missing = graph.events.some(
      (event) =>
        event.turnIndex === message.turnIndex &&
        event.diagnostics?.includes("structured_reasoning_missing"),
    );
    if (missing && accepted === 0) {
      current += 1;
      stallStreak = Math.max(stallStreak, current);
    } else if (accepted > 0) {
      current = 0;
    }
  }
  const acceptedTotal = [...acceptedByTurn.values()].reduce((sum, n) => sum + n, 0);
  return {
    acceptedMutationsPerTurn: turns > 0 ? acceptedTotal / turns : 0,
    allIntentsRejectedTurns: rejectedAll.size,
    emptyMoveSubstantiveTurns,
    unknownTargetErrors,
    malformedIntentErrors,
    subjectAttachmentRate: claims.length > 0 ? attached / claims.length : 0,
    groundedClaimRate:
      claims.length > 0
        ? claims.filter((claim) => grounded.has(claim.id)).length / claims.length
        : 0,
    crossTurnLineageRate: typedEdges.length > 0 ? crossTurn / typedEdges.length : 0,
    candidateRevisionRate: replaced > 0 ? revises / replaced : revises > 0 ? 1 : 0,
    candidateRevisitRate: revisits,
    stallStreakLength: stallStreak,
    maxTurnTimeout: stoppedReason === "max_turns",
    protocolStalled: stoppedReason === "reasoning_protocol_stalled",
  };
}
