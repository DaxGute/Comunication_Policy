/**
 * Persistence diagnostics over canonical graph + transcript.
 *
 * These are research/inspector signals. They never rewrite the graph.
 * A PERSISTENCE REVIEW flag is not an error: the researcher decides
 * whether the turn was appropriately ephemeral or lost important state.
 */
import { crosswordMessageLooksSubstantive } from "../problems/crossword/extract";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import { propositionCommitment } from "./commitment";
import { snapshotThroughTurn } from "./queries";
import { formatReasoningState } from "./renderState";
import {
  isStateChangeMutation,
  mutationBasis,
  mutationSubjectId,
  type ReasoningEvent,
  type ReasoningGraph,
} from "./types";

export type TurnPersistenceCoverage = {
  turnIndex: number;
  messageId?: string;
  emitted: number;
  accepted: number;
  rejected: number;
  subjectsChanged: string[];
  basisRefs: string[];
  persistentChange: boolean;
  protocolFailure: boolean;
  structuredReasoningMissing: boolean;
  persistenceReview: boolean;
};

export type PersistenceDiagnostics = {
  turnsWithPersistentChange: number;
  turnsWithoutPersistentChange: number;
  setCount: number;
  reviseCount: number;
  removeCount: number;
  tentativeStateCount: number;
  committedStateCount: number;
  basisCount: number;
  crossAgentBasisCount: number;
  basisCoverageRate: number;
  subjectCount: number;
  versionCount: number;
  meanPropositionChars: number;
  maxPropositionChars: number;
  graphSerializationChars: number;
  transcriptChars: number;
  graphToTranscriptRatio: number | null;
  persistenceReviewTurnCount: number;
};

export type PersistenceMessage = {
  id?: string;
  turnIndex: number;
  content: string;
};

function isRequestLike(message: string): boolean {
  const text = message.trim();
  if (text.length > 180) return false;
  return /^(can you|could you|please (check|look|verify|recheck)|what (do|about)|does |check )/i.test(
    text,
  );
}

export function looksLikePersistenceReview(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  if (extractFinalAnswerFromText(text)) return false;
  if (isRequestLike(text)) return false;
  if (crosswordMessageLooksSubstantive(text)) return true;
  if (text.length < 120) return false;
  return /(therefore|constraint|pattern|hypothesis|principle|stakeholder|should |must |because |=|:)/i.test(
    text,
  );
}

function eventsForTurn(graph: ReasoningGraph, turnIndex: number): ReasoningEvent[] {
  return graph.events.filter((event) => event.turnIndex === turnIndex);
}

export function coverageForTurn(
  graph: ReasoningGraph,
  turnIndex: number,
  message?: PersistenceMessage,
): TurnPersistenceCoverage {
  const events = eventsForTurn(graph, turnIndex);
  const stateEvents = events.filter((event) => isStateChangeMutation(event.mutation));
  const accepted = stateEvents.filter(
    (event) => event.accepted && event.stateChanged !== false,
  );
  const rejected = events.filter((event) => !event.accepted);
  const subjectsChanged = [
    ...new Set(
      accepted
        .map((event) => mutationSubjectId(event.mutation))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const basisRefs = [
    ...new Set(accepted.flatMap((event) => mutationBasis(event.mutation))),
  ];
  const protocolFailure = events.some(
    (event) => event.mutation.type === "protocol_failure",
  );
  const structuredReasoningMissing = events.some((event) =>
    event.diagnostics?.includes("structured_reasoning_missing"),
  );
  const persistentChange = accepted.length > 0;
  const persistenceReview =
    !persistentChange &&
    !protocolFailure &&
    !structuredReasoningMissing &&
    Boolean(message?.content) &&
    looksLikePersistenceReview(message!.content);
  return {
    turnIndex,
    messageId: message?.id,
    emitted: stateEvents.length,
    accepted: accepted.length,
    rejected: rejected.length,
    subjectsChanged,
    basisRefs,
    persistentChange,
    protocolFailure,
    structuredReasoningMissing,
    persistenceReview,
  };
}

export function computePersistenceDiagnostics(
  graph: ReasoningGraph,
  messages: PersistenceMessage[] = [],
): PersistenceDiagnostics {
  const turns = Math.max(
    messages.length,
    ...graph.events.map((event) => event.turnIndex),
    0,
  );
  const coverages: TurnPersistenceCoverage[] = [];
  const byTurn = new Map(messages.map((message) => [message.turnIndex, message]));
  for (let turn = 1; turn <= turns; turn++) {
    coverages.push(coverageForTurn(graph, turn, byTurn.get(turn)));
  }
  const accepted = graph.events.filter(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation),
  );
  let setCount = 0;
  let reviseCount = 0;
  let removeCount = 0;
  for (const event of accepted) {
    if (event.mutation.type === "SET") setCount += 1;
    else if (event.mutation.type === "REVISE") reviseCount += 1;
    else removeCount += 1;
  }
  const active = graph.versions.filter((version) => version.status === "active");
  const tentativeStateCount = active.filter(
    (version) => propositionCommitment(version) === "tentative",
  ).length;
  const committedStateCount = active.length - tentativeStateCount;
  const lengths = graph.versions.map((version) => version.content.length);
  const meanPropositionChars =
    lengths.length === 0
      ? 0
      : lengths.reduce((sum, n) => sum + n, 0) / lengths.length;
  const maxPropositionChars = lengths.length === 0 ? 0 : Math.max(...lengths);
  const serialized = formatReasoningState(graph);
  const transcriptChars = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const provenanceCommits = graph.versions.length;
  let commitsWithBasis = 0;
  let basisCount = 0;
  let crossAgentBasisCount = 0;
  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  for (const version of graph.versions) {
    const basis = version.derivedFromVersionIds ?? [];
    if (basis.length === 0) continue;
    commitsWithBasis += 1;
    basisCount += basis.length;
    for (const sourceId of basis) {
      const source = byId.get(sourceId);
      if (source && source.agentId !== version.agentId) crossAgentBasisCount += 1;
    }
  }
  return {
    turnsWithPersistentChange: coverages.filter((item) => item.persistentChange).length,
    turnsWithoutPersistentChange: coverages.filter((item) => !item.persistentChange)
      .length,
    setCount,
    reviseCount,
    removeCount,
    tentativeStateCount,
    committedStateCount,
    basisCount,
    crossAgentBasisCount,
    basisCoverageRate: provenanceCommits > 0 ? commitsWithBasis / provenanceCommits : 0,
    subjectCount: graph.subjects.length,
    versionCount: graph.versions.length,
    meanPropositionChars,
    maxPropositionChars,
    graphSerializationChars: serialized.length,
    transcriptChars,
    graphToTranscriptRatio:
      transcriptChars > 0 ? serialized.length / transcriptChars : null,
    persistenceReviewTurnCount: coverages.filter((item) => item.persistenceReview)
      .length,
  };
}

export function nextAgentMemoryTexts(args: {
  graph: ReasoningGraph;
  turn: number;
  previousUtterance?: string;
  previousSpeaker?: string;
}): {
  graphSerialization: string;
  previousUtterance: string;
} {
  const after = snapshotThroughTurn(args.graph, args.turn);
  const previousUtterance = args.previousUtterance?.trim()
    ? [
        "MOST RECENT PARTNER MESSAGE",
        "",
        `${args.previousSpeaker ?? "Partner"}:`,
        `"${args.previousUtterance}"`,
      ].join("\n")
    : "(none)";
  return {
    graphSerialization: formatReasoningState(after),
    previousUtterance,
  };
}
