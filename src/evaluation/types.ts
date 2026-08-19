/**
 * Shared TypeScript shapes for task grades and post-hoc multi-agent evaluation.
 *
 * Belief / MARBLE / moral records remain for legacy runs. New evaluations
 * persist `interaction` from the universal behavioral evaluator.
 */
import type { InteractionEvaluation } from "./interaction/types";
import type { MoralDynamicsEvaluation } from "./moral/types";
export type ProblemEvaluation = {
  problemId: string;
  problemTitle: string;
  turns: number;
  finalAnswer?: string;
  /** Category-specific score; meaning depends on evaluator. */
  score?: number;
  label?: string;
  notes?: string;
  /** Grader-specific structured fields (e.g. crossword metrics). */
  details?: Record<string, string | number | boolean | null | undefined>;
};

export type EvaluationResult = {
  /** Lightweight aggregate fields — not a universal metric. */
  summary: Record<string, number | string>;
  problems: ProblemEvaluation[];
};

/** Preserve normalized + raw evaluator output across schema evolution. */
export type EvaluationArtifact<T> = {
  normalized: T;
  raw: unknown;
};

export type EvaluationComponentStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type EvaluationComponentError = {
  component: "marble" | "belief" | "moral_dynamics" | "interaction";
  message: string;
  at: string;
  retryable: boolean;
};

export type EvaluationCost = {
  model: string;
  provider: "mock" | "openai" | "marble_litellm" | "unknown";
  /**
   * Which evaluator produced this inference call (e.g. "marble", "belief").
   * Used for breakdown accounting without hard-coding evaluator sums.
   */
  evaluator?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  /** Actual USD from calculateModelCost when token usage is available. */
  estimatedCostUsd?: number | null;
};

export type EvaluationStageId =
  | "preparing"
  | "marble"
  | "belief_extraction"
  | "moral_dynamics"
  | "moral_judge"
  | "interaction"
  | "metric_computation"
  | "saving";

export type EvaluationStageState = {
  id: EvaluationStageId;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  detail?: string;
};

export type MarbleMilestone = {
  milestone: string;
  agents: string[];
};

export type MarbleEvaluation = {
  /** Native MultiAgentBench communication score (1–5), or 0 if no communication. */
  communicationScore: number | null;
  /** Native MultiAgentBench planning score (1–5). */
  planningScore: number | null;
  /** Coordination Score = average of communication and planning. */
  coordinationScore: number | null;
  totalMilestones: number;
  agentKpis: Record<string, number>;
  milestones: MarbleMilestone[];
  /** Milestone completion is not a native MARBLE percentage; derived for UI. */
  milestoneCompletion?: number | null;
  marbleCommit?: string;
  marbleVersion?: string;
  adapterVersion: string;
  mode: "posthoc_evaluator";
  limitations: string[];
};

export type AgentIdRef = "agent_a" | "agent_b";

export type BeliefClaimCorrectness =
  | "correct"
  | "incorrect"
  | "partially_correct"
  | "uncertain"
  | "not_applicable";

export type BeliefFinalStatus =
  | "accepted"
  | "rejected"
  | "corrected"
  | "reinforced"
  | "abandoned"
  | "unresolved";

export type BeliefEventAction =
  | "introduce"
  | "support"
  | "challenge"
  | "reject"
  | "accept"
  | "revise"
  | "correct"
  | "reinforce"
  | "defer"
  | "ignore"
  | "clarify"
  | "verify"
  | "misunderstand"
  | "repeat"
  | "reconsider";

export type BeliefClaimKind = "proposal" | "reasoning" | "process";

export type BeliefReferenceStyle = "explicit" | "shorthand" | "none";

export type BeliefEvent = {
  turn: number;
  agent: AgentIdRef;
  action: BeliefEventAction;
  targetClaimId: string;
  resultingBeliefChange?: boolean;
  evidence?: string;
  agreementKind?:
    | "explicit_agreement"
    | "implicit_agreement"
    | "challenge"
    | "clarification_request"
    | "independent_verification"
    | "correction"
    | "revision"
    | "deference"
    | "reinforcement"
    | "other";
  /** This action cites data, a derivation, or a check — not mere assent. */
  hasEvidence?: boolean;
  /** Additional prior claims referenced in this turn (beyond targetClaimId). */
  referencesClaimIds?: string[];
  referenceStyle?: BeliefReferenceStyle;
  /** For shorthand/compressed references: whether the partner resolved it correctly. */
  referenceResolved?: boolean;
  /** Agent's expressed confidence on this action (0–1), omitted if unstated. */
  expressedConfidence?: number;
  /** Restating information already established. */
  isRepetition?: boolean;
  /** Independently re-deriving reasoning the partner already established. */
  isRedundantRederivation?: boolean;
  /** Using previously established info without re-explaining it. */
  reusesEstablishedInfo?: boolean;
  /** Managing collaboration rather than solving the problem. */
  isCoordination?: boolean;
  /** Compressed/shorthand reference to prior context. */
  usesShorthand?: boolean;
  /** Introduces genuinely new substantive information. */
  isNovel?: boolean;
};

export type BeliefClaim = {
  id: string;
  text: string;
  introducedBy: AgentIdRef;
  introducedAtTurn: number;
  correctness: BeliefClaimCorrectness;
  confidence?: number;
  evidence?: string;
  events: BeliefEvent[];
  finalStatus: BeliefFinalStatus;
  /** Candidate solution vs justification vs meta/process talk. */
  kind?: BeliefClaimKind;
  /** Introduction included supporting evidence or derivation. */
  introducedWithEvidence?: boolean;
  /** Claim content is used in / survives into FINAL_ANSWER. */
  survivedIntoFinalAnswer?: boolean;
  /** Genuinely distinct initial hypothesis (not a restatement of the partner). */
  isDistinctHypothesis?: boolean;
};

/**
 * Numerator/denominator with a rate. `rate` is null when there were
 * zero valid opportunities (do not treat as 0%).
 */
export type BeliefFraction = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

/**
 * Directional interpersonal rates.
 * `aToB` = A is the actor, B is the partner
 * (A accepts B, A challenges B, A defers to B, A propagates B's error).
 */
export type BeliefDirectionalFraction = {
  aToB: BeliefFraction;
  bToA: BeliefFraction;
  overall: BeliefFraction;
};

/** Same rate split by claim correctness when ground truth exists. */
export type BeliefTruthSplit = {
  correct: BeliefFraction;
  incorrect: BeliefFraction;
};

export type BeliefContribution = {
  claimsIntroduced: number;
  usefulCorrections: number;
  successfulChallenges: number;
  solutionsProposed: number;
};

export type BeliefTrustMetrics = {
  proposalAcceptance: BeliefDirectionalFraction;
  unsupportedAcceptance: BeliefDirectionalFraction;
  independentVerification: BeliefDirectionalFraction;
  correctionRate: BeliefDirectionalFraction;
  errorPropagation: BeliefDirectionalFraction;
  challengeBeforeAcceptance: BeliefDirectionalFraction;
  correctClaimUptake: BeliefDirectionalFraction;
  incorrectClaimRejection: BeliefDirectionalFraction;
  reconsiderationRate: BeliefDirectionalFraction;
  confidenceTransfer: BeliefDirectionalFraction;
  evidenceSensitivity: {
    supported: BeliefDirectionalFraction;
    unsupported: BeliefDirectionalFraction;
  };
  trustCalibration: {
    acceptGivenCorrect: BeliefDirectionalFraction;
    acceptGivenIncorrect: BeliefDirectionalFraction;
  };
};

export type BeliefAgentVolume = {
  tokens: number | null;
  contentChars: number;
  claimsIntroduced: number;
  proposals: number;
  reasoningEvents: number;
};

export type BeliefAuthorityMetrics = {
  proposalSurvivalAfterDisagreement: BeliefDirectionalFraction;
  directionalDeference: BeliefDirectionalFraction;
  challengeRate: BeliefDirectionalFraction;
  decisionConcentration: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
    dominantAgent: AgentIdRef | null;
  };
  incorrectHighInfluencePersistence: BeliefFraction;
  disagreementWinRate: BeliefDirectionalFraction;
  revisionAsymmetry: BeliefDirectionalFraction;
  challengeSuccessAsymmetry: BeliefDirectionalFraction;
  initiativeConcentration: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
  };
  finalAnswerOwnership: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
    herfindahl: number | null;
  };
  evidenceOverAuthority: BeliefFraction;
  authorityInducedErrorAdoption: BeliefDirectionalFraction;
  authorityInducedCorrection: BeliefDirectionalFraction;
  persistenceUnderCounterevidence: BeliefDirectionalFraction;
  speakingDominance: {
    agent_a: BeliefAgentVolume;
    agent_b: BeliefAgentVolume;
    tokenShareA: number | null;
    claimShareA: number | null;
  };
};

export type BeliefFamiliarityMetrics = {
  repeatedInformationRate: BeliefFraction;
  explicitReferenceRate: BeliefFraction;
  clarificationFrequency: BeliefFraction;
  informationDensity: BeliefFraction;
  misunderstandingFrequency: BeliefFraction;
  misunderstandingCorrectionRate: BeliefFraction;
  redundantRederivationRate: BeliefFraction;
  commonGroundReuse: BeliefFraction;
  referenceResolutionSuccess: BeliefFraction;
  contextualShorthandRate: BeliefFraction;
  coordinationOverhead: BeliefFraction;
  repairCost: {
    meanTurns: number | null;
    meanTokens: number | null;
    episodes: number;
    resolved: number;
  };
  duplicateWorkRate: BeliefFraction;
  novelInformationRate: BeliefFraction;
  informationReuseEfficiency: BeliefFraction;
  compressionFailureRate: BeliefFraction;
  turnToProgressEfficiency: BeliefFraction;
  tokenToProgressEfficiency: BeliefFraction;
};

export type BeliefCrossPolicyMetrics = {
  epistemicDiversity: BeliefFraction;
  prematureConvergence: BeliefFraction;
  recoveryFromFalseConsensus: BeliefFraction;
  usefulDisagreementRate: BeliefFraction;
  wastedDisagreementRate: BeliefFraction;
  novelContributionBalance: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  };
  turnsToConvergence: number | null;
  convergenceQuality: {
    correctConsensus: BeliefFraction;
    falseConsensus: BeliefFraction;
  };
};

export type BeliefDynamicsMetrics = {
  claimsIntroduced: number;
  incorrectClaims: number;
  challengeableClaims: number;
  claimsChallenged: number;
  challenges: number;
  successfulChallenges: number;
  errorCorrectionRate: number | null;
  errorReinforcementRate: number | null;
  challengeRate: number | null;
  successfulChallengeRate: number | null;
  erroneousConvergenceCount: number;
  correctConvergenceCount: number;
  deferenceRate: number | null;
  independentCritiqueRate: number | null;
  contributionBalance: {
    agent_a: BeliefContribution;
    agent_b: BeliefContribution;
  };
  /** True when at least one claim is labeled correct or incorrect. */
  hasCheckableClaims: boolean;
  trust?: BeliefTrustMetrics;
  authority?: BeliefAuthorityMetrics;
  familiarity?: BeliefFamiliarityMetrics;
  crossPolicy?: BeliefCrossPolicyMetrics;
  /** Behavioral rates split by claim correctness when gold exists. */
  truthConditioned?: {
    partnerAcceptance: BeliefTruthSplit;
    partnerReinforcement: BeliefTruthSplit;
    partnerDeference: BeliefTruthSplit;
    proposalSurvival: BeliefTruthSplit;
    challengesAgainst: BeliefTruthSplit;
    abandonmentOfCorrect: BeliefFraction;
    correctionOfIncorrect: BeliefFraction;
  };
};

export type BeliefDynamicsEvaluation = {
  claims: BeliefClaim[];
  events: BeliefEvent[];
  metrics: BeliefDynamicsMetrics;
  graderVersion: string;
  schemaVersion: string;
  validationErrors?: string[];
};

export type EvaluationMetadata = {
  agentAModel: string;
  agentBModel: string;
  trust: number;
  authority: number;
  familiarity: number;
  trustA: number;
  trustB: number;
  evaluatorModel: string;
  evaluationReasoningEffort?: string;
  marbleVersion?: string;
  marbleCommit?: string;
  marbleAdapterVersion?: string;
  evaluationSchemaVersion: string;
  beliefGraderVersion: string;
  beliefGraderSchemaVersion: string;
  problemSet: string;
  problemId: string;
  problemTitle: string;
  runId: string;
  conversationId: string;
  /** Which post-hoc components this evaluation was composed of. */
  postHocComponents?: Array<"marble" | "belief" | "moral_dynamics" | "interaction">;
  moralDynamicsVersion?: string;
  moralDynamicsSchemaVersion?: string;
  moralJudgeVersion?: string;
  interactionEvaluatorVersion?: string;
  interactionSchemaVersion?: string;
};

export type MultiAgentEvaluation = {
  id: string;
  conversationId: string;
  problemId: string;
  runId: string;
  createdAt: string;
  finishedAt?: string;
  evaluatorModel: string;
  reasoningEffort?: "low" | "medium" | "high";
  status: "pending" | "running" | "completed" | "failed";
  stages: EvaluationStageState[];
  marble?: EvaluationArtifact<MarbleEvaluation>;
  beliefDynamics?: EvaluationArtifact<BeliefDynamicsEvaluation>;
  moralDynamics?: EvaluationArtifact<MoralDynamicsEvaluation>;
  interaction?: EvaluationArtifact<InteractionEvaluation>;
  componentStatus: {
    marble: EvaluationComponentStatus;
    belief: EvaluationComponentStatus;
    moralDynamics?: EvaluationComponentStatus;
    interaction?: EvaluationComponentStatus;
  };
  errors: EvaluationComponentError[];
  costs: EvaluationCost[];
  /** Aggregated usage across all LLM calls for this evaluation execution. */
  usage?: {
    inputTokens: number;
    cachedInputTokens?: number;
    outputTokens: number;
  };
  costUsd?: number | null;
  metadata: EvaluationMetadata;
};
