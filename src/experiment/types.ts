import type { AgentId, AgentPromptPair } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import type {
  EvaluationResult,
  MultiAgentEvaluation,
} from "../evaluation/types";
import type { ModelUsage } from "../models/usage";
import type { ReasoningEffort } from "../models/modelRegistry";
import type { ProblemCategory } from "../problems/types";

export type { ModelUsage, ReasoningEffort };

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
};

export type ConversationMessage = {
  id: string;
  agentId: AgentId;
  role: "assistant";
  content: string;
  timestamp?: string;
  turnIndex: number;
  /** Wall-clock time for the model call that produced this message. */
  durationMs?: number;
  usage?: MessageUsage;
};

export type ProblemConversation = {
  problemId: string;
  problemTitle: string;
  problemText: string;
  messages: ConversationMessage[];
  finalAnswer?: string;
  stoppedReason: "final_answer" | "max_turns" | "cancelled" | "error";
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
