import type { ReasoningSubject } from "../reasoning/types";
import { taskReasoningAdapterFor } from "./adapters/registry";
import type { MoralSubjectSeeding } from "./adapters/openSubjects";
import type { Problem } from "./types";

/**
 * Task adapters own stable subjects that are knowable before reasoning starts.
 * Gold answers and other evaluation-only fields must never enter this output.
 */
export function reasoningSubjectsForProblem(
  problem: Problem,
  options?: { moralSubjectSeeding?: MoralSubjectSeeding },
): ReasoningSubject[] {
  return taskReasoningAdapterFor(problem, options).getInitialIssues(problem);
}

