/**
 * Cheap run-identity helpers so poll snapshots can reuse previous object
 * references when the visible/experimental fields have not changed.
 *
 * Does not clone or rewrite persisted data.
 */
import type { ExperimentRun, RunProgress } from "./types";

export function runPollFingerprint(run: ExperimentRun): string {
  const convs = run.conversations
    .map((conversation) => {
      const last = conversation.messages.at(-1);
      return [
        conversation.problemId,
        conversation.problemTitle,
        conversation.status ?? "",
        conversation.speakingAgentId ?? "",
        conversation.messages.length,
        last?.id ?? "",
        conversation.stoppedReason,
        conversation.finalAnswer ?? "",
        conversation.conversationCostUsd ?? "",
      ].join(":");
    })
    .join(";");
  const evals = (run.multiAgentEvaluations ?? [])
    .map((evaluation) =>
      [
        evaluation.id,
        evaluation.status,
        evaluation.finishedAt ?? "",
        evaluation.costUsd ?? "",
        evaluation.stages.map((stage) => `${stage.id}:${stage.status}`).join("/"),
      ].join(":"),
    )
    .join(";");
  return [
    run.id,
    run.status,
    run.title ?? "",
    run.finishedAt ?? "",
    run.progress?.completedProblems ?? "",
    run.progress?.totalProblems ?? "",
    run.progress?.fraction ?? "",
    run.totalCostUsd ?? "",
    convs,
    evals,
  ].join("|");
}

/** Keep previous run objects when a poll snapshot has the same fingerprint. */
export function reuseUnchangedRuns(
  prev: ExperimentRun[],
  next: ExperimentRun[],
): ExperimentRun[] {
  if (prev === next) return prev;
  if (prev.length === 0) return next;
  const prevById = new Map(prev.map((run) => [run.id, run]));
  let allSameOrder = prev.length === next.length;
  const merged = next.map((run, index) => {
    const old = prevById.get(run.id);
    if (old && runPollFingerprint(old) === runPollFingerprint(run)) {
      if (prev[index] !== old) allSameOrder = false;
      return old;
    }
    allSameOrder = false;
    return run;
  });
  if (allSameOrder) {
    for (let i = 0; i < prev.length; i++) {
      if (prev[i] !== merged[i]) return merged;
    }
    return prev;
  }
  return merged;
}

export function sameProgressMap(
  a: Record<string, RunProgress>,
  b: Record<string, RunProgress>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return false;
    if (
      left.fraction !== right.fraction ||
      left.completedProblems !== right.completedProblems ||
      left.totalProblems !== right.totalProblems
    ) {
      return false;
    }
  }
  return true;
}
