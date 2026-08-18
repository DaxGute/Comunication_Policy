import type { TaskEvidenceSeed, TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import { applyReasoningIntents } from "./graph";
import { emptyReasoningGraph } from "./types";
import type { ReasoningGraph, ReasoningIntent, ReasoningSubject } from "./types";

export function seedTaskReasoningGraph(
  subjects: ReasoningSubject[],
  evidence: TaskEvidenceSeed[] = [],
): ReasoningGraph {
  const graph = emptyReasoningGraph(subjects);
  if (evidence.length === 0) return graph;
  const intents: ReasoningIntent[] = evidence.map((item) => ({
    action: "create",
    nodeType: "evidence",
    text: item.text,
    subjectId: item.subjectId,
    metadata: {
      evidenceOrigin: item.origin,
      aliases: [item.alias, ...(item.aliases ?? [])],
      evidenceKind: item.kind,
      seeded: true,
    },
  }));
  return applyReasoningIntents(graph, intents, {
    actor: "system",
    turnIndex: 0,
    messageId: "task-seed",
  }).graph;
}

export function seedGraphForProblem(
  problem: Problem,
  adapter: TaskReasoningAdapter,
): ReasoningGraph {
  return seedTaskReasoningGraph(
    adapter.getInitialIssues(problem),
    adapter.getInitialEvidence?.(problem) ?? [],
  );
}
