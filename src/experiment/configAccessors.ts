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
import type { MultiAgentEvaluation } from "../evaluation/types";
import { postHocProfileFor } from "../evaluation/posthoc/registry";
import {
  clampInformationOverlap,
  snapInformationOverlap,
} from "../information/split";
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
    stallRecoveryTurns: parsed.stallRecoveryTurns ?? defaults.stallRecoveryTurns,
    stallFailTurns: parsed.stallFailTurns ?? defaults.stallFailTurns,
    localLoopTurns: parsed.localLoopTurns ?? defaults.localLoopTurns,
    cycleWindowTurns: parsed.cycleWindowTurns ?? defaults.cycleWindowTurns,
    // New moral runs always use agent-created empty graphs. Legacy seeding
    // aliases are accepted on input only so old configs load; they are never
    // preserved as an active runtime mode.
    moralSubjectInitialization: "agent-created",
    moralSubjectSeeding: "agent-created",
    informationOverlap: snapInformationOverlap(
      clampInformationOverlap(
        typeof parsed.informationOverlap === "number"
          ? parsed.informationOverlap
          : (defaults.informationOverlap ?? 1),
      ),
    ),
    informationStructure: parsed.informationStructure,
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

/** Required post-hoc components finished without failure. */
export function isSuccessfulMultiAgentEvaluation(
  evaluation: MultiAgentEvaluation | undefined,
): boolean {
  if (!evaluation || evaluation.status !== "completed") return false;
  const explicit = evaluation.metadata.postHocComponents;
  const components =
    explicit ?? postHocProfileFor(evaluation.metadata.problemSet).components;
  return components.every((component) => {
    if (component === "marble") {
      return evaluation.componentStatus.marble === "completed";
    }
    if (component === "interaction") {
      if (evaluation.componentStatus.interaction === "completed") return true;
      // Legacy records predate the universal evaluator.
      return (
        !explicit &&
        (evaluation.componentStatus.belief === "completed" ||
          evaluation.componentStatus.moralDynamics === "completed")
      );
    }
    if (component === "belief") {
      return evaluation.componentStatus.belief === "completed";
    }
    if (component === "moral_dynamics") {
      if (evaluation.componentStatus.moralDynamics === "completed") return true;
      // Legacy moral MAE used belief extraction; keep those records successful.
      return (
        !explicit &&
        evaluation.componentStatus.belief === "completed" &&
        (evaluation.componentStatus.moralDynamics == null ||
          evaluation.componentStatus.moralDynamics === "skipped")
      );
    }
    return true;
  });
}

export function hasSuccessfulEvaluationForProblem(
  run: ExperimentRun,
  problemId: string,
): boolean {
  return isSuccessfulMultiAgentEvaluation(
    latestEvaluationForProblem(run, problemId),
  );
}

export function evaluationsForProblem(run: ExperimentRun, problemId: string) {
  return (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
