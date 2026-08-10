import type { ExperimentRun } from "../../experiment/types";
import type { MultiAgentEvaluation } from "../types";

/** Save the latest evaluation for a conversation, replacing any prior one. */
export function saveEvaluation(
  run: ExperimentRun,
  evaluation: MultiAgentEvaluation,
): ExperimentRun {
  const existing = run.multiAgentEvaluations ?? [];
  const without = existing.filter((e) => e.problemId !== evaluation.problemId);
  return {
    ...run,
    multiAgentEvaluations: [...without, evaluation],
  };
}

export function evaluationsForConversation(
  run: ExperimentRun,
  problemId: string,
): MultiAgentEvaluation[] {
  return (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function newestEvaluation(
  run: ExperimentRun,
  problemId: string,
): MultiAgentEvaluation | undefined {
  return evaluationsForConversation(run, problemId)[0];
}
