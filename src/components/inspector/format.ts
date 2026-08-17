/**
 * Inspector display helpers (percent, duration, token, mean±sd).
 *
 * UI widgets live in shared.tsx. Domain grading lives in problemMetrics.tsx.
 */
import type { ConversationMessage } from "../../experiment/types";

export function formatPct(value: unknown): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return `${(value * 100).toFixed(1)}%`;
}

export function formatPctSd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export function numericValues(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
}

/** Sample mean and standard deviation (n−1). SD is null when n < 2. */
export function meanSd(values: Array<number | null | undefined>): {
  mean: number | null;
  sd: number | null;
} {
  const nums = numericValues(values);
  if (nums.length === 0) return { mean: null, sd: null };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  if (nums.length < 2) return { mean, sd: null };
  const variance =
    nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nums.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(0)}s`;
}

export function formatTokenCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatMessageCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function messageStatsLabel(message: {
  durationMs?: number;
  usage?: { totalTokens: number };
}): string | undefined {
  const parts: string[] = [];
  if (typeof message.usage?.totalTokens === "number") {
    parts.push(`${formatTokenCount(message.usage.totalTokens)} tok`);
  }
  if (typeof message.durationMs === "number") {
    parts.push(formatDuration(message.durationMs));
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Aggregate wall time and tokens across all turns in a conversation. */
export function conversationTotals(messages: ConversationMessage[]): {
  totalDurationMs: number;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
} {
  let totalDurationMs = 0;
  let totalTokens = 0;
  let hasDuration = false;
  let hasTokens = false;
  for (const message of messages) {
    if (typeof message.durationMs === "number") {
      totalDurationMs += message.durationMs;
      hasDuration = true;
    }
    if (typeof message.usage?.totalTokens === "number") {
      totalTokens += message.usage.totalTokens;
      hasTokens = true;
    }
  }
  return { totalDurationMs, totalTokens, hasDuration, hasTokens };
}
