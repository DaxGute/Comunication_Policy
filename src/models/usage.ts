/**
 * Token-usage aggregation for conversation and evaluation calls.
 */

export type ModelUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
};

export function emptyUsage(): ModelUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

export function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  const cached =
    (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached > 0 ? { cachedInputTokens: cached } : {}),
  };
}

export function sumUsage(usages: Iterable<ModelUsage | undefined>): ModelUsage {
  let total = emptyUsage();
  for (const usage of usages) {
    if (usage) total = addUsage(total, usage);
  }
  return total;
}

/** Normalize legacy MessageUsage / API usage into ModelUsage. */
export function normalizeUsage(raw: {
  inputTokens?: number;
  promptTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}): ModelUsage | undefined {
  const inputTokens = raw.inputTokens ?? raw.promptTokens;
  const outputTokens = raw.outputTokens ?? raw.completionTokens;
  if (
    typeof inputTokens !== "number" &&
    typeof outputTokens !== "number" &&
    typeof raw.totalTokens !== "number"
  ) {
    return undefined;
  }
  const inTok =
    typeof inputTokens === "number" && Number.isFinite(inputTokens)
      ? Math.max(0, Math.round(inputTokens))
      : 0;
  const outTok =
    typeof outputTokens === "number" && Number.isFinite(outputTokens)
      ? Math.max(0, Math.round(outputTokens))
      : typeof raw.totalTokens === "number" && Number.isFinite(raw.totalTokens)
        ? Math.max(0, Math.round(raw.totalTokens) - inTok)
        : 0;
  const cached =
    typeof raw.cachedInputTokens === "number" &&
    Number.isFinite(raw.cachedInputTokens)
      ? Math.max(0, Math.round(raw.cachedInputTokens))
      : undefined;
  return {
    inputTokens: inTok,
    outputTokens: outTok,
    ...(cached !== undefined && cached > 0
      ? { cachedInputTokens: cached }
      : {}),
  };
}

export function totalTokens(usage: ModelUsage): number {
  return usage.inputTokens + usage.outputTokens;
}
