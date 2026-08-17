/**
 * Request validation for POST /api/generate.
 *
 * The OpenAI call, retries, and HTTP handler live in generateApi.ts.
 */
import {
  isOpenAIModel,
  isReasoningEffort,
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
  /** Optional run tag for per-run scheduler diagnostics. */
  runId?: string;
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

