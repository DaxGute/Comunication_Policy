/**
 * Canonical run-level cost accounting.
 *
 * Actual costs are derived from recorded API usage (priced per call / model),
 * never from pre-run estimates. Conversation and evaluation stay separate;
 * total = conversation + evaluation.
 */

import type { EvaluationCost, MultiAgentEvaluation } from "../evaluation/types";
import {
  calculateModelCost,
  estimateExperimentCost,
  type ExperimentCostEstimate,
} from "../models/cost";
import {
  emptyUsage,
  normalizeUsage,
  sumUsage,
  type ModelUsage,
} from "../models/usage";
import { resolveRunModel } from "./configAccessors";
import type { ExperimentRun, ProblemConversation } from "./types";

/** Per-call usage retaining the model ID used for that invocation. */
export type ModelCallUsage = ModelUsage & {
  model: string;
};

/**
 * One priced evaluation inference call (or attempt). Additional evaluators
 * fit the same shape — do not hard-code marble+belief into the total.
 */
export type EvaluationUsageRecord = {
  evaluator: string;
  usage: ModelCallUsage;
  /** Null when tokens were insufficient to price this call. */
  cost: number | null;
};

export type RunCostSummary = {
  estimatedConversationCost: ExperimentCostEstimate;

  actualConversationCost: number;
  actualEvaluationCost: number;
  actualTotalCost: number;

  conversationUsage: ModelUsage;
  evaluationUsage: ModelUsage;

  /** Per-call evaluation records (all invocations, including re-runs). */
  evaluationRecords: EvaluationUsageRecord[];
  /** Sum of priced costs by evaluator id (e.g. marble, belief). */
  evaluationBreakdown: Record<string, number>;

  /** True when at least one multi-agent evaluation execution exists. */
  evaluationsRan: boolean;
  /** True when conversation token usage was recorded. */
  hasConversationUsage: boolean;
  /**
   * True when some inference ran but could not be priced from usage
   * (e.g. MARBLE without token counts). Do not fill gaps with estimates.
   */
  usageIncomplete: boolean;
};

function usageFromCost(cost: EvaluationCost): ModelUsage {
  return (
    normalizeUsage({
      inputTokens: cost.inputTokens,
      cachedInputTokens: cost.cachedInputTokens,
      outputTokens: cost.outputTokens,
      totalTokens: cost.totalTokens,
    }) ?? emptyUsage()
  );
}

function costHasTokenSignal(cost: EvaluationCost): boolean {
  return (
    typeof cost.inputTokens === "number" ||
    typeof cost.outputTokens === "number" ||
    typeof cost.totalTokens === "number"
  );
}

function inferEvaluator(cost: EvaluationCost): string {
  if (typeof cost.evaluator === "string" && cost.evaluator.length > 0) {
    return cost.evaluator;
  }
  if (cost.provider === "marble_litellm") return "marble";
  return "belief";
}

function priceEvaluationCost(cost: EvaluationCost): number | null {
  if (typeof cost.estimatedCostUsd === "number" && Number.isFinite(cost.estimatedCostUsd)) {
    return cost.estimatedCostUsd;
  }
  if (!costHasTokenSignal(cost)) return null;
  const usage = usageFromCost(cost);
  return calculateModelCost(cost.model, usage);
}

/** Build evaluation usage records from every stored evaluation execution. */
export function collectEvaluationUsageRecords(
  evaluations: MultiAgentEvaluation[] | undefined,
): EvaluationUsageRecord[] {
  const records: EvaluationUsageRecord[] = [];
  for (const mae of evaluations ?? []) {
    for (const cost of mae.costs) {
      const usage = usageFromCost(cost);
      const model =
        typeof cost.model === "string" && cost.model.length > 0
          ? cost.model
          : mae.evaluatorModel;
      records.push({
        evaluator: inferEvaluator(cost),
        usage: { ...usage, model },
        cost: priceEvaluationCost({ ...cost, model }),
      });
    }
  }
  return records;
}

function conversationUsageFromMessages(
  conversation: ProblemConversation,
): { usage: ModelUsage; hasUsage: boolean } {
  const raw = conversation.messages
    .map((m) => (m.usage ? normalizeUsage(m.usage) : undefined))
    .filter((u): u is ModelUsage => !!u);
  const hasUsage = conversation.messages.some((m) => m.usage);
  return {
    usage: sumUsage(raw),
    hasUsage,
  };
}

/**
 * Price conversation calls using each message's usage and the run model.
 * Falls back to aggregated conversationUsage when message-level data is absent.
 */
function conversationActualFromRun(run: ExperimentRun): {
  cost: number;
  usage: ModelUsage;
  hasUsage: boolean;
  incomplete: boolean;
} {
  const runModel = resolveRunModel(run.config);
  let usage = emptyUsage();
  let hasUsage = false;
  let costSum = 0;
  let pricedAny = false;
  let incomplete = false;

  for (const conversation of run.conversations) {
    const fromMessages = conversationUsageFromMessages(conversation);
    if (fromMessages.hasUsage) {
      hasUsage = true;
      usage = sumUsage([usage, fromMessages.usage]);
      for (const message of conversation.messages) {
        if (!message.usage) continue;
        const normalized = normalizeUsage(message.usage);
        if (!normalized) continue;
        const priced = calculateModelCost(runModel, normalized);
        if (priced === null) {
          incomplete = true;
        } else {
          costSum += priced;
          pricedAny = true;
        }
      }
      continue;
    }

    if (conversation.conversationUsage) {
      hasUsage = true;
      usage = sumUsage([usage, conversation.conversationUsage]);
      const priced = calculateModelCost(runModel, conversation.conversationUsage);
      if (priced === null) {
        incomplete = true;
      } else {
        costSum += priced;
        pricedAny = true;
      }
      continue;
    }

    if (typeof conversation.conversationCostUsd === "number") {
      hasUsage = true;
      costSum += conversation.conversationCostUsd;
      pricedAny = true;
    }
  }

  if (!hasUsage && run.conversationUsage) {
    hasUsage =
      run.conversationUsage.inputTokens > 0 ||
      run.conversationUsage.outputTokens > 0 ||
      typeof run.conversationCostUsd === "number";
    usage = run.conversationUsage;
    if (typeof run.conversationCostUsd === "number") {
      costSum = run.conversationCostUsd;
      pricedAny = true;
    } else {
      const priced = calculateModelCost(runModel, run.conversationUsage);
      if (priced === null) {
        incomplete = true;
      } else {
        costSum = priced;
        pricedAny = true;
      }
    }
  }

  return {
    cost: pricedAny ? costSum : 0,
    usage,
    hasUsage,
    incomplete,
  };
}

/**
 * Single source of truth for Run Results cost display and persistence sync.
 */
export function getRunCostSummary(run: ExperimentRun): RunCostSummary {
  const problemCount = Math.max(
    run.conversations.length,
    run.config.problemCount,
  );
  const estimatedConversationCost = estimateExperimentCost({
    runModel: resolveRunModel(run.config),
    evaluationModel: run.config.evaluationModel,
    problemCount,
    maxTurns: run.config.maxTurns,
    evaluationEnabled: false,
  });

  const conversation = conversationActualFromRun(run);
  const evaluationRecords = collectEvaluationUsageRecords(
    run.multiAgentEvaluations,
  );
  const evaluationsRan = (run.multiAgentEvaluations ?? []).length > 0;

  const evaluationUsage = sumUsage(evaluationRecords.map((r) => r.usage));
  const evaluationBreakdown: Record<string, number> = {};
  let actualEvaluationCost = 0;
  let evalIncomplete = false;

  for (const record of evaluationRecords) {
    if (typeof record.cost === "number" && Number.isFinite(record.cost)) {
      actualEvaluationCost += record.cost;
      evaluationBreakdown[record.evaluator] =
        (evaluationBreakdown[record.evaluator] ?? 0) + record.cost;
    } else {
      // Inference happened (cost entry exists) but could not be priced.
      evalIncomplete = true;
    }
  }

  // Evaluations that finished with empty costs[] still count as "ran".
  const usageIncomplete = conversation.incomplete || evalIncomplete;

  const actualConversationCost = conversation.hasUsage
    ? conversation.cost
    : 0;
  const actualTotalCost = actualConversationCost + actualEvaluationCost;

  return {
    estimatedConversationCost,
    actualConversationCost,
    actualEvaluationCost,
    actualTotalCost,
    conversationUsage: conversation.hasUsage
      ? conversation.usage
      : emptyUsage(),
    evaluationUsage: evaluationsRan ? evaluationUsage : emptyUsage(),
    evaluationRecords,
    evaluationBreakdown,
    evaluationsRan,
    hasConversationUsage: conversation.hasUsage,
    usageIncomplete,
  };
}

/**
 * Write derived cost fields onto the run for persistence / export.
 * Safe to call repeatedly — values are recomputed from usage, not incremented.
 */
export function syncRunCostFields(run: ExperimentRun): void {
  const summary = getRunCostSummary(run);
  run.conversationUsage = summary.hasConversationUsage
    ? summary.conversationUsage
    : undefined;
  run.conversationCostUsd = summary.hasConversationUsage
    ? summary.actualConversationCost
    : null;
  run.evaluationUsage = summary.evaluationsRan
    ? summary.evaluationUsage
    : emptyUsage();
  run.evaluationCostUsd = summary.evaluationsRan
    ? summary.actualEvaluationCost
    : null;
  run.totalCostUsd =
    summary.hasConversationUsage || summary.evaluationsRan
      ? summary.actualTotalCost
      : null;
}

/** Format actual USD amounts with four decimal places (accounting display). */
export function formatActualUsd(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  return `$${amount.toFixed(4)}`;
}
