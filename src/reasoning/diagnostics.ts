import type {
  GenericReadiness,
  IssueConvergenceState,
  ReasoningEdge,
  ReasoningGraph,
  ReasoningNode,
  ReasoningProgressState,
} from "./types";
import {
  checkGraphInvariants,
  maxIdeasCreatedOnOneSubjectInOneTurn,
} from "./invariants";
import {
  LAYOUT_LANE_STEP,
  LAYOUT_ORPHAN_LANES,
  LAYOUT_ROOT_CENTER_X,
  layoutReasoningGraph,
} from "./layout";

export type AtomicityWarning = {
  nodeId: string;
  reasons: string[];
};

export type ReasoningGraphDiagnostics = {
  nodeCount: number;
  nodesPerTurn: number;
  proposalCount: number;
  claimCount: number;
  evidenceCount: number;
  issueCount: number;
  atomicityWarningCount: number;
  atomicityWarnings: AtomicityWarning[];
  unlinkedNodeCount: number;
  relationshipCount: number;
  /** Share of non-final nodes incident to at least one typed relationship. */
  relationshipCoverage: number;
  /** Share of evidence nodes used as a source of support or challenge. */
  evidenceUsage: number;
  finalSupportingNodeCount: number;
  invalidFinalSupportCount: number;
  /**
   * Share of deterministically identifiable final-answer parts represented by
   * cited graph nodes. Undefined when the answer has no parseable part keys.
   */
  finalSupportCoverage?: number;
  issueStates?: IssueConvergenceState[];
  genericReadiness?: GenericReadiness;
  progress?: ReasoningProgressState;
  task?: Record<string, unknown>;
  subjectAttachmentRate?: number;
  candidateTransitions?: number;
  candidateTransitionsWithSemanticLineage?: number;
  candidateTransitionsWithReplacedBy?: number;
  candidateRevisits?: number;
  revisitsWithNewEvidence?: number;
  revisitsWithoutNewEvidence?: number;
  crossingConflicts?: number;
  conflictsResolved?: number;
  conflictsRemainingLive?: number;
  liveCandidates?: number;
  incompatibleLiveCandidates?: number;
  issueSettlementRate?: number;
  issueReopenRate?: number;
  crossTurnEdgeRate?: number;
  degree0ClaimRate?: number;
  meanSameIssueXSpread?: number;
  graphWidth?: number;
  graphOverhang?: number;
  orphanNodeCount?: number;
  groundedClaimRate?: number;
  taskEvidenceCount?: number;
  agentEvidenceCount?: number;
  deterministicEvidenceCount?: number;
  ungroundedClaimCount?: number;
  structuredReasoningMissingCount?: number;
  protocolStallStreak?: number;
  maxIdeasPerSubjectPerTurn?: number;
  competingLiveIdeaCount?: number;
  invariantViolationCount?: number;
  orphanedEvidenceCount?: number;
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
};

function warningFor(node: ReasoningNode): AtomicityWarning | undefined {
  if (node.type === "final_answer") return undefined;
  const reasons: string[] = [];
  const listSeparators = (node.text.match(/[;,]/g) ?? []).length;
  const enumeratedItems = (node.text.match(/(?:^|\s)(?:\d+[.)]|[-•])\s+/g) ?? []).length;
  const assignmentClauses = (
    node.text.match(/(?:^|[;,])\s*[^;,=]{1,40}\s*=/g) ?? []
  ).length;

  if (listSeparators >= 4) reasons.push("contains a long enumeration");
  if (enumeratedItems >= 3) reasons.push("contains multiple enumerated propositions");
  if (assignmentClauses >= 3) {
    reasons.push(`contains ${assignmentClauses} assignment-like propositions`);
  }
  return reasons.length > 0 ? { nodeId: node.id, reasons } : undefined;
}

function incidentNodeIds(edges: ReasoningEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.sourceNodeId);
    ids.add(edge.targetNodeId);
  }
  return ids;
}

export function computeReasoningGraphDiagnostics(
  graph: ReasoningGraph,
  options: DiagnosticOptions,
): ReasoningGraphDiagnostics {
  const nodes = graph.nodes.filter((node) => node.type !== "final_answer");
  const edges = graph.edges ?? [];
  const incident = incidentNodeIds(edges);
  const warnings = nodes
    .map(warningFor)
    .filter((warning): warning is AtomicityWarning => Boolean(warning));
  const evidence = nodes.filter((node) => node.type === "evidence");
  const usedEvidence = new Set(
    edges
      .filter(
        (edge) =>
          edge.type === "supports" ||
          edge.type === "challenges" ||
          edge.type === "grounds",
      )
      .map((edge) => edge.sourceNodeId),
  );
  const finalNode = graph.nodes.find((node) => node.type === "final_answer");
  const validFinalSupports =
    finalNode?.type === "final_answer"
      ? finalNode.supportingNodeIds.filter((id) =>
          graph.nodes.some(
            (node) =>
              node.id === id &&
              node.type !== "final_answer" &&
              node.status !== "rejected" &&
              node.status !== "superseded",
          ),
        )
      : [];
  const requiredIssueIds = new Set((graph.subjects ?? []).map((subject) => subject.id));
  const citedIssueIds = new Set<string>();
  for (const id of validFinalSupports) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (node?.type !== "final_answer" && node?.subjectId) {
      citedIssueIds.add(node.subjectId);
    }
  }

  const claims = nodes.filter(
    (node) => node.type === "claim" || node.type === "proposal",
  );
  const knownSubjects = new Set((graph.subjects ?? []).map((subject) => subject.id));
  const attachedClaims = claims.filter(
    (node) => node.subjectId && knownSubjects.has(node.subjectId),
  );
  const replacedBy = edges.filter((edge) => edge.type === "replaced_by");
  const lineageTypes = new Set(["revises", "supports", "challenges", "grounds"]);
  const pairKey = (a: string, b: string) => [a, b].sort().join("::");
  const semanticPairs = new Set(
    edges
      .filter((edge) => lineageTypes.has(edge.type))
      .map((edge) => pairKey(edge.sourceNodeId, edge.targetNodeId)),
  );
  const candidateTransitionsWithSemanticLineage = replacedBy.filter((edge) =>
    semanticPairs.has(pairKey(edge.sourceNodeId, edge.targetNodeId)),
  ).length;
  const diagnosticItems = graph.events.flatMap((event) => event.diagnostics ?? []);
  const candidateRevisits = diagnosticItems.filter((item) =>
    item.startsWith("candidate_revisit"),
  ).length;
  const revisitsWithNewEvidence = diagnosticItems.filter((item) =>
    item.includes("with new evidence"),
  ).length;
  const revisitsWithoutNewEvidence = diagnosticItems.filter((item) =>
    item.includes("without new evidence"),
  ).length;
  const issueStates = options.issueStates ?? [];
  const crossingConflicts = issueStates.reduce(
    (sum, state) =>
      sum +
      state.conflicts.filter((conflict) => conflict.source === "task_constraint")
        .length,
    0,
  );
  const liveCandidates = issueStates.reduce(
    (sum, state) => sum + state.liveClaimIds.length,
    0,
  );
  const incompatibleLiveCandidates = issueStates.reduce((sum, state) => {
    const compatibility = state.claimCompatibility ?? {};
    return (
      sum +
      state.liveClaimIds.filter((id) => compatibility[id] === "incompatible").length
    );
  }, 0);
  const settledCount = issueStates.filter((state) => state.settledClaimId).length;
  const reopenedCount = issueStates.filter((state) => state.reopened).length;
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const typedEdges = edges.filter((edge) => edge.targetNodeId !== "__final_answer__");
  const crossTurnEdges = typedEdges.filter((edge) => {
    const source = nodeById.get(edge.sourceNodeId);
    const target = nodeById.get(edge.targetNodeId);
    return (
      source &&
      target &&
      source.createdAtTurn !== target.createdAtTurn
    );
  });
  const groundedIds = new Set(
    edges
      .filter((edge) => edge.type === "grounds" || edge.type === "supports")
      .map((edge) => edge.targetNodeId),
  );
  const evidenceByOrigin = {
    task: evidence.filter((node) => node.evidenceOrigin === "task").length,
    deterministic: evidence.filter((node) => node.evidenceOrigin === "deterministic")
      .length,
    agent: evidence.filter(
      (node) => node.evidenceOrigin === "agent" || !node.evidenceOrigin,
    ).length,
  };
  const structuredReasoningMissingCount = graph.events.filter((event) =>
    event.diagnostics?.some((item) => item === "structured_reasoning_missing"),
  ).length;
  const invariantViolations = checkGraphInvariants(graph);
  const layout = layoutReasoningGraph(graph);
  const spreads: number[] = [];
  for (const subject of graph.subjects ?? []) {
    const xs = layout.nodes
      .filter(
        (item) =>
          item.node.type !== "final_answer" &&
          item.node.subjectId === subject.id,
      )
      .map((item) => item.x + item.width / 2);
    if (xs.length >= 2) {
      spreads.push(Math.max(...xs) - Math.min(...xs));
    } else if (xs.length === 1) {
      spreads.push(0);
    }
  }
  const subjectLaneRight =
    LAYOUT_ROOT_CENTER_X +
    Math.max(0, (graph.subjects?.length ?? 0) - 1) * LAYOUT_LANE_STEP +
    LAYOUT_LANE_STEP;
  const orphanCap =
    LAYOUT_ROOT_CENTER_X +
    (graph.subjects?.length ?? 0) * LAYOUT_LANE_STEP +
    LAYOUT_ORPHAN_LANES * LAYOUT_LANE_STEP;

  return {
    nodeCount: nodes.length,
    nodesPerTurn: options.turnCount > 0 ? nodes.length / options.turnCount : 0,
    proposalCount: nodes.filter((node) => node.type === "proposal").length,
    claimCount: nodes.filter((node) => node.type === "claim").length,
    evidenceCount: evidence.length,
    issueCount:
      (graph.subjects?.length ?? 0) +
      nodes.filter((node) => node.type === "issue").length,
    atomicityWarningCount: warnings.length,
    atomicityWarnings: warnings,
    unlinkedNodeCount: nodes.filter((node) => !incident.has(node.id)).length,
    relationshipCount: edges.filter(
      (edge) => edge.targetNodeId !== "__final_answer__",
    ).length,
    relationshipCoverage:
      nodes.length > 0
        ? nodes.filter((node) => incident.has(node.id)).length / nodes.length
        : 0,
    evidenceUsage:
      evidence.length > 0
        ? evidence.filter((node) => usedEvidence.has(node.id)).length /
          evidence.length
        : 0,
    finalSupportingNodeCount: validFinalSupports.length,
    invalidFinalSupportCount:
      finalNode?.type === "final_answer" ? finalNode.supportErrors.length : 0,
    ...(requiredIssueIds.size > 0
      ? {
          finalSupportCoverage:
            [...requiredIssueIds].filter((id) => citedIssueIds.has(id)).length /
            requiredIssueIds.size,
        }
      : {}),
    issueStates: options.issueStates,
    genericReadiness: options.genericReadiness,
    progress: options.progress,
    task: options.task,
    subjectAttachmentRate:
      claims.length > 0 ? attachedClaims.length / claims.length : 0,
    candidateTransitions: replacedBy.length,
    candidateTransitionsWithSemanticLineage,
    candidateTransitionsWithReplacedBy: replacedBy.length,
    candidateRevisits,
    revisitsWithNewEvidence,
    revisitsWithoutNewEvidence,
    crossingConflicts,
    conflictsResolved: Math.max(0, crossingConflicts === 0 && liveCandidates > 0 ? 1 : 0),
    conflictsRemainingLive: crossingConflicts,
    liveCandidates,
    incompatibleLiveCandidates,
    issueSettlementRate:
      issueStates.length > 0 ? settledCount / issueStates.length : 0,
    issueReopenRate: issueStates.length > 0 ? reopenedCount / issueStates.length : 0,
    crossTurnEdgeRate:
      typedEdges.length > 0 ? crossTurnEdges.length / typedEdges.length : 0,
    degree0ClaimRate:
      claims.length > 0
        ? claims.filter((claim) => !incident.has(claim.id)).length / claims.length
        : 0,
    meanSameIssueXSpread:
      spreads.length > 0
        ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length
        : 0,
    graphWidth: layout.width,
    graphOverhang: Math.max(0, layout.width - Math.max(subjectLaneRight, orphanCap)),
    orphanNodeCount: claims.length - attachedClaims.length,
    groundedClaimRate:
      claims.length > 0
        ? claims.filter((claim) => groundedIds.has(claim.id)).length / claims.length
        : 0,
    taskEvidenceCount: evidenceByOrigin.task,
    agentEvidenceCount: evidenceByOrigin.agent,
    deterministicEvidenceCount: evidenceByOrigin.deterministic,
    ungroundedClaimCount: claims.filter((claim) => !groundedIds.has(claim.id)).length,
    structuredReasoningMissingCount,
    protocolStallStreak: options.protocolStallStreak,
    maxIdeasPerSubjectPerTurn: maxIdeasCreatedOnOneSubjectInOneTurn(graph),
    competingLiveIdeaCount: invariantViolations.filter(
      (item) => item.code === "competing_live_ideas",
    ).length,
    invariantViolationCount: invariantViolations.length,
    orphanedEvidenceCount: invariantViolations.filter(
      (item) => item.code === "orphaned_evidence",
    ).length,
    solverProgress: options.solverProgress,
  };
}
