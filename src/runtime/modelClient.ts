import type { AgentId } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import type { ReasoningEffort } from "../models/modelRegistry";
import type { Problem } from "../problems/types";
import { abortableDelay, isAbortError, throwIfAborted } from "./abort";
import {
  isMockModel,
  isOpenAIModel,
  providerForModel,
} from "./models";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  agentId?: AgentId;
};

export type ModelRequest = {
  model: string;
  temperature: number;
  messages: ModelMessage[];
  reasoningEffort?: ReasoningEffort;
  signal?: AbortSignal;
  /** Context available to adapters for deterministic mocks. */
  meta?: {
    agentId: AgentId;
    turnIndex: number;
    problem: Problem;
    policy: CommunicationPolicy;
  };
};

/** Per-call usage. Prefer input/output; legacy prompt/completion aliases kept. */
export type ModelUsage = {
  inputTokens?: number;
  promptTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  completionTokens?: number;
  totalTokens: number;
};

export type ModelResponse = {
  content: string;
  provider?: "mock" | "openai";
  usage?: ModelUsage;
  durationMs?: number;
};

function estimateTokenCount(text: string): number {
  // Rough heuristic for mock runs (~4 chars/token).
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface ModelClient {
  generate(input: ModelRequest): Promise<ModelResponse>;
}

export type ModelClientOptions = {
  /** Absolute or relative URL for the local OpenAI proxy. */
  generateUrl?: string;
  /**
   * Server-side direct OpenAI call (skips HTTP hop through /api/generate).
   * When set, OpenAI models use this instead of fetch.
   */
  directOpenAIGenerate?: (
    input: ModelRequest,
  ) => Promise<ModelResponse>;
};

const NETWORK_RETRY_MAX_ATTEMPTS = 5;

/** Fetch failures that often clear after a Vite restart / brief outage. */
function isTransientNetworkError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    name === "TypeError" ||
    name === "NetworkError" ||
    /networkerror|failed to fetch|load failed|network request failed|econnrefused|econnreset|socket hang up/i.test(
      message,
    )
  );
}

/**
 * Deterministic mock used for UI plumbing and policy-band inspectability.
 */
export class MockModelClient implements ModelClient {
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    const meta = input.meta;
    if (!meta) {
      const content = "Mock response (missing meta).";
      return {
        content,
        provider: "mock",
        durationMs: Math.max(0, Date.now() - startedAt),
        usage: { totalTokens: estimateTokenCount(content) },
      };
    }

    const { agentId, turnIndex, problem, policy } = meta;
    const label = agentId === "agent_a" ? "Agent A" : "Agent B";
    const other = agentId === "agent_a" ? "Agent B" : "Agent A";

    const ownTrust = agentId === "agent_a" ? policy.trustA : policy.trustB;
    const trustNote =
      ownTrust < 1 / 3
        ? `I want independent verification before adopting ${other}'s claims.`
        : ownTrust > 2 / 3
          ? `I'll build on ${other}'s reasoning with high default credence.`
          : `I'll weigh ${other}'s points carefully and verify critical steps.`;

    const authorityNote =
      policy.authority < 0.4
        ? agentId === "agent_a"
          ? "My judgment currently carries greater decision weight."
          : "I'll defer on resolution when appropriate while still surfacing concerns."
        : policy.authority > 0.6
          ? agentId === "agent_b"
            ? "My judgment currently carries greater decision weight."
            : "I'll defer on resolution when appropriate while still surfacing concerns."
          : "We are peers; let's negotiate on the merits.";

    const familiarityNote =
      policy.familiarity < 1 / 3
        ? "I'll keep explanations explicit and self-contained."
        : policy.familiarity > 2 / 3
          ? "Compressing shared context; focusing on deltas."
          : "Clear but not overly verbose.";

    // Final turns produce a mock answer so evaluation plumbing can run.
    // For crossword, intentionally miss ~1/5 so the grader's incorrect path is visible.
    const isClosing = turnIndex >= 3;
    let answerLine = "";
    if (isClosing) {
      if (problem.kind === "crossword_puzzle" && problem.crossword) {
        const shouldMiss = problem.crossword.sourceId % 5 === 0;
        const across = problem.crossword.clues.filter(
          (c) => c.direction === "across",
        );
        const down = problem.crossword.clues.filter(
          (c) => c.direction === "down",
        );
        const lineFor = (c: (typeof across)[number]) =>
          `${c.number}: ${shouldMiss ? "X".repeat(c.length) : c.answer}`;
        answerLine = [
          "",
          "FINAL_ANSWER:",
          "ACROSS",
          ...across.map(lineFor),
          "DOWN",
          ...down.map(lineFor),
        ].join("\n");
      } else if (problem.kind === "proof" && problem.proof) {
        const shouldMiss = problem.proof.sourceIndex % 5 === 0;
        const reference = problem.proof.referenceProof;
        const mockProof = shouldMiss
          ? "Suppose the claim holds. We omit a key step and conclude without justification. QED"
          : reference.length > 400
            ? `${reference.slice(0, 397).trimEnd()}…`
            : reference;
        answerLine = `\nFINAL_ANSWER:\n${mockProof}`;
      } else if (problem.kind === "moral" || problem.moral) {
        const q = problem.moral?.question ?? "the dilemma";
        const issues = problem.moral?.issues?.slice(0, 2).join("; ");
        answerLine = `\nFINAL_ANSWER: After weighing ${issues || "the core tensions"}, our provisional joint stance on "${q.slice(0, 72)}" is to prioritize clear communication of competing claims and refuse to treat either side as settled.`;
      } else if (problem.expectedAnswer) {
        answerLine = `\nFINAL_ANSWER: ${problem.expectedAnswer}`;
      } else {
        answerLine = "\nFINAL_ANSWER: unresolved";
      }
    }

    const content = [
      `[${label} · turn ${turnIndex}]`,
      `Problem focus: ${problem.title}`,
      trustNote,
      authorityNote,
      familiarityNote,
      !isClosing && problem.kind === "crossword_puzzle"
        ? `If 1-Across crosses 1-Down, those shared letters must agree — inviting ${other} to test candidates against crossings.`
        : !isClosing && problem.kind === "proof"
          ? `I'll propose a proof strategy and ask ${other} to stress-test the critical steps before we lock a write-up.`
          : null,
      !isClosing && (problem.kind === "moral" || problem.moral)
        ? `On the other hand, a counterargument from ${other} could surface a principle trade-off we have not settled — uncertainty remains.`
        : null,
      isClosing
        ? `Proposing a resolution based on our discussion.${answerLine}`
        : `Considering constraints and inviting ${other} to respond.`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    // Simulate a small amount of latency for UI speaking-state feedback.
    await abortableDelay(120 + turnIndex * 40, input.signal);
    throwIfAborted(input.signal);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const completionTokens = estimateTokenCount(content);
    const promptTokens = estimateTokenCount(
      input.messages.map((m) => m.content).join("\n"),
    );
    return {
      content,
      provider: "mock",
      durationMs,
      usage: {
        inputTokens: promptTokens,
        promptTokens,
        outputTokens: completionTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }
}

type ProxyGenerateSuccess = {
  content: string;
  provider?: "openai";
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens: number;
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  };
  durationMs?: number;
};

type ProxyGenerateError = {
  error: string;
};

/**
 * Routes mock vs OpenAI. Real models never fall back to mock output.
 */
export class ConfigurableModelClient implements ModelClient {
  private readonly mock: MockModelClient;
  private readonly generateUrl: string;
  private readonly directOpenAIGenerate?: (
    input: ModelRequest,
  ) => Promise<ModelResponse>;

  constructor(
    mock: MockModelClient = new MockModelClient(),
    options: ModelClientOptions = {},
  ) {
    this.mock = mock;
    this.generateUrl = options.generateUrl ?? "/api/generate";
    this.directOpenAIGenerate = options.directOpenAIGenerate;
  }

  async generate(input: ModelRequest): Promise<ModelResponse> {
    if (isMockModel(input.model)) {
      return this.mock.generate(input);
    }

    if (isOpenAIModel(input.model)) {
      if (this.directOpenAIGenerate) {
        throwIfAborted(input.signal);
        const response = await this.directOpenAIGenerate(input);
        throwIfAborted(input.signal);
        return response;
      }
      return this.generateOpenAI(input);
    }

    throw new Error(`Unsupported model: ${input.model}`);
  }

  private async generateOpenAI(input: ModelRequest): Promise<ModelResponse> {
    // providerForModel validates the ID; kept for explicit metadata.
    const provider = providerForModel(input.model);
    if (provider !== "openai") {
      throw new Error(`Expected OpenAI model, got provider "${provider}".`);
    }

    throwIfAborted(input.signal);

    const startedAt = Date.now();
    const body = JSON.stringify({
      model: input.model,
      temperature: input.temperature,
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    let lastError: unknown;
    for (let attempt = 1; attempt <= NETWORK_RETRY_MAX_ATTEMPTS; attempt++) {
      throwIfAborted(input.signal);
      try {
        const response = await fetch(this.generateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: input.signal,
        });

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          const nonJson = new Error(
            `OpenAI proxy returned non-JSON (HTTP ${response.status}).`,
          );
          if (
            (response.status === 502 ||
              response.status === 503 ||
              response.status === 504 ||
              response.status === 0) &&
            attempt < NETWORK_RETRY_MAX_ATTEMPTS
          ) {
            lastError = nonJson;
            const backoff = Math.min(8_000, 300 * 2 ** (attempt - 1));
            await abortableDelay(
              backoff + Math.floor(Math.random() * 120),
              input.signal,
            );
            continue;
          }
          throw nonJson;
        }

        if (!response.ok) {
          const message =
            payload &&
            typeof payload === "object" &&
            typeof (payload as ProxyGenerateError).error === "string"
              ? (payload as ProxyGenerateError).error
              : `OpenAI proxy error (HTTP ${response.status}).`;
          // 429 / transient 5xx from the proxy are worth retrying (Vite restart,
          // brief TPM spikes handled upstream, etc.).
          if (
            (response.status === 429 ||
              response.status === 502 ||
              response.status === 503 ||
              response.status === 504) &&
            attempt < NETWORK_RETRY_MAX_ATTEMPTS
          ) {
            lastError = new Error(message);
            const backoff = Math.min(8_000, 300 * 2 ** (attempt - 1));
            await abortableDelay(
              backoff + Math.floor(Math.random() * 120),
              input.signal,
            );
            continue;
          }
          throw new Error(message);
        }

        if (
          !payload ||
          typeof payload !== "object" ||
          typeof (payload as ProxyGenerateSuccess).content !== "string"
        ) {
          throw new Error("OpenAI proxy returned a malformed success payload.");
        }

        const success = payload as ProxyGenerateSuccess;
        const content = success.content;
        if (content.trim() === "") {
          throw new Error("OpenAI proxy returned an empty content string.");
        }

        const rawUsage = success.usage;
        const inputTokens =
          typeof rawUsage?.inputTokens === "number"
            ? rawUsage.inputTokens
            : typeof rawUsage?.promptTokens === "number"
              ? rawUsage.promptTokens
              : undefined;
        const outputTokens =
          typeof rawUsage?.outputTokens === "number"
            ? rawUsage.outputTokens
            : typeof rawUsage?.completionTokens === "number"
              ? rawUsage.completionTokens
              : undefined;
        const usage =
          rawUsage &&
          typeof rawUsage.totalTokens === "number" &&
          Number.isFinite(rawUsage.totalTokens)
            ? {
                inputTokens,
                promptTokens: inputTokens,
                cachedInputTokens:
                  typeof rawUsage.cachedInputTokens === "number"
                    ? rawUsage.cachedInputTokens
                    : undefined,
                outputTokens,
                completionTokens: outputTokens,
                totalTokens: rawUsage.totalTokens,
              }
            : undefined;

        const durationMs =
          typeof success.durationMs === "number" &&
          Number.isFinite(success.durationMs)
            ? Math.max(0, success.durationMs)
            : Math.max(0, Date.now() - startedAt);

        return { content, provider: "openai", usage, durationMs };
      } catch (error) {
        throwIfAborted(input.signal);
        lastError = error;
        if (
          !isTransientNetworkError(error) ||
          attempt === NETWORK_RETRY_MAX_ATTEMPTS
        ) {
          break;
        }
        const backoff = Math.min(8_000, 300 * 2 ** (attempt - 1));
        await abortableDelay(
          backoff + Math.floor(Math.random() * 120),
          input.signal,
        );
      }
    }

    const detail =
      lastError instanceof Error ? lastError.message : "Network request failed.";
    // Avoid double-prefixing when the last attempt already formatted the error.
    if (detail.startsWith("OpenAI proxy")) {
      throw new Error(detail);
    }
    throw new Error(
      `OpenAI proxy request failed (${this.generateUrl}): ${detail}`,
    );
  }
}

export function createModelClient(
  options: ModelClientOptions = {},
): ModelClient {
  return new ConfigurableModelClient(new MockModelClient(), options);
}
