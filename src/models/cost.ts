import { getModelDefinition } from "./modelRegistry";
import type { ModelUsage } from "./usage";
import { emptyUsage } from "./usage";

/**
 * Exact cost from recorded API usage and registry pricing.
 * Returns null when the model is unknown (e.g. historical IDs).
 */
export function calculateModelCost(
  modelId: string,
  usage: ModelUsage,
): number | null {
  const model = getModelDefinition(modelId);
  if (!model) return null;

  const cached = Math.min(
    usage.cachedInputTokens ?? 0,
    usage.inputTokens,
  );
  const uncachedInput = Math.max(0, usage.inputTokens - cached);

  const inputCost =
    (uncachedInput / 1_000_000) * model.inputPricePerMillion;
  const cachedInputCost =
    (cached / 1_000_000) *
    (model.cachedInputPricePerMillion ?? model.inputPricePerMillion);
  const outputCost =
    (usage.outputTokens / 1_000_000) * model.outputPricePerMillion;

  return inputCost + cachedInputCost + outputCost;
}

export function formatUsd(amount: number | null | undefined, digits = 2): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  if (amount > 0 && amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(digits)}`;
}

export type ExperimentCostEstimateInput = {
  runModel: string;
  evaluationModel: string;
  problemCount: number;
  maxTurns: number;
  evaluationEnabled: boolean;
  /** Assumed average output tokens per agent turn. */
  avgOutputTokensPerTurn?: number;
  /** Assumed system + problem preamble tokens (fixed each turn). */
  fixedPromptTokensPerTurn?: number;
  /** Assumed average tokens added to the transcript per turn. */
  avgTranscriptTokensPerTurn?: number;
  /** Assumed evaluation input / output tokens per problem. */
  avgEvaluationInputTokens?: number;
  avgEvaluationOutputTokens?: number;
};

export type ExperimentCostEstimate = {
  conversationUsd: number;
  evaluationUsd: number;
  totalUsd: number;
  /** Inclusive low/high band around the point estimate. */
  lowUsd: number;
  highUsd: number;
  assumptions: {
    avgOutputTokensPerTurn: number;
    fixedPromptTokensPerTurn: number;
    avgTranscriptTokensPerTurn: number;
    avgEvaluationInputTokens: number;
    avgEvaluationOutputTokens: number;
    assumedTurnsPerProblem: number;
  };
};

/**
 * Rough pre-run cost estimate. Actual API usage is authoritative after execution.
 *
 * Conversation input is modeled as cumulative: each turn re-sends the growing
 * transcript (fixed preamble + prior turns), matching billed input better than
 * final-transcript size alone.
 */
export function estimateExperimentCost(
  config: ExperimentCostEstimateInput,
): ExperimentCostEstimate {
  const avgOutputTokensPerTurn = config.avgOutputTokensPerTurn ?? 350;
  const fixedPromptTokensPerTurn = config.fixedPromptTokensPerTurn ?? 1_200;
  const avgTranscriptTokensPerTurn = config.avgTranscriptTokensPerTurn ?? 400;
  const avgEvaluationInputTokens = config.avgEvaluationInputTokens ?? 6_000;
  const avgEvaluationOutputTokens = config.avgEvaluationOutputTokens ?? 1_200;

  const problems = Math.max(0, config.problemCount);
  // Assume conversations often stop before maxTurns (~70%).
  const assumedTurns = Math.max(
    1,
    Math.round(config.maxTurns * 0.7),
  );

  let conversationUsage = emptyUsage();
  for (let turn = 1; turn <= assumedTurns; turn++) {
    const priorTranscript = (turn - 1) * avgTranscriptTokensPerTurn;
    const inputTokens = fixedPromptTokensPerTurn + priorTranscript;
    // Roughly 20% of input may be cached on later turns for supporting models.
    const cached =
      turn > 1 && getModelDefinition(config.runModel)?.cachedInputPricePerMillion
        ? Math.round(inputTokens * 0.2)
        : 0;
    const nextCached = (conversationUsage.cachedInputTokens ?? 0) + cached;
    conversationUsage = {
      inputTokens: conversationUsage.inputTokens + inputTokens,
      outputTokens: conversationUsage.outputTokens + avgOutputTokensPerTurn,
      ...(nextCached > 0 ? { cachedInputTokens: nextCached } : {}),
    };
  }

  // Per-problem conversation usage × problem count.
  conversationUsage = {
    inputTokens: conversationUsage.inputTokens * problems,
    outputTokens: conversationUsage.outputTokens * problems,
    ...(conversationUsage.cachedInputTokens
      ? {
          cachedInputTokens: conversationUsage.cachedInputTokens * problems,
        }
      : {}),
  };

  const conversationUsd =
    calculateModelCost(config.runModel, conversationUsage) ?? 0;

  let evaluationUsd = 0;
  if (config.evaluationEnabled && problems > 0) {
    const evalUsage: ModelUsage = {
      inputTokens: avgEvaluationInputTokens * problems,
      outputTokens: avgEvaluationOutputTokens * problems,
    };
    evaluationUsd =
      calculateModelCost(config.evaluationModel, evalUsage) ?? 0;
  }

  const totalUsd = conversationUsd + evaluationUsd;
  return {
    conversationUsd,
    evaluationUsd,
    totalUsd,
    lowUsd: totalUsd * 0.7,
    highUsd: totalUsd * 1.35,
    assumptions: {
      avgOutputTokensPerTurn,
      fixedPromptTokensPerTurn,
      avgTranscriptTokensPerTurn,
      avgEvaluationInputTokens,
      avgEvaluationOutputTokens,
      assumedTurnsPerProblem: assumedTurns,
    },
  };
}

export function formatEstimatedCostRange(estimate: ExperimentCostEstimate): string {
  return formatEstimatedUsd(estimate.totalUsd);
}

/** Format a point USD estimate as a rough ~low–high band. */
export function formatEstimatedUsd(totalUsd: number): string {
  if (totalUsd <= 0) return "~$0.00";
  const low = formatUsd(totalUsd * 0.7);
  const high = formatUsd(totalUsd * 1.35);
  if (low === high) return `~${low}`;
  return `~${low}–${high.replace("$", "")}`;
}
