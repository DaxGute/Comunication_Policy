import type { AgentId, AgentPromptPair } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import type { EvaluationResult } from "../evaluation/types";
import type { ProblemCategory } from "../problems/types";

/** Token counts returned by the model provider for one turn. */
export type MessageUsage = {
  promptTokens?: number;
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
  stoppedReason: "final_answer" | "max_turns" | "cancelled";
};

export type RunConfig = {
  problemCategory: ProblemCategory;
  problemCount: number;
  model: string;
  /** Derived from model id; snapshotted onto each run for experiment integrity. */
  provider: "mock" | "openai";
  maxTurns: number;
  temperature: number;
};

export type ExperimentRun = {
  id: string;
  createdAt: string;
  /** Set when the run leaves `running` (completed, failed, or cancelled). */
  finishedAt?: string;
  /** Snapshot — immutable after creation. */
  policy: CommunicationPolicy;
  /** Exact prompts used for this run. */
  agentPrompts: AgentPromptPair;
  config: RunConfig;
  conversations: ProblemConversation[];
  evaluation?: EvaluationResult;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: string;
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
  isRunning: boolean;
  runProgress?: RunProgress;
};
