/**
 * OpenAI rate-limit header / Retry-After parsing and token estimation.
 *
 * The request queue and RPM/TPM accounting live in openaiScheduler.ts.
 */
export type SchedulerHeaderSnapshot = {
  limitRequests?: number;
  limitTokens?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
  resetTokensMs?: number;
  retryAfterMs?: number;
};

export function parseDurationToMs(
  value: string | number | null | undefined,
): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.ceil(value * (value > 0 && value < 100 ? 1000 : 1)));
  }
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    // HTTP Retry-After is seconds; sub-second values are treated as ms.
    return Math.max(0, Math.ceil(n < 20 ? n * 1000 : n * 1000));
  }
  const msMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*ms$/i);
  if (msMatch) return Math.max(0, Math.ceil(Number(msMatch[1])));
  const combo = trimmed.match(/^(?:(\d+)m)?(\d+(?:\.\d+)?)s$/i);
  if (combo) {
    const minutes = combo[1] ? Number(combo[1]) : 0;
    const seconds = Number(combo[2]);
    return Math.max(0, Math.ceil(minutes * 60_000 + seconds * 1000));
  }
  const sMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (sMatch) return Math.max(0, Math.ceil(Number(sMatch[1]) * 1000));
  return undefined;
}

export function parseRetryAfterMs(error: unknown): number | undefined {
  const headers = headersFromError(error);
  if (headers) {
    const retryAfter =
      headerGet(headers, "retry-after") ??
      headerGet(headers, "Retry-After");
    const fromHeader = parseDurationToMs(retryAfter);
    if (fromHeader != null) return fromHeader;
    const reset =
      parseDurationToMs(headerGet(headers, "x-ratelimit-reset-tokens")) ??
      parseDurationToMs(headerGet(headers, "x-ratelimit-reset-requests"));
    if (reset != null) return reset;
  }
  const message = error instanceof Error ? error.message : String(error);
  const msMatch = message.match(/try again in (\d+(?:\.\d+)?)\s*ms/i);
  if (msMatch) return Math.max(0, Math.ceil(Number(msMatch[1])));
  const sMatch = message.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (sMatch) return Math.max(0, Math.ceil(Number(sMatch[1]) * 1000));
  return undefined;
}

function headerGet(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const rec = headers as Record<string, string | undefined>;
  const direct = rec[name] ?? rec[name.toLowerCase()];
  if (direct != null) return direct;
  const found = Object.entries(rec).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1];
}

function headersFromError(
  error: unknown,
): Headers | Record<string, string | undefined> | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (
    "headers" in error &&
    (error as { headers?: unknown }).headers &&
    typeof (error as { headers: unknown }).headers === "object"
  ) {
    return (error as { headers: Headers }).headers;
  }
  return undefined;
}

export function extractRateLimitHeaders(
  headers: Headers | Record<string, string | undefined> | undefined,
): SchedulerHeaderSnapshot {
  if (!headers) return {};
  const remainingRequests = Number(
    headerGet(headers, "x-ratelimit-remaining-requests"),
  );
  const remainingTokens = Number(
    headerGet(headers, "x-ratelimit-remaining-tokens"),
  );
  const limitRequests = Number(
    headerGet(headers, "x-ratelimit-limit-requests"),
  );
  const limitTokens = Number(headerGet(headers, "x-ratelimit-limit-tokens"));
  return {
    limitRequests: Number.isFinite(limitRequests) ? limitRequests : undefined,
    limitTokens: Number.isFinite(limitTokens) ? limitTokens : undefined,
    remainingRequests: Number.isFinite(remainingRequests)
      ? remainingRequests
      : undefined,
    remainingTokens: Number.isFinite(remainingTokens)
      ? remainingTokens
      : undefined,
    resetRequestsMs: parseDurationToMs(
      headerGet(headers, "x-ratelimit-reset-requests"),
    ),
    resetTokensMs: parseDurationToMs(
      headerGet(headers, "x-ratelimit-reset-tokens"),
    ),
    retryAfterMs: parseDurationToMs(headerGet(headers, "retry-after")),
  };
}

export function estimateRequestTokens(messages: Array<{ content: string }>): number {
  const chars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4)) + 1_200;
}

/**
 * Shared OpenAI request scheduler. All live OpenAI traffic should acquire a
 * lease here so multiple runs share one RPM/TPM budget per model.
 */
