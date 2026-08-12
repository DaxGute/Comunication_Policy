import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { EvaluationArtifact, EvaluationCost, MarbleEvaluation } from "../types";
import { MARBLE_ADAPTER_VERSION, MARBLE_COMMIT } from "../versions";
import {
  normalizeMarbleResult,
  toMarblePosthocRequest,
} from "./adapter";

export type MarbleEvaluateResult = {
  artifact: EvaluationArtifact<MarbleEvaluation>;
  cost: EvaluationCost;
};

/**
 * Invoke the official MARBLE Graph evaluator post-hoc via the local Vite API
 * (browser) or an injected invoker (server RunManager).
 * Failures must be surfaced — never silently approximated.
 */
export async function evaluateMarblePosthoc(options: {
  run: ExperimentRun;
  conversation: ProblemConversation;
  evaluatorModel: string;
  signal?: AbortSignal;
  /**
   * Server-side: call the Python MARBLE bridge directly.
   * Browser: omit to use fetch("/api/marble-evaluate").
   */
  invoke?: (request: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
}): Promise<MarbleEvaluateResult> {
  const request = toMarblePosthocRequest({
    run: options.run,
    conversation: options.conversation,
    evaluatorModel: options.evaluatorModel,
  });

  let body: Record<string, unknown>;
  if (options.invoke) {
    body = await options.invoke(request, options.signal);
  } else {
    const response = await fetch("/api/marble-evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });

    body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body.ok === false) {
      const message =
        typeof body.error === "string"
          ? body.error
          : `MARBLE evaluation failed (HTTP ${response.status}).`;
      throw new Error(message);
    }
  }

  if (body.ok === false) {
    const message =
      typeof body.error === "string"
        ? body.error
        : "MARBLE evaluation failed.";
    throw new Error(message);
  }

  const normalized = normalizeMarbleResult(body, {
    marbleCommit: MARBLE_COMMIT,
    adapterVersion: MARBLE_ADAPTER_VERSION,
  });

  const costRaw =
    body.cost && typeof body.cost === "object"
      ? (body.cost as Record<string, unknown>)
      : {};

  return {
    artifact: {
      normalized,
      raw: body.raw ?? body,
    },
    cost: {
      model:
        typeof costRaw.model === "string"
          ? costRaw.model
          : options.evaluatorModel,
      provider: "marble_litellm",
      evaluator: "marble",
      latencyMs:
        typeof costRaw.latencyMs === "number" ? costRaw.latencyMs : undefined,
      inputTokens:
        typeof costRaw.inputTokens === "number"
          ? costRaw.inputTokens
          : undefined,
      cachedInputTokens:
        typeof costRaw.cachedInputTokens === "number"
          ? costRaw.cachedInputTokens
          : undefined,
      outputTokens:
        typeof costRaw.outputTokens === "number"
          ? costRaw.outputTokens
          : undefined,
      totalTokens:
        typeof costRaw.totalTokens === "number"
          ? costRaw.totalTokens
          : undefined,
      // Priced only when token usage is present (orchestrator / getRunCostSummary).
      estimatedCostUsd: null,
    },
  };
}
