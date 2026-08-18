import type { ReasoningSubject } from "../reasoning/types";
import { taskReasoningAdapterFor } from "./adapters/registry";
import type { Problem } from "./types";

/**
 * Task adapters own stable subjects that are knowable before reasoning starts.
 * Gold answers and other evaluation-only fields must never enter this output.
 */
export function reasoningSubjectsForProblem(
  problem: Problem,
): ReasoningSubject[] {
  return taskReasoningAdapterFor(problem).getInitialIssues(problem);
}

