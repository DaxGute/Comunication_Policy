/**
 * Defensive parsers for persisted run JSON (localStorage migration + server snapshots).
 *
 * Load/save keys and public persistence API live in persistence.ts.
 */
import { createCommunicationPolicy } from "../communication/policy";
import type {
  EvaluationResult,
  MultiAgentEvaluation,
  ProblemEvaluation,
} from "../evaluation/types";
import { normalizeUsage, type ModelUsage } from "../models/usage";
import type { ProblemCategory } from "../problems/types";
import { normalizeRunConfig } from "./configAccessors";
import { DEFAULT_RUN_CONFIG } from "./defaults";
import { resolveTranscriptProtocol } from "./transcriptProtocol";
import type {
  ConversationMessage,
  ExperimentRun,
  ProblemConversation,
  RunConfig,
  TranscriptRequestTelemetry,
  ConversationEfficiencyStats,
  UsageSource,
} from "./types";
import {
  hydrateReasoningGraph,
  parseReasoningEvent,
  parseReasoningIntent,
  parseReasoningNode,
  parseReasoningOperation,
  parseReasoningSubject,
} from "../reasoning";
import type { FinalAnswerSupport } from "../reasoning/types";
import type { ReasoningGraphDiagnostics } from "../reasoning/diagnostics";

export const VALID_CATEGORIES = new Set<ProblemCategory>([
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

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function parseOptionalCost(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function parseModelUsage(raw: unknown): ModelUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return normalizeUsage(raw as Record<string, unknown>);
}

export function parseRunConfig(raw: unknown): RunConfig | undefined {
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

function parseUsageSource(raw: unknown): UsageSource | undefined {
  return raw === "provider" || raw === "estimated" ? raw : undefined;
}

function parseUsage(raw: unknown): ConversationMessage["usage"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const normalized = normalizeUsage(u);
  const source = parseUsageSource(u.source);
  if (!normalized) {
    if (typeof u.totalTokens !== "number" || !Number.isFinite(u.totalTokens)) {
      return undefined;
    }
    return {
      totalTokens: Math.max(0, Math.round(u.totalTokens)),
      ...(source ? { source } : {}),
    };
  }
  return {
    inputTokens: normalized.inputTokens,
    promptTokens: normalized.inputTokens,
    cachedInputTokens: normalized.cachedInputTokens,
    outputTokens: normalized.outputTokens,
    completionTokens: normalized.outputTokens,
    totalTokens: normalized.inputTokens + normalized.outputTokens,
    ...(source ? { source } : {}),
  };
}

function parseRequestTelemetry(
  raw: unknown,
): TranscriptRequestTelemetry | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const t = raw as Partial<TranscriptRequestTelemetry>;
  if (t.speaker !== "agent_a" && t.speaker !== "agent_b") return undefined;
  if (typeof t.turnNumber !== "number" || !Number.isFinite(t.turnNumber)) {
    return undefined;
  }
  if (
    typeof t.transcriptMessagesBeforeTurn !== "number" ||
    !Number.isFinite(t.transcriptMessagesBeforeTurn)
  ) {
    return undefined;
  }
  return {
    turnNumber: Math.max(0, Math.round(t.turnNumber)),
    speaker: t.speaker,
    transcriptCharactersBeforeTurn:
      typeof t.transcriptCharactersBeforeTurn === "number" &&
      Number.isFinite(t.transcriptCharactersBeforeTurn)
        ? Math.max(0, Math.round(t.transcriptCharactersBeforeTurn))
        : 0,
    transcriptMessagesBeforeTurn: Math.max(
      0,
      Math.round(t.transcriptMessagesBeforeTurn),
    ),
    requestCharacters:
      typeof t.requestCharacters === "number" &&
      Number.isFinite(t.requestCharacters)
        ? Math.max(0, Math.round(t.requestCharacters))
        : 0,
    systemPromptCharacters:
      typeof t.systemPromptCharacters === "number" &&
      Number.isFinite(t.systemPromptCharacters)
        ? Math.max(0, Math.round(t.systemPromptCharacters))
        : 0,
    problemCharacters:
      typeof t.problemCharacters === "number" &&
      Number.isFinite(t.problemCharacters)
        ? Math.max(0, Math.round(t.problemCharacters))
        : 0,
    historyCharacters:
      typeof t.historyCharacters === "number" &&
      Number.isFinite(t.historyCharacters)
        ? Math.max(0, Math.round(t.historyCharacters))
        : 0,
  };
}

function parseConversationEfficiency(
  raw: unknown,
): ConversationEfficiencyStats | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Partial<ConversationEfficiencyStats>;
  if (typeof e.turnCount !== "number" || !Number.isFinite(e.turnCount)) {
    return undefined;
  }
  const usageSource =
    e.usageSource === "provider" ||
    e.usageSource === "estimated" ||
    e.usageSource === "mixed"
      ? e.usageSource
      : undefined;
  return {
    turnCount: Math.max(0, Math.round(e.turnCount)),
    finalTranscriptCharacters:
      typeof e.finalTranscriptCharacters === "number"
        ? Math.max(0, Math.round(e.finalTranscriptCharacters))
        : 0,
    finalTranscriptMessages:
      typeof e.finalTranscriptMessages === "number"
        ? Math.max(0, Math.round(e.finalTranscriptMessages))
        : Math.max(0, Math.round(e.turnCount)),
    totalInputTokens:
      typeof e.totalInputTokens === "number"
        ? Math.max(0, e.totalInputTokens)
        : undefined,
    totalOutputTokens:
      typeof e.totalOutputTokens === "number"
        ? Math.max(0, e.totalOutputTokens)
        : undefined,
    totalConversationTokens:
      typeof e.totalConversationTokens === "number"
        ? Math.max(0, e.totalConversationTokens)
        : undefined,
    averageInputTokensPerTurn:
      typeof e.averageInputTokensPerTurn === "number"
        ? e.averageInputTokensPerTurn
        : undefined,
    averageOutputTokensPerUtterance:
      typeof e.averageOutputTokensPerUtterance === "number"
        ? e.averageOutputTokensPerUtterance
        : undefined,
    conversationCostUsd: parseOptionalCost(e.conversationCostUsd),
    usageSource,
  };
}

function parseReasoningDiagnostics(
  raw: unknown,
): ReasoningGraphDiagnostics | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<ReasoningGraphDiagnostics>;
  const requiredNumbers: Array<keyof ReasoningGraphDiagnostics> = [
    "nodeCount",
    "nodesPerTurn",
    "proposalCount",
    "claimCount",
    "evidenceCount",
    "issueCount",
    "atomicityWarningCount",
    "unlinkedNodeCount",
    "relationshipCount",
    "relationshipCoverage",
    "evidenceUsage",
    "finalSupportingNodeCount",
    "invalidFinalSupportCount",
  ];
  if (
    requiredNumbers.some(
      (key) => typeof value[key] !== "number" || !Number.isFinite(value[key]),
    ) ||
    !Array.isArray(value.atomicityWarnings)
  ) {
    return undefined;
  }
  return value as ReasoningGraphDiagnostics;
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
    requestTelemetry: parseRequestTelemetry(m.requestTelemetry),
    rawContent: typeof m.rawContent === "string" ? m.rawContent : undefined,
    reasoningIntents: Array.isArray(m.reasoningIntents)
      ? m.reasoningIntents.map((intent) => parseReasoningIntent(intent))
      : undefined,
    reasoningOperations: Array.isArray(m.reasoningOperations)
      ? m.reasoningOperations
          .map(parseReasoningOperation)
          .filter((op): op is NonNullable<typeof op> => Boolean(op))
      : undefined,
  };
}

function parseFinalAnswerSupport(raw: unknown): FinalAnswerSupport | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed = raw as {
    text?: unknown;
    supportingNodeIds?: unknown;
    errors?: unknown;
  };
  const supportingNodeIds = Array.isArray(parsed.supportingNodeIds)
    ? parsed.supportingNodeIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const errors = Array.isArray(parsed.errors)
    ? parsed.errors.filter((item): item is string => typeof item === "string")
    : [];
  const text = typeof parsed.text === "string" ? parsed.text : undefined;
  if (!text && supportingNodeIds.length === 0 && errors.length === 0) {
    return undefined;
  }
  return { text, supportingNodeIds, errors };
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
  const hasReasoning =
    Array.isArray(c.reasoningSubjects) ||
    Array.isArray(c.reasoningNodes) ||
    Array.isArray(c.reasoningEvents);
  const parsedSubjects = hasReasoning
    ? (c.reasoningSubjects ?? [])
        .map(parseReasoningSubject)
        .filter((subject): subject is NonNullable<typeof subject> =>
          Boolean(subject),
        )
    : undefined;
  const parsedNodes = hasReasoning
    ? (c.reasoningNodes ?? [])
        .map(parseReasoningNode)
        .filter((n): n is NonNullable<typeof n> => Boolean(n))
    : undefined;
  const parsedEvents = hasReasoning
    ? (c.reasoningEvents ?? [])
        .map(parseReasoningEvent)
        .filter((e): e is NonNullable<typeof e> => Boolean(e))
    : undefined;
  const hydrated = hasReasoning
    ? hydrateReasoningGraph({
        reasoningSubjects: parsedSubjects,
        reasoningNodes: parsedNodes,
        reasoningEvents: parsedEvents,
      })
    : undefined;
  return {
    problemId: c.problemId,
    problemTitle: c.problemTitle,
    problemText: c.problemText,
    messages,
    finalAnswer: typeof c.finalAnswer === "string" ? c.finalAnswer : undefined,
    finalAnswerSupport: parseFinalAnswerSupport(c.finalAnswerSupport),
    reasoningSubjects: hydrated?.subjects ?? parsedSubjects,
    reasoningNodes: hydrated?.nodes,
    reasoningEvents: hydrated?.events ?? parsedEvents,
    reasoningDiagnostics: parseReasoningDiagnostics(c.reasoningDiagnostics),
    stoppedReason: c.stoppedReason as ProblemConversation["stoppedReason"],
    error: typeof c.error === "string" ? c.error : undefined,
    status: c.status === "running" ? "running" : undefined,
    speakingAgentId:
      c.speakingAgentId === "agent_a" || c.speakingAgentId === "agent_b"
        ? c.speakingAgentId
        : undefined,
    conversationUsage: parseModelUsage(c.conversationUsage),
    conversationCostUsd: parseOptionalCost(c.conversationCostUsd),
    conversationEfficiency: parseConversationEfficiency(c.conversationEfficiency),
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

export function parseRun(raw: unknown): ExperimentRun | undefined {
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
    transcriptProtocol: resolveTranscriptProtocol(r.transcriptProtocol),
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

