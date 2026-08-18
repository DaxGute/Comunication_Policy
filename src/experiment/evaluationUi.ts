/**
 * Derives inspector evaluation-progress UI from persisted run snapshots.
 *
 * The experiment store owns polling and user actions; this module only maps
 * MultiAgentEvaluation records onto EvaluationUiState.
 */
import type {
  EvaluationStageState,
  MultiAgentEvaluation,
} from "../evaluation/types";
import type { ReasoningEffort } from "../models/modelRegistry";
import type { ExperimentRun } from "./types";

export type EvaluationUiState = {
  runId: string;
  problemId: string;
  evaluationId?: string;
  evaluatorModel: string;
  evaluationReasoningEffort?: ReasoningEffort;
  status: "idle" | "running" | "completed" | "failed";
  stages: EvaluationStageState[];
  /** In-flight / latest partial evaluation for progressive UI. */
  partial?: MultiAgentEvaluation;
  error?: string;
  /** Present while a run-wide batch evaluation is in progress. */
  batch?: {
    currentIndex: number;
    total: number;
  };
};

/** True while multi-agent analysis is in flight for this problem. */
export function isProblemAnalysisRunning(
  run: ExperimentRun,
  problemId: string,
  evaluationUi?: EvaluationUiState,
): boolean {
  if (
    (run.multiAgentEvaluations ?? []).some(
      (e) => e.problemId === problemId && e.status === "running",
    )
  ) {
    return true;
  }
  return (
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    evaluationUi.problemId === problemId
  );
}

export function sameEvaluationUi(
  a: EvaluationUiState | undefined,
  b: EvaluationUiState | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.runId !== b.runId ||
    a.problemId !== b.problemId ||
    a.evaluationId !== b.evaluationId ||
    a.status !== b.status ||
    a.error !== b.error ||
    a.evaluatorModel !== b.evaluatorModel ||
    a.evaluationReasoningEffort !== b.evaluationReasoningEffort ||
    a.batch?.currentIndex !== b.batch?.currentIndex ||
    a.batch?.total !== b.batch?.total ||
    a.partial?.id !== b.partial?.id ||
    a.partial?.status !== b.partial?.status ||
    a.stages.length !== b.stages.length
  ) {
    return false;
  }
  return a.stages.every(
    (stage, index) =>
      stage.id === b.stages[index]?.id &&
      stage.status === b.stages[index]?.status &&
      stage.detail === b.stages[index]?.detail,
  );
}

export function evaluationUiFromRuns(
  runs: ExperimentRun[],
  focus?: { runId: string; problemId?: string; batch?: boolean },
): EvaluationUiState | undefined {
  if (!focus) {
    // Prefer any in-flight evaluation.
    for (const run of runs) {
      const running = [...(run.multiAgentEvaluations ?? [])]
        .filter((e) => e.status === "running")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = running[0];
      if (!latest) continue;
      return {
        runId: run.id,
        problemId: latest.problemId,
        evaluationId: latest.id,
        evaluatorModel: latest.evaluatorModel,
        evaluationReasoningEffort: latest.reasoningEffort,
        status: "running",
        stages: latest.stages,
        partial: latest,
        error: latest.errors[0]?.message,
      };
    }
    return undefined;
  }

  const run = runs.find((r) => r.id === focus.runId);
  if (!run) return undefined;

  if (focus.batch) {
    const running = (run.multiAgentEvaluations ?? []).filter(
      (e) => e.status === "running",
    );
    const latest =
      running[0] ??
      [...(run.multiAgentEvaluations ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
    if (!latest) {
      return {
        runId: focus.runId,
        problemId: run.conversations[0]?.problemId ?? "",
        evaluatorModel: run.config.evaluationModel,
        status: "running",
        stages: [],
        batch: {
          currentIndex: 0,
          total: run.conversations.length,
        },
      };
    }
    const index = Math.max(
      0,
      run.conversations.findIndex((c) => c.problemId === latest.problemId),
    );
    return {
      runId: focus.runId,
      problemId: latest.problemId,
      evaluationId: latest.id,
      evaluatorModel: latest.evaluatorModel,
      evaluationReasoningEffort: latest.reasoningEffort,
      status: latest.status === "running" ? "running" : latest.status === "completed" ? "completed" : "failed",
      stages: latest.stages,
      partial: latest,
      error: latest.errors[0]?.message,
      batch: {
        currentIndex: index,
        total: run.conversations.length,
      },
    };
  }

  const problemId = focus.problemId;
  if (!problemId) return undefined;
  const forProblem = (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = forProblem[0];
  if (!latest) {
    return {
      runId: focus.runId,
      problemId,
      evaluatorModel: run.config.evaluationModel,
      status: "running",
      stages: [],
    };
  }
  return {
    runId: focus.runId,
    problemId,
    evaluationId: latest.id,
    evaluatorModel: latest.evaluatorModel,
    evaluationReasoningEffort: latest.reasoningEffort,
    status:
      latest.status === "running"
        ? "running"
        : latest.status === "completed"
          ? "completed"
          : "failed",
    stages: latest.stages,
    partial: latest,
    error: latest.errors[0]?.message,
  };
}

