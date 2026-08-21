import type { Problem } from "../types";
import { crosswordReasoningAdapter } from "./crosswordAdapter";
import {
  DEFAULT_MORAL_SUBJECT_SEEDING,
  moralSubjectsForProblem,
  proofSubjectsForProblem,
  reservedMoralSubjectError,
  type MoralSubjectSeeding,
} from "./openSubjects";
import type { TaskReasoningAdapter } from "./types";

export type TaskAdapterOptions = {
  moralSubjectSeeding?: MoralSubjectSeeding;
};

function moralReasoningAdapter(
  seeding: MoralSubjectSeeding,
): TaskReasoningAdapter {
  return {
    category: "moral_philosophical",
    getInitialIssues(problem) {
      return moralSubjectsForProblem(problem, seeding);
    },
    resolveSubject(_problem, raw) {
      const reserved = reservedMoralSubjectError(raw);
      if (reserved) return { error: reserved };
      return {};
    },
  };
}

const proofReasoningAdapter: TaskReasoningAdapter = {
  category: "proof",
  getInitialIssues(problem) {
    return proofSubjectsForProblem(problem);
  },
};

export function taskReasoningAdapterFor(
  problem: Problem,
  options?: TaskAdapterOptions,
): TaskReasoningAdapter {
  if (problem.category === "crossword" && problem.crossword) {
    return crosswordReasoningAdapter;
  }
  if (problem.category === "moral_philosophical") {
    return moralReasoningAdapter(
      options?.moralSubjectSeeding ?? DEFAULT_MORAL_SUBJECT_SEEDING,
    );
  }
  return proofReasoningAdapter;
}
