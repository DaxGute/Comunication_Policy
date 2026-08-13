import { createCommunicationPolicy } from "../communication/policy";
import type {
  EvaluationResult,
  MultiAgentEvaluation,
  ProblemEvaluation,
} from "../evaluation/types";
import { normalizeUsage, type ModelUsage } from "../models/usage";
import type { ProblemCategory } from "../problems/types";
import { normalizeRunConfig } from "./configAccessors";
import { AVAILABLE_MODEL_IDS, DEFAULT_RUN_CONFIG } from "./defaults";
import { syncRunCostFields } from "./runCost";
import type {
  ConversationMessage,
  ExperimentRun,
  ProblemConversation,
  RunConfig,
} from "./types";

const RUN_CONFIG_KEY = "communication-policy:run-config";
const RUN_SETTINGS_OPEN_KEY = "communication-policy:run-settings-open";
const RUNS_KEY = "communication-policy:runs";
const SELECTION_KEY = "communication-policy:selection";

const VALID_CATEGORIES = new Set<ProblemCategory>([
  "crossword",
  "moral_philosophical",
  "proof",
]);

const VALID_STATUSES = new Set([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const VALID_STOPPED = new Set([
  "final_answer",
  "max_turns",
  "cancelled",
  "error",
]);

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function parseOptionalCost(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function parseModelUsage(raw: unknown): ModelUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return normalizeUsage(raw as Record<string, unknown>);
}

export function loadRunConfig(): RunConfig {
  try {
    const raw = localStorage.getItem(RUN_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_RUN_CONFIG };

    const parsed = JSON.parse(raw) as Partial<RunConfig> & { model?: string };
    const category = parsed.problemCategory;

    // Prefer registry allowlist for the *current* settings picker; unknown
    // historical IDs fall back to the default Terra model.
    const candidateRunModel =
      typeof parsed.runModel === "string"
        ? parsed.runModel
        : typeof parsed.model === "string"
          ? parsed.model
          : undefined;
    const runModel =
      candidateRunModel && AVAILABLE_MODEL_IDS.includes(candidateRunModel)
        ? candidateRunModel
        : DEFAULT_RUN_CONFIG.runModel;

    const candidateEvalModel =
      typeof parsed.evaluationModel === "string"
        ? parsed.evaluationModel
        : undefined;
    const evaluationModel =
      candidateEvalModel && AVAILABLE_MODEL_IDS.includes(candidateEvalModel)
        ? candidateEvalModel
        : DEFAULT_RUN_CONFIG.evaluationModel;

    return normalizeRunConfig(
      {
        ...parsed,
        problemCategory:
          typeof category === "string" &&
          VALID_CATEGORIES.has(category as ProblemCategory)
            ? (category as ProblemCategory)
            : DEFAULT_RUN_CONFIG.problemCategory,
        problemCount: clamp(Number(parsed.problemCount), 1, 150),
        runModel,
        evaluationModel,
        maxTurns: clamp(Number(parsed.maxTurns), 1, 40),
        temperature: clamp(Number(parsed.temperature), 0, 2),
      },
      DEFAULT_RUN_CONFIG,
    );
  } catch {
    return { ...DEFAULT_RUN_CONFIG };
  }
}

export function saveRunConfig(config: RunConfig): void {
  try {
    localStorage.setItem(RUN_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function loadRunSettingsOpen(): boolean {
  try {
    const raw = localStorage.getItem(RUN_SETTINGS_OPEN_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveRunSettingsOpen(open: boolean): void {
  try {
    localStorage.setItem(RUN_SETTINGS_OPEN_KEY, String(open));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export type PersistedSelection = {
  selectedRunId?: string;
  selectedProblemId?: string;
};

export function loadSelection(): PersistedSelection {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSelection;
    return {
      selectedRunId:
        typeof parsed.selectedRunId === "string"
          ? parsed.selectedRunId
          : undefined,
      selectedProblemId:
        typeof parsed.selectedProblemId === "string"
          ? parsed.selectedProblemId
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveSelection(selection: PersistedSelection): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function parseRunConfig(raw: unknown): RunConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed = raw as Partial<RunConfig> & { model?: string };
  const category = parsed.problemCategory;
  if (
    typeof category !== "string" ||
    !VALID_CATEGORIES.has(category as ProblemCategory)
  ) {
    return undefined;
  }

  // Historical runs may contain model IDs no longer in the picker allowlist.
  return normalizeRunConfig(
    {
      ...parsed,
      problemCategory: category as ProblemCategory,
      problemCount: clamp(Number(parsed.problemCount), 1, 150),
      maxTurns: clamp(Number(parsed.maxTurns), 1, 40),
      temperature: clamp(Number(parsed.temperature), 0, 2),
    },
    DEFAULT_RUN_CONFIG,
  );
}

function parseUsage(raw: unknown): ConversationMessage["usage"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const normalized = normalizeUsage(u);
  if (!normalized) {
    if (typeof u.totalTokens !== "number" || !Number.isFinite(u.totalTokens)) {
      return undefined;
    }
    return {
      totalTokens: Math.max(0, Math.round(u.totalTokens)),
    };
  }
  return {
    inputTokens: normalized.inputTokens,
    promptTokens: normalized.inputTokens,
    cachedInputTokens: normalized.cachedInputTokens,
    outputTokens: normalized.outputTokens,
    completionTokens: normalized.outputTokens,
    totalTokens: normalized.inputTokens + normalized.outputTokens,
  };
}

function parseModelRequest(
  raw: unknown,
): ConversationMessage["modelRequest"] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const messages: NonNullable<ConversationMessage["modelRequest"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as { role?: unknown; content?: unknown };
    if (
      row.role !== "system" &&
      row.role !== "user" &&
      row.role !== "assistant"
    ) {
      return undefined;
    }
    if (typeof row.content !== "string") return undefined;
    messages.push({ role: row.role, content: row.content });
  }
  return messages;
}

function parseMessage(raw: unknown): ConversationMessage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Partial<ConversationMessage>;
  if (typeof m.id !== "string" || typeof m.content !== "string") return undefined;
  if (m.agentId !== "agent_a" && m.agentId !== "agent_b") return undefined;
  if (typeof m.turnIndex !== "number") return undefined;
  const sender =
    m.sender === "agent_a" || m.sender === "agent_b" ? m.sender : m.agentId;
  const recipient =
    m.recipient === "agent_a" || m.recipient === "agent_b"
      ? m.recipient
      : undefined;
  return {
    id: m.id,
    agentId: m.agentId,
    sender,
    recipient,
    role: "assistant",
    content: m.content,
    turnIndex: m.turnIndex,
    timestamp: typeof m.timestamp === "string" ? m.timestamp : undefined,
    durationMs:
      typeof m.durationMs === "number" && Number.isFinite(m.durationMs)
        ? Math.max(0, m.durationMs)
        : undefined,
    usage: parseUsage(m.usage),
    modelRequest: parseModelRequest(m.modelRequest),
  };
}

function parseConversation(raw: unknown): ProblemConversation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Partial<ProblemConversation>;
  if (
    typeof c.problemId !== "string" ||
    typeof c.problemTitle !== "string" ||
    typeof c.problemText !== "string"
  ) {
    return undefined;
  }
  if (
    typeof c.stoppedReason !== "string" ||
    !VALID_STOPPED.has(c.stoppedReason)
  ) {
    return undefined;
  }
  if (!Array.isArray(c.messages)) return undefined;
  const messages = c.messages
    .map(parseMessage)
    .filter((m): m is ConversationMessage => Boolean(m));
  return {
    problemId: c.problemId,
    problemTitle: c.problemTitle,
    problemText: c.problemText,
    messages,
    finalAnswer: typeof c.finalAnswer === "string" ? c.finalAnswer : undefined,
    stoppedReason: c.stoppedReason as ProblemConversation["stoppedReason"],
    error: typeof c.error === "string" ? c.error : undefined,
    status: c.status === "running" ? "running" : undefined,
    speakingAgentId:
      c.speakingAgentId === "agent_a" || c.speakingAgentId === "agent_b"
        ? c.speakingAgentId
        : undefined,
    conversationUsage: parseModelUsage(c.conversationUsage),
    conversationCostUsd: parseOptionalCost(c.conversationCostUsd),
  };
}

function parseProblemEvaluation(raw: unknown): ProblemEvaluation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Partial<ProblemEvaluation>;
  if (
    typeof p.problemId !== "string" ||
    typeof p.problemTitle !== "string" ||
    typeof p.turns !== "number"
  ) {
    return undefined;
  }
  return {
    problemId: p.problemId,
    problemTitle: p.problemTitle,
    turns: p.turns,
    finalAnswer: typeof p.finalAnswer === "string" ? p.finalAnswer : undefined,
    score: typeof p.score === "number" ? p.score : undefined,
    label: typeof p.label === "string" ? p.label : undefined,
    notes: typeof p.notes === "string" ? p.notes : undefined,
    details:
      p.details && typeof p.details === "object"
        ? (p.details as ProblemEvaluation["details"])
        : undefined,
  };
}

function parseEvaluation(raw: unknown): EvaluationResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Partial<EvaluationResult>;
  if (!e.summary || typeof e.summary !== "object" || !Array.isArray(e.problems)) {
    return undefined;
  }
  const problems = e.problems
    .map(parseProblemEvaluation)
    .filter((p): p is ProblemEvaluation => Boolean(p));
  const summary: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(e.summary)) {
    if (typeof value === "number" || typeof value === "string") {
      summary[key] = value;
    }
  }
  return { summary, problems };
}

function parseMultiAgentEvaluation(
  raw: unknown,
): MultiAgentEvaluation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Partial<MultiAgentEvaluation>;
  if (
    typeof e.id !== "string" ||
    typeof e.conversationId !== "string" ||
    typeof e.problemId !== "string" ||
    typeof e.runId !== "string" ||
    typeof e.createdAt !== "string" ||
    typeof e.evaluatorModel !== "string" ||
    typeof e.status !== "string"
  ) {
    return undefined;
  }
  // Trust stored shape; UI/orchestrator own schema evolution via versions.
  return e as MultiAgentEvaluation;
}

function parseRun(raw: unknown): ExperimentRun | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<ExperimentRun>;
  if (typeof r.id !== "string" || typeof r.createdAt !== "string") {
    return undefined;
  }
  if (typeof r.status !== "string" || !VALID_STATUSES.has(r.status)) {
    return undefined;
  }
  const config = parseRunConfig(r.config);
  if (!config) return undefined;
  if (!r.policy || typeof r.policy !== "object") return undefined;
  if (!r.agentPrompts || typeof r.agentPrompts !== "object") return undefined;
  const prompts = r.agentPrompts as { agentA?: unknown; agentB?: unknown };
  if (typeof prompts.agentA !== "string" || typeof prompts.agentB !== "string") {
    return undefined;
  }
  if (!Array.isArray(r.conversations)) return undefined;

  const conversations = r.conversations
    .map(parseConversation)
    .filter((c): c is ProblemConversation => Boolean(c));

  let status = r.status as ExperimentRun["status"];
  let error = typeof r.error === "string" ? r.error : undefined;
  let finishedAt = typeof r.finishedAt === "string" ? r.finishedAt : undefined;
  // Browser reload must NOT fail runs — server owns execution. Legacy
  // localStorage snapshots of in-flight runs are only used for one-time
  // migration onto the server (see loadLegacyRunsForMigration).

  const multiAgentEvaluations = Array.isArray(r.multiAgentEvaluations)
    ? r.multiAgentEvaluations
        .map(parseMultiAgentEvaluation)
        .filter((e): e is MultiAgentEvaluation => Boolean(e))
    : undefined;

  return {
    id: r.id,
    createdAt: r.createdAt,
    startedAt: typeof r.startedAt === "string" ? r.startedAt : undefined,
    finishedAt,
    title:
      typeof r.title === "string" && r.title.trim().length > 0
        ? r.title.trim()
        : undefined,
    policy: createCommunicationPolicy(r.policy),
    agentPrompts: { agentA: prompts.agentA, agentB: prompts.agentB },
    config,
    conversations,
    evaluation: parseEvaluation(r.evaluation),
    multiAgentEvaluations:
      multiAgentEvaluations && multiAgentEvaluations.length > 0
        ? multiAgentEvaluations
        : undefined,
    conversationUsage: parseModelUsage(r.conversationUsage),
    conversationCostUsd: parseOptionalCost(r.conversationCostUsd),
    evaluationUsage: parseModelUsage(r.evaluationUsage),
    evaluationCostUsd: parseOptionalCost(r.evaluationCostUsd),
    totalCostUsd: parseOptionalCost(r.totalCostUsd),
    status,
    error,
  };
}

const LEGACY_MIGRATED_KEY = "communication-policy:runs-migrated-to-server";

/**
 * One-time read of historical browser-local runs for server import.
 * No longer authoritative — server `.data/runs.json` owns execution state.
 */
export function loadLegacyRunsForMigration(): ExperimentRun[] {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) === "true") return [];
    return loadRuns();
  } catch {
    return [];
  }
}

export function markLegacyRunsMigrated(): void {
  try {
    localStorage.setItem(LEGACY_MIGRATED_KEY, "true");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/** @deprecated Prefer server `/api/runs`. Kept for one-time migration. */
export function loadRuns(): ExperimentRun[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseRun)
      .filter((r): r is ExperimentRun => Boolean(r))
      .map((run) => {
        // Re-derive totals from usage records so evaluation spend survives reload.
        syncRunCostFields(run);
        return run;
      });
  } catch {
    return [];
  }
}

/** @deprecated Runs are persisted on the server. */
export function saveRuns(_runs: ExperimentRun[]): void {
  // No-op: server RunManager is authoritative.
}
