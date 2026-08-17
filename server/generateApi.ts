/**
 * Local OpenAI proxy: scheduled generateWithOpenAI + HTTP /api/generate handler.
 *
 * Body validation is in generateRequest.ts. The browser never receives the API key.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from "openai";
import {
  modelSupportsCustomTemperature,
  modelSupportsReasoningEffort,
  type ReasoningEffort,
} from "../src/runtime/models.ts";
import {
  estimateRequestTokens,
  getOpenAIScheduler,
  parseRetryAfterMs,
} from "./openaiScheduler.ts";
import {
  parseGenerateRequest,
  GenerateApiHttpError,
  type GenerateApiRequest,
  type GenerateApiSuccess,
} from "./generateRequest.ts";

export {
  parseGenerateRequest,
  GenerateApiHttpError,
};
export type {
  GenerateApiRequest,
  GenerateApiSuccess,
  GenerateApiError,
  GenerateApiUsage,
  GenerateApiMessage,
} from "./generateRequest.ts";

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof RateLimitError) return true;
  if (!error || typeof error !== "object") return false;
  const status =
    "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
  if (status === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|429|tokens per min|\bTPM\b|Request too large/i.test(
    message,
  );
}

function isTransientUpstreamError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  if (
    error instanceof APIConnectionError ||
    error instanceof APIConnectionTimeoutError
  ) {
    return true;
  }
  if (error instanceof APIError) {
    return (
      error.status === 500 ||
      error.status === 502 ||
      error.status === 503 ||
      error.status === 504
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return /connection error|fetch failed|econnrefused|econnreset|enotfound|etimedout|socket hang up|temporarily unavailable|503|502|504|500/i.test(
    message,
  );
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Aborted");
}

const RATE_LIMIT_RETRY_MAX_ATTEMPTS = 8;
const TRANSIENT_RETRY_MAX_ATTEMPTS = 4;

function retryDelayMs(error: unknown, attempt: number): number {
  const hinted = parseRetryAfterMs(error) ?? 0;
  // Keep the exponential floor small so a "try again in 561ms" hint wins
  // on the first collisions instead of forcing 1s/2s/4s sleeps.
  const exponential = Math.min(8_000, 150 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 180);
  return Math.max(hinted, exponential) + jitter;
}

function maxAttemptsFor(error: unknown): number {
  return isRateLimitError(error)
    ? RATE_LIMIT_RETRY_MAX_ATTEMPTS
    : TRANSIENT_RETRY_MAX_ATTEMPTS;
}

export async function generateWithOpenAI(
  request: GenerateApiRequest,
  apiKey: string | undefined,
  signal?: AbortSignal,
): Promise<GenerateApiSuccess> {
  if (!apiKey || apiKey.trim() === "") {
    throw new GenerateApiHttpError(
      500,
      "OPENAI_API_KEY is not set. Add it to .env.local or the process environment.",
    );
  }

  if (signal?.aborted) throw abortError(signal);

  const scheduler = getOpenAIScheduler();
  const estimate = estimateRequestTokens(request.messages);
  let lastError: unknown;

  for (let attempt = 1; attempt <= RATE_LIMIT_RETRY_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    const lease = await scheduler.acquire({
      model: request.model,
      estimate,
      signal,
      runId: request.runId,
    });
    try {
      const result = await generateWithOpenAIOnce(request, apiKey, signal);
      lease.release({
        completed: true,
        actualTokens: result.usage?.totalTokens ?? estimate,
        promptTokens: result.usage?.promptTokens,
      });
      return result;
    } catch (error) {
      lastError = error;
      lease.release({ completed: false });
      if (isAbortLikeError(error) || signal?.aborted) {
        throw error instanceof Error ? error : abortError(signal);
      }
      if (error instanceof APIError) {
        scheduler.observeHeaders(request.model, error.headers);
      }
      const retryable = isTransientUpstreamError(error);
      if (!retryable || attempt >= maxAttemptsFor(error)) {
        break;
      }
      scheduler.noteRetry(request.runId);
      const delay = retryDelayMs(error, attempt);
      if (isRateLimitError(error)) {
        scheduler.noteRateLimit(request.model, delay);
        scheduler.noteRateLimitForRun(request.runId);
      }
      await sleep(delay, signal);
    }
  }

  if (isAbortLikeError(lastError) || signal?.aborted) {
    throw lastError instanceof Error ? lastError : abortError(signal);
  }
  if (isRateLimitError(lastError)) {
    scheduler.noteRateLimit(
      request.model,
      retryDelayMs(lastError, RATE_LIMIT_RETRY_MAX_ATTEMPTS),
    );
    scheduler.noteRateLimitForRun(request.runId);
  }
  const detail =
    lastError instanceof Error
      ? lastError.message
      : "Unknown OpenAI API error.";
  const connectionHint =
    /connection error|fetch failed|econnrefused|enotfound|etimedout/i.test(
      detail,
    )
      ? " The Vite dev server could not reach api.openai.com — restart `npm run dev` in a normal terminal (not a sandboxed agent shell)."
      : "";
  throw new GenerateApiHttpError(
    isRateLimitError(lastError) ? 429 : 502,
    `OpenAI API request failed: ${detail}.${connectionHint}`,
  );
}

async function generateWithOpenAIOnce(
  request: GenerateApiRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GenerateApiSuccess> {
  if (signal?.aborted) throw abortError(signal);

  const client = new OpenAI({ apiKey });
  const scheduler = getOpenAIScheduler();

  const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
    {
      model: request.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };
  // GPT-5 / reasoning models only accept the default temperature; sending
  // any other value returns HTTP 400 and fails the whole experiment run.
  if (modelSupportsCustomTemperature(request.model)) {
    createParams.temperature = request.temperature;
  }

  if (
    request.reasoningEffort &&
    modelSupportsReasoningEffort(request.model)
  ) {
    // OpenAI reasoning models accept reasoning_effort on chat completions.
    (createParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
      reasoning_effort?: ReasoningEffort;
    }).reasoning_effort = request.reasoningEffort;
  }

  const startedAt = Date.now();
  const { data: completion, response } = await client.chat.completions
    .create(createParams, { signal })
    .withResponse();
  scheduler.observeHeaders(request.model, response.headers);
  const durationMs = Math.max(0, Date.now() - startedAt);

  const content = completion.choices[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new GenerateApiHttpError(
      502,
      "OpenAI API returned an empty model response.",
    );
  }

  const rawUsage = completion.usage;
  const cachedInputTokens =
    rawUsage &&
    typeof rawUsage === "object" &&
    rawUsage.prompt_tokens_details &&
    typeof rawUsage.prompt_tokens_details.cached_tokens === "number"
      ? rawUsage.prompt_tokens_details.cached_tokens
      : undefined;

  const usage =
    rawUsage && typeof rawUsage.total_tokens === "number"
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          completionTokens: rawUsage.completion_tokens ?? 0,
          totalTokens: rawUsage.total_tokens,
          inputTokens: rawUsage.prompt_tokens ?? 0,
          outputTokens: rawUsage.completion_tokens ?? 0,
          ...(typeof cachedInputTokens === "number"
            ? { cachedInputTokens }
            : {}),
        }
      : undefined;

  return { content, provider: "openai", usage, durationMs };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "AbortError" ||
    name === "APIUserAbortError" ||
    message === "Aborted" ||
    /^request was aborted/i.test(message)
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    throw new GenerateApiHttpError(400, "Request body is empty.");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new GenerateApiHttpError(400, "Request body is not valid JSON.");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function pathnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] ?? "";
  }
}

/**
 * Connect/Vite middleware handler for POST /api/generate and
 * GET /api/openai-scheduler.
 */
export async function handleGenerateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  const pathname = pathnameOf(req.url);
  if (pathname === "/api/openai-scheduler") {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed. Use GET." });
      return;
    }
    sendJson(res, 200, getOpenAIScheduler().snapshot());
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed. Use POST." });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const request = parseGenerateRequest(body);
    const result = await generateWithOpenAI(request, apiKey);
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof GenerateApiHttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    const detail =
      error instanceof Error ? error.message : "Unexpected server error.";
    sendJson(res, 500, { error: detail });
  }
}

export function isGenerateApiPath(url: string | undefined): boolean {
  const path = pathnameOf(url);
  return path === "/api/generate" || path === "/api/openai-scheduler";
}
