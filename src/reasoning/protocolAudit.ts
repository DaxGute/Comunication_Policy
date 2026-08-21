import { eventChangedCanonicalState } from "./stall";
import type { ConversationMessage } from "../experiment/types";
import { isStateChangeMutation, type ReasoningGraph } from "./types";

export type ReasoningProtocolAudit = {
  acceptedMutationsPerTurn: number;
  meaningfulStateTransitionsPerTurn: number;
  noOpMutationCount: number;
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
    if (event.accepted && isStateChangeMutation(event.mutation)) {
      acceptedByTurn.set(
        event.turnIndex,
        (acceptedByTurn.get(event.turnIndex) ?? 0) + 1,
      );
    }
    if (event.errors.some((error) => /unknown/.test(error))) {
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
  const attached = graph.versions.filter((version) =>
    graph.subjects.some((subject) => subject.id === version.subjectId),
  ).length;
  const revises = graph.events.filter(
    (event) => event.accepted && event.mutation.type === "REVISE",
  ).length;
  let stallStreak = 0;
  let current = 0;
  let meaningfulTotal = 0;
  let noOpMutationCount = 0;
  for (const event of graph.events) {
    if (event.turnIndex < 1) continue;
    if (eventChangedCanonicalState(event)) meaningfulTotal += 1;
    else if (event.accepted && event.mutation.type !== "protocol_failure") {
      noOpMutationCount += 1;
    }
  }
  for (const message of messages) {
    const meaningful = graph.events.filter(
      (event) =>
        event.turnIndex === message.turnIndex &&
        eventChangedCanonicalState(event),
    ).length;
    if (meaningful === 0) {
      current += 1;
      stallStreak = Math.max(stallStreak, current);
    } else {
      current = 0;
    }
  }
  const acceptedTotal = [...acceptedByTurn.values()].reduce((sum, n) => n + sum, 0);
  return {
    acceptedMutationsPerTurn: turns > 0 ? acceptedTotal / turns : 0,
    meaningfulStateTransitionsPerTurn: turns > 0 ? meaningfulTotal / turns : 0,
    noOpMutationCount,
    allIntentsRejectedTurns: rejectedAll.size,
    emptyMoveSubstantiveTurns,
    unknownTargetErrors,
    malformedIntentErrors,
    subjectAttachmentRate:
      graph.versions.length > 0 ? attached / graph.versions.length : 0,
    groundedClaimRate: 0,
    crossTurnLineageRate: 0,
    candidateRevisionRate: revises > 0 ? 1 : 0,
    candidateRevisitRate: 0,
    stallStreakLength: stallStreak,
    maxTurnTimeout: stoppedReason === "max_turns",
    protocolStalled: stoppedReason === "reasoning_protocol_stalled",
  };
}
