import type { TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import { emptyReasoningGraph } from "./types";
import type { ReasoningGraph } from "./types";

export function seedTaskReasoningGraph(
  subjects: ReasoningGraph["subjects"],
): ReasoningGraph {
  return emptyReasoningGraph(subjects);
}

export function seedGraphForProblem(
  problem: Problem,
  adapter: TaskReasoningAdapter,
): ReasoningGraph {
  return seedTaskReasoningGraph(adapter.getInitialIssues(problem));
}
