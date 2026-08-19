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

export type DisplayRunStatus = ExperimentRun["status"] | "evaluating";

/** True while a multi-agent evaluation record has not produced a terminal UI. */
export function isEvaluationInFlight(
  evaluation: MultiAgentEvaluation,
): boolean {
  if (evaluation.status === "running" || evaluation.status === "pending") {
    return true;
  }
  return (
    evaluation.status === "completed" && !evaluationHasVisibleResult(evaluation)
  );
}

/** True while multi-agent analysis is in flight for this problem. */
export function isProblemAnalysisRunning(
  run: ExperimentRun,
  problemId: string,
  evaluationUi?: EvaluationUiState,
): boolean {
  const forProblem = (run.multiAgentEvaluations ?? []).filter(
    (evaluation) => evaluation.problemId === problemId,
  );
  if (forProblem.some(isEvaluationInFlight)) return true;
  return (
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    evaluationUi.problemId === problemId
  );
}

/** True while any multi-agent analysis is in flight for this run. */
export function isRunAnalysisRunning(
  run: ExperimentRun,
  evaluationUi?: EvaluationUiState,
): boolean {
  if ((run.multiAgentEvaluations ?? []).some(isEvaluationInFlight)) return true;
  return evaluationUi?.status === "running" && evaluationUi.runId === run.id;
}

/** Conversation status, or `evaluating` while post-hoc analysis is in flight. */
export function displayRunStatus(
  run: ExperimentRun,
  evaluationUi?: EvaluationUiState,
): DisplayRunStatus {
  if (run.status === "queued" || run.status === "running") return run.status;
  if (isRunAnalysisRunning(run, evaluationUi)) return "evaluating";
  return run.status;
}

export function runBatchEvaluationComplete(run: ExperimentRun): boolean {
  const evaluations = run.multiAgentEvaluations ?? [];
  if (evaluations.some(isEvaluationInFlight)) return false;
  return run.conversations.every((conversation) =>
    evaluations.some((evaluation) => {
      if (evaluation.problemId !== conversation.problemId) return false;
      if (evaluation.status === "failed") return true;
      return (
        evaluation.status === "completed" &&
        evaluationHasVisibleResult(evaluation)
      );
    }),
  );
}

/** Progressive stage list for the analysis panel, including optimistic UI. */
export function analysisStagesForProblem(
  run: ExperimentRun,
  problemId: string,
  evaluationUi?: EvaluationUiState,
): EvaluationStageState[] {
  if (
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    evaluationUi.problemId === problemId &&
    evaluationUi.stages.length > 0
  ) {
    return evaluationUi.stages;
  }
  const latest = latestEvaluationForFocus(
    run.multiAgentEvaluations ?? [],
    problemId,
  );
  if (latest && isEvaluationInFlight(latest)) return latest.stages;
  if (
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    evaluationUi.problemId === problemId
  ) {
    return evaluationUi.stages;
  }
  return [];
}

/** True when a terminal evaluation already has something the UI can render. */
export function evaluationHasVisibleResult(
  evaluation: MultiAgentEvaluation,
): boolean {
  return Boolean(
    evaluation.marble ||
      evaluation.interaction ||
      evaluation.beliefDynamics ||
      evaluation.moralDynamics ||
      evaluation.errors.length > 0 ||
      evaluation.componentStatus.marble === "failed" ||
      evaluation.componentStatus.interaction === "failed" ||
      evaluation.componentStatus.belief === "failed" ||
      evaluation.componentStatus.moralDynamics === "failed",
  );
}

function uiStatusFromEvaluation(
  evaluation: MultiAgentEvaluation,
): EvaluationUiState["status"] {
  if (evaluation.status === "failed") return "failed";
  if (evaluation.status === "completed") {
    // Never expose "completed" before the payload is on the same record.
    return evaluationHasVisibleResult(evaluation) ? "completed" : "running";
  }
  return "running";
}

function latestEvaluationForFocus(
  evaluations: MultiAgentEvaluation[],
  problemId?: string,
): MultiAgentEvaluation | undefined {
  const scoped = problemId
    ? evaluations.filter((evaluation) => evaluation.problemId === problemId)
    : evaluations;
  const running = scoped
    .filter(isEvaluationInFlight)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (running[0]) return running[0];
  return [...scoped].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export type EvalFocus = {
  runId: string;
  problemId?: string;
  batch?: boolean;
};

/**
 * Keep optimistic in-flight UI when a poll snapshot still shows an older
 * completed evaluation (start has not persisted yet).
 */
export function retainRunningEvaluationUi(
  prev: EvaluationUiState | undefined,
  next: EvaluationUiState | undefined,
  focus: EvalFocus | undefined,
  run: ExperimentRun | undefined,
): EvaluationUiState | undefined {
  if (sameEvaluationUi(prev, next)) return prev;
  if (
    prev?.status === "running" &&
    focus?.runId === prev.runId &&
    next?.status !== "running"
  ) {
    if (focus.batch) {
      if (!run || !runBatchEvaluationComplete(run)) {
        return {
          ...prev,
          ...(next && next.runId === prev.runId ? next : {}),
          status: "running",
          batch: next?.batch ?? prev.batch,
        };
      }
    } else {
      const latest = latestEvaluationForFocus(
        run?.multiAgentEvaluations ?? [],
        prev.problemId,
      );
      const caughtUp = Boolean(
        prev.evaluationId &&
          latest &&
          latest.id === prev.evaluationId &&
          !isEvaluationInFlight(latest),
      );
      if (!caughtUp) return prev;
    }
  }
  if (!next && prev && prev.status !== "running") return prev;
  return next;
}

export function shouldClearEvalFocus(
  focus: EvalFocus | undefined,
  run: ExperimentRun | undefined,
  ui: EvaluationUiState | undefined,
): boolean {
  if (!focus || !run) return false;
  if (focus.batch) return runBatchEvaluationComplete(run);
  const problemId = focus.problemId;
  if (!problemId) return false;
  const latest = latestEvaluationForFocus(
    run.multiAgentEvaluations ?? [],
    problemId,
  );
  if (ui?.status === "running") {
    return Boolean(
      ui.evaluationId &&
        latest &&
        latest.id === ui.evaluationId &&
        !isEvaluationInFlight(latest),
    );
  }
  return Boolean(latest && !isEvaluationInFlight(latest));
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
    Boolean(a.partial?.marble) !== Boolean(b.partial?.marble) ||
    Boolean(a.partial?.interaction) !== Boolean(b.partial?.interaction) ||
    Boolean(a.partial?.beliefDynamics) !== Boolean(b.partial?.beliefDynamics) ||
    Boolean(a.partial?.moralDynamics) !== Boolean(b.partial?.moralDynamics) ||
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
        .filter(isEvaluationInFlight)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = running[0];
      if (!latest) continue;
      const batch =
        running.length > 1
          ? {
              currentIndex: Math.max(
                0,
                run.conversations.findIndex(
                  (c) => c.problemId === latest.problemId,
                ),
              ),
              total: run.conversations.length,
            }
          : undefined;
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
        batch,
      };
    }
    return undefined;
  }

  const run = runs.find((r) => r.id === focus.runId);
  if (!run) return undefined;

  if (focus.batch) {
    const latest = latestEvaluationForFocus(run.multiAgentEvaluations ?? []);
    const batch = {
      currentIndex: Math.max(
        0,
        latest
          ? run.conversations.findIndex((c) => c.problemId === latest.problemId)
          : 0,
      ),
      total: run.conversations.length,
    };
    if (!latest) {
      return {
        runId: focus.runId,
        problemId: run.conversations[0]?.problemId ?? "",
        evaluatorModel: run.config.evaluationModel,
        status: "running",
        stages: [],
        batch,
      };
    }
    const done = runBatchEvaluationComplete(run);
    return {
      runId: focus.runId,
      problemId: latest.problemId,
      evaluationId: latest.id,
      evaluatorModel: latest.evaluatorModel,
      evaluationReasoningEffort: latest.reasoningEffort,
      status: done ? uiStatusFromEvaluation(latest) : "running",
      stages: latest.stages,
      partial: latest,
      error: latest.errors[0]?.message,
      batch,
    };
  }

  const problemId = focus.problemId;
  if (!problemId) return undefined;
  const latest = latestEvaluationForFocus(
    run.multiAgentEvaluations ?? [],
    problemId,
  );
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
    status: uiStatusFromEvaluation(latest),
    stages: latest.stages,
    partial: latest,
    error: latest.errors[0]?.message,
  };
}

