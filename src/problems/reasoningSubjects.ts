import type { ReasoningSubject } from "../reasoning/types";
import type { Problem } from "./types";

function crosswordSubjectId(direction: "across" | "down", number: number): string {
  return `crossword:${direction}:${number}`;
}

/**
 * Task adapters own stable subjects that are knowable before reasoning starts.
 * Gold answers and other evaluation-only fields must never enter this output.
 */
export function reasoningSubjectsForProblem(
  problem: Problem,
): ReasoningSubject[] {
  if (!problem.crossword) return [];
  return problem.crossword.clues.map((clue) => {
    const directionLabel =
      clue.direction === "across" ? "Across" : "Down";
    return {
      id: crosswordSubjectId(clue.direction, clue.number),
      label: `${directionLabel} ${clue.number}`,
      description: clue.clue,
      source: "task" as const,
      metadata: {
        domain: "crossword",
        direction: clue.direction,
        number: clue.number,
        length: clue.length,
      },
    };
  });
}

