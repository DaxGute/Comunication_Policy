/**
 * Helpers for reading run/evaluation model fields with backwards compatibility
 * for historical snapshots that only stored `config.model`.
 */

import {
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_RUN_MODEL_ID,
  isReasoningEffort,
  providerForModel,
  type ReasoningEffort,
} from "../models/modelRegistry";
import type { ExperimentRun, RunConfig } from "./types";

/** Legacy persisted shape may include `model` instead of `runModel`. */
type LegacyRunConfigFields = {
  model?: string;
};

export function resolveRunModel(
  config: RunConfig & LegacyRunConfigFields,
): string {
  if (typeof config.runModel === "string" && config.runModel.trim()) {
    return config.runModel;
  }
  if (typeof config.model === "string" && config.model.trim()) {
    return config.model;
  }
  return DEFAULT_RUN_MODEL_ID;
}

export function resolveEvaluationModel(
  config: Partial<RunConfig> & LegacyRunConfigFields,
): string {
  if (typeof config.evaluationModel === "string" && config.evaluationModel.trim()) {
    return config.evaluationModel;
  }
  return DEFAULT_EVALUATION_MODEL_ID;
}

export function resolveReasoningEffort(
  value: unknown,
  fallback: ReasoningEffort = DEFAULT_REASONING_EFFORT,
): ReasoningEffort {
  return isReasoningEffort(value) ? value : fallback;
}

/**
 * Normalize a partial/legacy config into a full RunConfig.
 * Unknown historical model IDs are preserved on runModel.
 */
export function normalizeRunConfig(
  parsed: Partial<RunConfig> & LegacyRunConfigFields,
  defaults: RunConfig,
): RunConfig {
  const runModel = resolveRunModel({
    ...defaults,
    ...parsed,
  } as RunConfig & LegacyRunConfigFields);

  let provider: RunConfig["provider"] = defaults.provider;
  try {
    provider = providerForModel(runModel);
  } catch {
    if (parsed.provider === "mock" || parsed.provider === "openai") {
      provider = parsed.provider;
    }
  }

  return {
    problemCategory: parsed.problemCategory ?? defaults.problemCategory,
    problemCount: parsed.problemCount ?? defaults.problemCount,
    runModel,
    runReasoningEffort: resolveReasoningEffort(
      parsed.runReasoningEffort,
      defaults.runReasoningEffort,
    ),
    evaluationModel: resolveEvaluationModel({ ...defaults, ...parsed }),
    evaluationReasoningEffort: resolveReasoningEffort(
      parsed.evaluationReasoningEffort,
      defaults.evaluationReasoningEffort,
    ),
    evaluationEnabled:
      typeof parsed.evaluationEnabled === "boolean"
        ? parsed.evaluationEnabled
        : defaults.evaluationEnabled,
    provider,
    maxTurns: parsed.maxTurns ?? defaults.maxTurns,
    temperature: parsed.temperature ?? defaults.temperature,
  };
}

export function latestEvaluationForProblem(
  run: ExperimentRun,
  problemId: string,
) {
  const list = (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list[0];
}

export function evaluationsForProblem(run: ExperimentRun, problemId: string) {
  return (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
