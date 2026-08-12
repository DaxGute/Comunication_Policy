import type { IncomingMessage, ServerResponse } from "node:http";
import OpenAI from "openai";
import {
  isOpenAIModel,
  isReasoningEffort,
  modelSupportsCustomTemperature,
  modelSupportsReasoningEffort,
  supportedOpenAIModelList,
  type ReasoningEffort,
} from "../src/runtime/models.ts";

export type GenerateApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateApiRequest = {
  model: string;
  temperature: number;
  messages: GenerateApiMessage[];
  reasoningEffort?: ReasoningEffort;
};

export type GenerateApiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  inputTokens: number;
  outputTokens: number;
};

export type GenerateApiSuccess = {
  content: string;
  provider: "openai";
  usage?: GenerateApiUsage;
  durationMs: number;
};

export type GenerateApiError = {
  error: string;
};

function isRole(value: unknown): value is GenerateApiMessage["role"] {
  return value === "system" || value === "user" || value === "assistant";
}

export function parseGenerateRequest(body: unknown): GenerateApiRequest {
  if (!body || typeof body !== "object") {
    throw new GenerateApiHttpError(400, "Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const { model, temperature, messages, reasoningEffort } = raw;

  if (typeof model !== "string" || model.trim() === "") {
    throw new GenerateApiHttpError(400, 'Field "model" must be a non-empty string.');
  }

  if (!isOpenAIModel(model)) {
    throw new GenerateApiHttpError(
      400,
      `Unsupported OpenAI model "${model}". Supported: ${supportedOpenAIModelList()}.`,
    );
  }

  if (typeof temperature !== "number" || !Number.isFinite(temperature)) {
    throw new GenerateApiHttpError(
      400,
      'Field "temperature" must be a finite number.',
    );
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new GenerateApiHttpError(
      400,
      'Field "messages" must be a non-empty array.',
    );
  }

  const normalized: GenerateApiMessage[] = messages.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new GenerateApiHttpError(
        400,
        `messages[${index}] must be an object.`,
      );
    }
    const message = item as Record<string, unknown>;
    if (!isRole(message.role)) {
      throw new GenerateApiHttpError(
        400,
        `messages[${index}].role must be system, user, or assistant.`,
      );
    }
    if (typeof message.content !== "string") {
      throw new GenerateApiHttpError(
        400,
        `messages[${index}].content must be a string.`,
      );
    }
    return { role: message.role, content: message.content };
  });

  const effort =
    reasoningEffort === undefined
      ? undefined
      : isReasoningEffort(reasoningEffort)
        ? reasoningEffort
        : (() => {
            throw new GenerateApiHttpError(
              400,
              'Field "reasoningEffort" must be "low", "medium", or "high".',
            );
          })();

  return { model, temperature, messages: normalized, reasoningEffort: effort };
}

export class GenerateApiHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GenerateApiHttpError";
    this.status = status;
  }
}

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
  const message = error instanceof Error ? error.message : String(error);
  return /connection error|fetch failed|econnrefused|econnreset|enotfound|etimedout|socket hang up|temporarily unavailable|503|502/i.test(
    message,
  );
}

/** Parse OpenAI's "Please try again in 32ms" / "1.2s" hints. */
function parseRetryAfterMs(error: unknown): number | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const msMatch = message.match(/try again in (\d+(?:\.\d+)?)\s*ms/i);
  if (msMatch) return Math.max(0, Math.ceil(Number(msMatch[1])));
  const sMatch = message.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (sMatch) return Math.max(0, Math.ceil(Number(sMatch[1]) * 1000));
  return undefined;
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("Aborted");
}

/**
 * Unbounded parallel problems can stampede a 200k TPM cap; fully serial
 * even-spread pacing made runs crawl. Cap in-flight calls, and only wait
 * once the sliding 60s window is near the limit. Override with
 * OPENAI_MAX_CONCURRENT / OPENAI_TPM_LIMIT.
 */
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_TPM_LIMIT = 200_000;
const TPM_SOFT_FRACTION = 0.92;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function maxConcurrent(): number {
  return envInt("OPENAI_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT, 1, 16);
}

function tpmLimit(): number {
  return envInt("OPENAI_TPM_LIMIT", DEFAULT_TPM_LIMIT, 10_000, 20_000_000);
}

function estimateRequestTokens(request: GenerateApiRequest): number {
  const chars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
  return Math.max(1, Math.ceil(chars / 4)) + 800;
}

function retryDelayMs(error: unknown, attempt: number): number {
  const hinted = parseRetryAfterMs(error) ?? 0;
  // Keep the exponential floor small so a "try again in 561ms" hint wins
  // on the first collisions instead of forcing 1s/2s/4s sleeps.
  const exponential = Math.min(8_000, 150 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 120);
  return Math.max(hinted, exponential) + jitter;
}

class OpenAIScheduler {
  private inFlight = 0;
  private readonly slotWaiters: Array<() => void> = [];
  private readonly window: Array<{ at: number; tokens: number }> = [];
  private cooldownUntil = 0;

  noteRateLimit(waitMs: number): void {
    this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + waitMs);
  }

  recordUsage(tokens: number): void {
    this.window.push({ at: Date.now(), tokens: Math.max(1, tokens) });
  }

  async acquire(
    estimate: number,
    signal?: AbortSignal,
  ): Promise<() => void> {
    while (true) {
      if (signal?.aborted) throw abortError(signal);

      const coolWait = this.cooldownUntil - Date.now();
      if (coolWait > 0) {
        await sleep(coolWait, signal);
        continue;
      }

      this.prune(Date.now());
      const used = this.used();
      const soft = Math.floor(tpmLimit() * TPM_SOFT_FRACTION);
      const nearCap = this.inFlight > 0 && used + estimate > soft;
      if (nearCap) {
        const oldest = this.window[0];
        const wait = oldest
          ? Math.max(75, oldest.at + 60_000 - Date.now())
          : 100;
        await sleep(Math.min(wait, 2_000), signal);
        continue;
      }

      if (this.inFlight >= maxConcurrent()) {
        await this.waitForSlot(signal);
        continue;
      }

      this.inFlight += 1;
      return () => this.release();
    }
  }

  private prune(now: number): void {
    const cutoff = now - 60_000;
    while (this.window.length > 0 && this.window[0]!.at < cutoff) {
      this.window.shift();
    }
  }

  private used(): number {
    return this.window.reduce((sum, stamp) => sum + stamp.tokens, 0);
  }

  private waitForSlot(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const wake = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.slotWaiters.indexOf(wake);
        if (index >= 0) this.slotWaiters.splice(index, 1);
        reject(abortError(signal));
      };
      this.slotWaiters.push(wake);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.slotWaiters.shift();
    next?.();
  }
}

const openaiScheduler = new OpenAIScheduler();

const UPSTREAM_RETRY_MAX_ATTEMPTS = 8;

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

  const release = await openaiScheduler.acquire(
    estimateRequestTokens(request),
    signal,
  );
  try {
    return await generateWithOpenAILocked(request, apiKey, signal);
  } finally {
    release();
  }
}

async function generateWithOpenAILocked(
  request: GenerateApiRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<GenerateApiSuccess> {
  if (signal?.aborted) throw abortError(signal);

  const client = new OpenAI({ apiKey });

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
  let completion: OpenAI.Chat.Completions.ChatCompletion | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPSTREAM_RETRY_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError(signal);
    try {
      completion = await client.chat.completions.create(createParams, {
        signal,
      });
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (isAbortLikeError(error) || signal?.aborted) {
        throw error instanceof Error ? error : abortError(signal);
      }
      if (
        !isTransientUpstreamError(error) ||
        attempt === UPSTREAM_RETRY_MAX_ATTEMPTS
      ) {
        break;
      }
      const delay = retryDelayMs(error, attempt);
      if (isRateLimitError(error)) openaiScheduler.noteRateLimit(delay);
      await sleep(delay, signal);
    }
  }

  if (!completion) {
    if (isAbortLikeError(lastError) || signal?.aborted) {
      throw lastError instanceof Error ? lastError : abortError(signal);
    }
    if (isRateLimitError(lastError)) {
      openaiScheduler.noteRateLimit(
        retryDelayMs(lastError, UPSTREAM_RETRY_MAX_ATTEMPTS),
      );
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

  openaiScheduler.recordUsage(
    usage?.totalTokens ?? estimateRequestTokens(request),
  );
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

function sendJson(
  res: ServerResponse,
  status: number,
  payload: GenerateApiSuccess | GenerateApiError,
): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

/**
 * Connect/Vite middleware handler for POST /api/generate.
 */
export async function handleGenerateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
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
  if (!url) return false;
  const path = url.split("?")[0];
  return path === "/api/generate";
}
