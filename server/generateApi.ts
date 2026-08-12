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

export async function generateWithOpenAI(
  request: GenerateApiRequest,
  apiKey: string | undefined,
): Promise<GenerateApiSuccess> {
  if (!apiKey || apiKey.trim() === "") {
    throw new GenerateApiHttpError(
      500,
      "OPENAI_API_KEY is not set. Add it to .env.local or the process environment.",
    );
  }

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
  let completion: OpenAI.Chat.Completions.ChatCompletion;
  try {
    completion = await client.chat.completions.create(createParams);
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown OpenAI API error.";
    const connectionHint =
      /connection error|fetch failed|econnrefused|enotfound|etimedout/i.test(
        detail,
      )
        ? " The Vite dev server could not reach api.openai.com — restart `npm run dev` in a normal terminal (not a sandboxed agent shell)."
        : "";
    throw new GenerateApiHttpError(
      502,
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

  return { content, provider: "openai", usage, durationMs };
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
