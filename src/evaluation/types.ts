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
  component: "marble" | "belief";
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
  | "verify";

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
    agent_a: {
      claimsIntroduced: number;
      usefulCorrections: number;
      successfulChallenges: number;
      solutionsProposed: number;
    };
    agent_b: {
      claimsIntroduced: number;
      usefulCorrections: number;
      successfulChallenges: number;
      solutionsProposed: number;
    };
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
  componentStatus: {
    marble: EvaluationComponentStatus;
    belief: EvaluationComponentStatus;
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
