import { DEFAULT_COMMUNICATION_POLICY } from "../communication/policy";
import {
  AVAILABLE_MODEL_IDS,
  AVAILABLE_MODELS,
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_RUN_MODEL_ID,
  OPENAI_MODEL_ID,
  providerForModel,
  type ModelProvider,
  type ReasoningEffort,
} from "../runtime/models";
import type { ExperimentRun, ExperimentState, RunConfig } from "./types";

export {
  AVAILABLE_MODEL_IDS,
  AVAILABLE_MODELS,
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_REASONING_EFFORT,
  DEFAULT_RUN_MODEL_ID,
  OPENAI_MODEL_ID,
  providerForModel,
};
export type { ModelProvider, ReasoningEffort };

export const DEFAULT_RUN_CONFIG: RunConfig = {
  problemCategory: "crossword",
  problemCount: 1,
  runModel: DEFAULT_RUN_MODEL_ID,
  runReasoningEffort: DEFAULT_REASONING_EFFORT,
  evaluationModel: DEFAULT_EVALUATION_MODEL_ID,
  evaluationReasoningEffort: DEFAULT_REASONING_EFFORT,
  evaluationEnabled: true,
  provider: "openai",
  maxTurns: 8,
  temperature: 0.4,
};

export function createInitialExperimentState(
  runConfig: RunConfig = DEFAULT_RUN_CONFIG,
  runs: ExperimentRun[] = [],
  selection: { selectedRunId?: string; selectedProblemId?: string } = {},
): ExperimentState {
  const selectedRunId =
    selection.selectedRunId &&
    runs.some((r) => r.id === selection.selectedRunId)
      ? selection.selectedRunId
      : runs[0]?.id;

  const selectedRun = runs.find((r) => r.id === selectedRunId);
  const selectedProblemId =
    selection.selectedProblemId &&
    selectedRun?.conversations.some(
      (c) => c.problemId === selection.selectedProblemId,
    )
      ? selection.selectedProblemId
      : selectedRun?.conversations[0]?.problemId;

  return {
    currentPolicy: { ...DEFAULT_COMMUNICATION_POLICY },
    currentRunConfig: { ...runConfig },
    runs,
    selectedRunId,
    selectedProblemId,
    speakingAgentId: undefined,
    isRunning: false,
    runProgressById: {},
  };
}
