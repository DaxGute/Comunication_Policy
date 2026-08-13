/**
 * Problem-level communication-efficiency aggregates.
 *
 * Derived from the stored transcript + provider usage. Token averages skip
 * turns that have no usage rather than filling gaps with estimates.
 */

import { normalizeUsage } from "../models/usage";
import type {
  ConversationEfficiencyStats,
  ConversationMessage,
  ProblemConversation,
  UsageSource,
} from "./types";

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function usageSourceFromMessages(
  messages: ConversationMessage[],
): UsageSource | "mixed" | undefined {
  const sources: Array<UsageSource | undefined> = [];
  for (const message of messages) {
    if (!message.usage) continue;
    sources.push(message.usage.source);
  }
  if (sources.length === 0) return undefined;
  if (sources.every((s) => s === undefined)) return undefined;
  const known = sources.filter((s): s is UsageSource => s !== undefined);
  if (known.length !== sources.length) return "mixed";
  const unique = new Set(known);
  if (unique.size === 1) return known[0];
  return "mixed";
}

export function deriveConversationEfficiency(
  conversation: Pick<
    ProblemConversation,
    "messages" | "conversationCostUsd"
  >,
): ConversationEfficiencyStats {
  const messages = conversation.messages;
  const turnCount = messages.length;
  const finalTranscriptCharacters = messages.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );

  const inputValues: number[] = [];
  const outputValues: number[] = [];
  for (const message of messages) {
    if (!message.usage) continue;
    const normalized = normalizeUsage(message.usage);
    if (!normalized) continue;
    inputValues.push(normalized.inputTokens);
    outputValues.push(normalized.outputTokens);
  }

  const hasTokenUsage = inputValues.length > 0;
  const totalInputTokens = hasTokenUsage
    ? inputValues.reduce((sum, n) => sum + n, 0)
    : undefined;
  const totalOutputTokens = hasTokenUsage
    ? outputValues.reduce((sum, n) => sum + n, 0)
    : undefined;

  const stats: ConversationEfficiencyStats = {
    turnCount,
    finalTranscriptCharacters,
    finalTranscriptMessages: turnCount,
    conversationCostUsd:
      conversation.conversationCostUsd !== undefined
        ? conversation.conversationCostUsd
        : undefined,
    usageSource: usageSourceFromMessages(messages),
  };

  if (totalInputTokens !== undefined && totalOutputTokens !== undefined) {
    stats.totalInputTokens = totalInputTokens;
    stats.totalOutputTokens = totalOutputTokens;
    stats.totalConversationTokens = totalInputTokens + totalOutputTokens;
    const avgIn = mean(inputValues);
    const avgOut = mean(outputValues);
    if (avgIn !== undefined) stats.averageInputTokensPerTurn = avgIn;
    if (avgOut !== undefined) stats.averageOutputTokensPerUtterance = avgOut;
  }

  return stats;
}
