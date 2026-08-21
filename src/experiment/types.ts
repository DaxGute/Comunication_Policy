import type { AgentId, AgentPromptPair } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import type {
  EvaluationResult,
  MultiAgentEvaluation,
} from "../evaluation/types";
import type {
  InformationAssignment,
  InformationFlowMetrics,
  InformationStructureConfig,
} from "../information/types";
import type { ModelUsage } from "../models/usage";
import type { ReasoningEffort } from "../models/modelRegistry";
import type { ProblemCategory } from "../problems/types";
import type {
  FinalAnswerSupport,
  PropositionVersion,
  ReasoningEvent,
  ReasoningMutation,
  ReasoningSubject,
} from "../reasoning/types";
import type { ReasoningGraphDiagnostics } from "../reasoning/diagnostics";
import type { TranscriptProtocol } from "./transcriptProtocol";

export type { ModelUsage, ReasoningEffort, TranscriptProtocol };

/** How token counts on a message were obtained. */
export type UsageSource = "provider" | "estimated";

/** Token counts returned by the model provider for one turn. */
export type MessageUsage = {
  /** Preferred canonical field. */
  inputTokens?: number;
  /** Legacy alias for inputTokens. */
  promptTokens?: number;
  cachedInputTokens?: number;
  /** Preferred canonical field. */
  outputTokens?: number;
  /** Legacy alias for outputTokens. */
  completionTokens?: number;
  totalTokens: number;
  /**
   * `provider` = authoritative API usage. `estimated` = heuristic (mock).
   * Absent on historical messages. Never mix an estimate into provider totals.
   */
  source?: UsageSource;
};

/**
 * Character/structure telemetry for the request that produced a turn.
 * Independent of provider token counts — always available even when usage is missing.
 */
export type TranscriptRequestTelemetry = {
  turnNumber: number;
  speaker: AgentId;
  /** Sum of prior utterance `content` lengths (no speaker prefixes). */
  transcriptCharactersBeforeTurn: number;
  transcriptMessagesBeforeTurn: number;
  requestCharacters: number;
  systemPromptCharacters: number;
  problemCharacters: number;
  /** History actually included in the model request (previous partner utterance only). */
  historyCharacters: number;
  graphSubjectCount?: number;
  graphActiveValueCount?: number;
  graphHistoryVersionCount?: number;
  graphSerializedChars?: number;
  previousUtteranceChars?: number;
  /** Always 0 in schema v2: older transcript is not model working memory. */
  historicalTranscriptCharsIncluded?: number;
};

export type ConversationMessage = {
  id: string;
  /** Canonical sender. */
  agentId: AgentId;
  sender?: AgentId;
  recipient?: AgentId;
  /**
   * Persisted provider role for this stored utterance. Not the canonical
   * inter-agent representation — see AgentUtterance / renderModelRequest.
   */
  role: "assistant";
  content: string;
  timestamp?: string;
  turnIndex: number;
  /** Wall-clock time for the model call that produced this message. */
  durationMs?: number;
  usage?: MessageUsage;
  /** Exact chat-completions messages sent to produce this utterance. */
  modelRequest?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  /** Context-size telemetry for the request that produced this utterance. */
  requestTelemetry?: TranscriptRequestTelemetry;
  /**
   * Exact model output when it differs from `content` (JSON envelope).
   * `content` is always the natural-language utterance.
   */
  rawContent?: string;
  /** Speaker-authored mutations parsed from this turn. */
  reasoningMutations?: ReasoningMutation[];
  /**
   * Speaker declared that the turn adds no persistent reasoning.
   * Used as a rare, visible moral-finalization escape hatch.
   */
  nothingToAdd?: boolean;
  /**
   * Protocol metadata: speaker judges shared reasoning ready to finalize.
   * Bound to graph fingerprint by the controller. Not graph state.
   */
  readyToFinalize?: boolean;
  /**
   * Optional inspection metadata: consideration ids this turn focused on.
   * Not graph state.
   */
  focusSubjectIds?: string[];
  /** True when this turn accepted a material SET/REVISE/REMOVE. */
  materialGraphChange?: boolean;
  /** True when readiness was cleared because this turn changed the graph. */
  readinessInvalidated?: boolean;
};

export type ProblemConversation = {
  problemId: string;
  problemTitle: string;
  problemText: string;
  /**
   * Per-agent problem views when information overlap < 1.0 (or whenever
   * asymmetric packets are constructed). Researcher audit only — partner
   * prompts never receive the other agent's private packet.
   */
  problemTextByAgent?: {
    agent_a: string;
    agent_b: string;
  };
  /** Realized information partition for this conversation (reproducibility). */
  informationAssignment?: InformationAssignment;
  /** Deterministic private-info flow metrics (post-run). */
  informationFlowMetrics?: InformationFlowMetrics;
  messages: ConversationMessage[];
  finalAnswer?: string;
  /**
   * Lineage from the submitted answer into the reasoning graph.
   * Absent on legacy runs and when the model did not cite supporting nodes.
   */
  finalAnswerSupport?: FinalAnswerSupport;
  /**
   * Explicit final-synthesis provenance (proposition version ids).
   * Not a graph mutation. Absent when undeclared.
   */
  finalBasisVersionIds?: string[];
  finalBasisDeclared?: boolean;
  finalBasisErrors?: string[];
  /**
   * Task/private evidence ids cited in FINAL_ANSWER support.
   * Separate from finalBasisVersionIds (graph provenance).
   */
  finalSourceInformationIds?: string[];
  /**
   * Structured reasoning snapshot. Events are authoritative. Versions are a
   * cache reproducible by replaying accepted events from empty state.
   */
  reasoningSchemaVersion?: 1 | 2;
  reasoningEvents?: ReasoningEvent[];
  reasoningSubjects?: ReasoningSubject[];
  reasoningVersions?: PropositionVersion[];
  /** Snapshot of canonical state at termination. */
  finalGraphState?: {
    subjects: ReasoningSubject[];
    versions: PropositionVersion[];
  };
  /**
   * Dense-graph records from schema-1 runs. Inspectable, never converted
   * into versioned proposition state.
   */
  legacyReasoningSnapshot?: {
    nodes?: unknown[];
    events?: unknown[];
  };
  /** Deterministic graph-quality measurements computed when the problem ends. */
  reasoningDiagnostics?: ReasoningGraphDiagnostics;
  stoppedReason:
    | "final_answer"
    | "max_turns"
    | "cancelled"
    | "error"
    | "reasoning_protocol_stalled";
  /**
   * Set while this problem is mid-run (streaming into the inspector).
   * Cleared once the problem finishes.
   */
  status?: "running";
  /**
   * Live speaker for this problem while `status === "running"`.
   * Scoped per problem so parallel problems and UI selection stay independent.
   */
  speakingAgentId?: AgentId;
  /** Present when `stoppedReason` is `error` (e.g. provider rate limit). */
  error?: string;
  /** Sum of all agent model calls for this problem. */
  conversationUsage?: ModelUsage;
  conversationCostUsd?: number | null;
  /** Derived communication-efficiency aggregates for analysis/export. */
  conversationEfficiency?: ConversationEfficiencyStats;
};

/** Problem-level token/length aggregates. Derived from the transcript. */
export type ConversationEfficiencyStats = {
  turnCount: number;
  finalTranscriptCharacters: number;
  finalTranscriptMessages: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalConversationTokens?: number;
  averageInputTokensPerTurn?: number;
  averageOutputTokensPerUtterance?: number;
  conversationCostUsd?: number | null;
  /** Present when at least one turn recorded a usage source. */
  usageSource?: UsageSource | "mixed";
};

/**
 * Experiment run settings. Model fields are experimental conditions —
 * snapshotted onto each run and never inferred from current UI later.
 */
export type RunConfig = {
  problemCategory: ProblemCategory;
  problemCount: number;
  /** Conversation / agent model. */
  runModel: string;
  runReasoningEffort: ReasoningEffort;
  /** Independent judge model for post-hoc evaluation. */
  evaluationModel: string;
  evaluationReasoningEffort: ReasoningEffort;
  /** When true, pre-run cost estimate includes an evaluation pass. */
  evaluationEnabled: boolean;
  /** Derived from runModel; snapshotted onto each run for experiment integrity. */
  provider: "mock" | "openai";
  maxTurns: number;
  temperature: number;
  /** Recovery turns after a freeze warning before FINALIZATION REQUIRED. */
  stallRecoveryTurns?: number;
  /** Unchanged-turn threshold that detects a freeze (finalization follows the recovery window). */
  stallFailTurns?: number;
  /** Consecutive turns on the same unresolved issue(s) before diversification. */
  localLoopTurns?: number;
  /** Recent fingerprint window used to detect small state cycles. */
  cycleWindowTurns?: number;
  /**
   * Primary moral subject initialization. Default is agent-created (empty graph).
   */
  moralSubjectInitialization?: "agent-created";
  /**
   * @deprecated Legacy alias. Historical values are normalized to agent-created.
   * Prefer moralSubjectInitialization.
   */
  moralSubjectSeeding?:
    | "agent-created"
    | "explicit-task-seeded"
    | "none"
    | "explicit-task-only";
  /**
   * Information overlap ∈ [0.5, 1.0].
   * 1.0 = identical packets; 0.5 = fully partitioned when feasible.
   * Orthogonal to communication policy (trust / authority / familiarity).
   * Each run draws a fresh random partition (snapshotted on the conversation).
   */
  informationOverlap?: number;
  /** Snapshotted information-structure metadata for the run (includes draw nonce). */
  informationStructure?: InformationStructureConfig;
};

export type ExperimentRun = {
  id: string;
  createdAt: string;
  /** Set when server-side execution begins (leaves `queued`). */
  startedAt?: string;
  /** Set when the run leaves `running` (completed, failed, or cancelled). */
  finishedAt?: string;
  /**
   * Optional display name. When unset, the UI shows the run finish timestamp.
   * Editable from the conversation inspector; persisted with the run.
   */
  title?: string;
  /** Snapshot — immutable after creation. */
  policy: CommunicationPolicy;
  /** Exact prompts used for this run. */
  agentPrompts: AgentPromptPair;
  /**
   * How agent context was constructed for this run. Absent on pre-metadata
   * snapshots, which used full-history prefixed-assistant
   * (`full-history-v1`). Current runs use `graph-memory-v2`.
   */
  transcriptProtocol?: TranscriptProtocol;
  config: RunConfig;
  conversations: ProblemConversation[];
  evaluation?: EvaluationResult;
  /**
   * Post-hoc multi-agent evaluations. Multiple records per conversation are
   * kept so re-runs with a different judge model do not overwrite history.
   */
  multiAgentEvaluations?: MultiAgentEvaluation[];
  /** Aggregated conversation token usage across all problems. */
  conversationUsage?: ModelUsage;
  conversationCostUsd?: number | null;
  /** Aggregated evaluation token usage across all evaluation executions. */
  evaluationUsage?: ModelUsage;
  evaluationCostUsd?: number | null;
  totalCostUsd?: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  error?: string;
  /** Live progress while the run is queued/running (server-authoritative). */
  progress?: RunProgress;
  /**
   * Server-side OpenAI scheduler snapshot (concurrency / rate-limit pressure).
   * Absent on mock runs and historical records.
   */
  runtimeDiagnostics?: {
    openai?: OpenAIRuntimeDiagnostics;
  };
};

/** Lightweight OpenAI scheduler diagnostics persisted with a run. */
export type OpenAIRuntimeDiagnostics = {
  inFlight: number;
  queued: number;
  queuedPeak: number;
  requestsCompleted: number;
  retryCount: number;
  rateLimitCount: number;
  peakConcurrency: number;
  approxRecentRpm: number;
  approxRecentTpm: number;
  bottleneck: "rpm" | "tpm" | "concurrency" | "cooldown" | null;
  models?: Record<
    string,
    {
      inFlight: number;
      recentRpm: number;
      recentTpm: number;
      advertisedRpm: number;
      advertisedTpm: number;
    }
  >;
};

/** Live run progress for the Run button progress bar (0–1). */
export type RunProgress = {
  fraction: number;
  completedProblems: number;
  totalProblems: number;
};

export type ExperimentState = {
  currentPolicy: CommunicationPolicy;
  currentRunConfig: RunConfig;
  runs: ExperimentRun[];
  selectedRunId?: string;
  selectedProblemId?: string;
  /** Which agent is currently speaking during a live run (UI hint). */
  speakingAgentId?: AgentId;
  /** True while at least one experiment run is in flight. */
  isRunning: boolean;
  /** Live progress keyed by run id (active runs only). */
  runProgressById: Record<string, RunProgress>;
};
