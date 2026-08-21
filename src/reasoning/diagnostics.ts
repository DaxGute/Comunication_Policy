import type {
  GenericReadiness,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningProgressState,
} from "./types";
import { checkGraphInvariants, maxIdeasCreatedOnOneSubjectInOneTurn } from "./invariants";
import { computeCanonicalReasoningMetrics } from "./metrics";
import { computePersistenceDiagnostics } from "./persistence";
import { computeCollaborationDiagnostics } from "./collaboration";
import { isStateChangeMutation } from "./types";
import type { MoralSynthesisDiagnostics } from "./moralDiagnostics";
import { layoutReasoningGraph } from "./layout";
import type { CollaborationDiagnostics } from "./collaboration";

export type AtomicityWarning = {
  nodeId: string;
  reasons: string[];
};

export type ReasoningGraphDiagnostics = {
  schemaVersion: number;
  subjectCount: number;
  graphSubjectCount: number;
  graphActiveValueCount: number;
  graphHistoryVersionCount: number;
  introductionCount: number;
  revisionCount: number;
  removalCount: number;
  revisionRate: number;
  crossAgentRevisionCount: number;
  partnerOverwriteRate: number;
  directionalInfluenceAB: number;
  directionalInfluenceBA: number;
  agentOwnershipCurrentA: number;
  agentOwnershipCurrentB: number;
  rejectedMutationCount: number;
  zeroMutationTurnCount?: number;
  versionCount: number;
  versionsPerTurn: number;
  commitsWithBasis?: number;
  commitsWithoutBasis?: number;
  basisCoverageRate?: number;
  crossAgentDerivedFromAtoB?: number;
  crossAgentDerivedFromBtoA?: number;
  meanBasisCount?: number;
  multiSourceDerivationRate?: number;
  turnsWithPersistentChange?: number;
  turnsWithoutPersistentChange?: number;
  setCount?: number;
  reviseCount?: number;
  removeCount?: number;
  tentativeStateCount?: number;
  committedStateCount?: number;
  basisCount?: number;
  crossAgentBasisCount?: number;
  meanPropositionChars?: number;
  maxPropositionChars?: number;
  graphSerializationChars?: number;
  transcriptChars?: number;
  graphToTranscriptRatio?: number | null;
  persistenceReviewTurnCount?: number;
  issueStates?: IssueConvergenceState[];
  genericReadiness?: GenericReadiness;
  progress?: ReasoningProgressState;
  task?: Record<string, unknown>;
  structuredReasoningMissingCount?: number;
  protocolStallStreak?: number;
  maxIdeasPerSubjectPerTurn?: number;
  competingLiveIdeaCount?: number;
  invariantViolationCount?: number;
    graphWidth?: number;
    moralSynthesis?: MoralSynthesisDiagnostics;
    collaboration?: CollaborationDiagnostics;
    solverProgress?: {
    rawMutationCount: number;
    meaningfulStateTransitionCount: number;
    noOpMutationCount: number;
    repeatedStateCount: number;
    cycleDetectionCount: number;
    localLoopInterventions: number;
    diversificationInterventions: number;
    stallWarningCount?: number;
    closureWarningCount?: number;
    finalizationRequiredCount?: number;
    fingerprintCount?: number;
    lastFingerprint?: string;
    semanticStallReason?: string;
    freezeType?: string;
    freezeDetectedTurn?: number;
    stallWarningTurn?: number;
    stallWarningKind?: string;
    stallWarningFingerprint?: string;
    warningDeliveredTurn?: number;
    closureWarningTurn?: number;
    closureWarningReason?: string;
    closureWarningDeliveredTurn?: number;
    finalizationRequiredTurn?: number;
    finalizationDeliveredTurn?: number;
    recoveryTurnCount?: number;
    recoveryTurnsBeforeFinalization?: number;
    progressResumedAfterWarning?: boolean;
    finalAnswerAfterWarning?: boolean;
    finalAnswerAfterFinalization?: boolean;
    turnsFromWarningToFinalAnswer?: number;
    terminatedAsProtocolStall?: boolean;
    terminatedAsMaxTurns?: boolean;
    phase?: string;
  };
};

type DiagnosticOptions = {
  turnCount: number;
  finalAnswer?: string;
  issueStates?: IssueConvergenceState[];
  genericReadiness?: GenericReadiness;
  progress?: ReasoningProgressState;
  task?: Record<string, unknown>;
  solverProgress?: ReasoningGraphDiagnostics["solverProgress"];
  protocolStallStreak?: number;
  messages?: Array<{
    id?: string;
    turnIndex: number;
    content: string;
    agentId?: "agent_a" | "agent_b";
    nothingToAdd?: boolean;
    readyToFinalize?: boolean;
    materialGraphChange?: boolean;
    readinessInvalidated?: boolean;
    focusSubjectIds?: string[];
  }>;
  moralSynthesis?: MoralSynthesisDiagnostics;
  persistenceRepairCount?: number;
  stoppedReason?: string;
  convergenceAttempts?: number;
  convergenceResets?: number;
  materialGraphChangeTurns?: number[];
  lastMaterialChangeTurn?: number;
};

export function computeReasoningGraphDiagnostics(
  graph: ReasoningGraph,
  options: DiagnosticOptions,
): ReasoningGraphDiagnostics {
  const metrics = computeCanonicalReasoningMetrics(graph);
  const persistence = computePersistenceDiagnostics(graph, options.messages ?? []);
  const active = graph.versions.filter((version) => version.status === "active");
  const rejected = graph.events.filter((event) => !event.accepted).length;
  const structuredReasoningMissingCount = graph.events.filter((event) =>
    event.diagnostics?.some((item) => item === "structured_reasoning_missing"),
  ).length;
  const invariantViolations = checkGraphInvariants(graph);
  const layout = layoutReasoningGraph(graph);
  const acceptedTurns = new Set(
    graph.events
      .filter(
        (event) =>
          event.accepted &&
          event.stateChanged !== false &&
          isStateChangeMutation(event.mutation),
      )
      .map((event) => event.turnIndex),
  );
  const collaborationMessages = (options.messages ?? []).flatMap((message) =>
    message.agentId === "agent_a" || message.agentId === "agent_b"
      ? [
          {
            turnIndex: message.turnIndex,
            agentId: message.agentId,
            content: message.content,
            nothingToAdd: message.nothingToAdd,
            readyToFinalize: message.readyToFinalize,
            materialGraphChange: message.materialGraphChange,
            readinessInvalidated: message.readinessInvalidated,
            focusSubjectIds: message.focusSubjectIds,
          },
        ]
      : [],
  );
  const collaboration =
    collaborationMessages.length > 0
      ? computeCollaborationDiagnostics(graph, collaborationMessages, {
          persistenceRepairCount: options.persistenceRepairCount,
          stoppedReason: options.stoppedReason,
          convergenceAttempts: options.convergenceAttempts,
          convergenceResets: options.convergenceResets,
          materialGraphChangeTurns: options.materialGraphChangeTurns,
          lastMaterialChangeTurn: options.lastMaterialChangeTurn,
        })
      : undefined;

  return {
    schemaVersion: graph.schemaVersion ?? 2,
    subjectCount: graph.subjects.length,
    graphSubjectCount: graph.subjects.length,
    graphActiveValueCount: active.length,
    graphHistoryVersionCount: graph.versions.length,
    introductionCount: metrics.introductionCount,
    revisionCount: metrics.revisionCount,
    removalCount: metrics.removalCount,
    revisionRate: metrics.revisionRate,
    crossAgentRevisionCount: metrics.crossAgentRevisionCount,
    partnerOverwriteRate: metrics.partnerOverwriteRate,
    directionalInfluenceAB: metrics.directionalInfluenceAB,
    directionalInfluenceBA: metrics.directionalInfluenceBA,
    agentOwnershipCurrentA: metrics.agentOwnershipCurrent.agent_a,
    agentOwnershipCurrentB: metrics.agentOwnershipCurrent.agent_b,
    rejectedMutationCount: rejected,
    zeroMutationTurnCount: Math.max(0, options.turnCount - acceptedTurns.size),
    versionCount: graph.versions.length,
    versionsPerTurn:
      options.turnCount > 0 ? graph.versions.length / options.turnCount : 0,
    commitsWithBasis: metrics.commitsWithBasis,
    commitsWithoutBasis: metrics.commitsWithoutBasis,
    basisCoverageRate: metrics.basisCoverageRate,
    crossAgentDerivedFromAtoB: metrics.crossAgentDerivedFromAtoB,
    crossAgentDerivedFromBtoA: metrics.crossAgentDerivedFromBtoA,
    meanBasisCount: metrics.meanBasisCount,
    multiSourceDerivationRate: metrics.multiSourceDerivationRate,
    turnsWithPersistentChange: persistence.turnsWithPersistentChange,
    turnsWithoutPersistentChange: persistence.turnsWithoutPersistentChange,
    setCount: persistence.setCount,
    reviseCount: persistence.reviseCount,
    removeCount: persistence.removeCount,
    tentativeStateCount: persistence.tentativeStateCount,
    committedStateCount: persistence.committedStateCount,
    basisCount: persistence.basisCount,
    crossAgentBasisCount: persistence.crossAgentBasisCount,
    meanPropositionChars: persistence.meanPropositionChars,
    maxPropositionChars: persistence.maxPropositionChars,
    graphSerializationChars: persistence.graphSerializationChars,
    transcriptChars: persistence.transcriptChars,
    graphToTranscriptRatio: persistence.graphToTranscriptRatio,
    persistenceReviewTurnCount: persistence.persistenceReviewTurnCount,
    issueStates: options.issueStates,
    genericReadiness: options.genericReadiness,
    progress: options.progress,
    task: options.task,
    structuredReasoningMissingCount,
    protocolStallStreak: options.protocolStallStreak,
    maxIdeasPerSubjectPerTurn: maxIdeasCreatedOnOneSubjectInOneTurn(graph),
    competingLiveIdeaCount: invariantViolations.filter(
      (item) => item.code === "competing_live_values",
    ).length,
    invariantViolationCount: invariantViolations.length,
    graphWidth: layout.width,
    moralSynthesis: options.moralSynthesis,
    collaboration,
    solverProgress: options.solverProgress,
  };
}
