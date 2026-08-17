/**
 * Live crossword grade lookup for the inspector.
 *
 * Prefers stored ProblemEvaluation details; otherwise grades from the transcript.
 * Metric chips that display those details live in problemMetrics.tsx.
 */
import { extractFinalAnswerFromMessages } from "../../evaluation/graders/answerExtraction";
import { gradeCrosswordPuzzle } from "../../evaluation/graders/crosswordGrader";
import type { ProblemEvaluation } from "../../evaluation/types";
import type { ProblemConversation } from "../../experiment/types";
import type { CrosswordSpec } from "../../problems/crossword/types";

function gridHasLetters(grid?: string): boolean {
  return Boolean(grid && /[A-Za-z]/.test(grid));
}

/** Prefer stored crossword grade; otherwise grade live from the transcript. */
export function resolveCrosswordDetails(
  crossword: CrosswordSpec | undefined,
  conversation: ProblemConversation,
  evaluation?: ProblemEvaluation,
): ProblemEvaluation["details"] | undefined {
  if (!crossword) return undefined;
  if (
    evaluation?.details?.grader === "crossword" &&
    typeof evaluation.details.letterAccuracy === "number"
  ) {
    return evaluation.details;
  }
  const predicted =
    extractFinalAnswerFromMessages(conversation.messages) ??
    conversation.finalAnswer;
  const grade = gradeCrosswordPuzzle({
    predicted,
    spec: crossword,
  });
  return {
    grader: "crossword",
    letterAccuracy: grade.letterAccuracy,
    wordAccuracy: grade.wordAccuracy,
    completion: grade.completion,
    crossingConsistency: grade.crossingConsistency,
    exactSolve: grade.exactSolve,
    fillableCells: grade.fillableCells,
    correctLetters: grade.correctLetters,
    filledCells: grade.filledCells,
    totalClues: grade.totalClues,
    correctWords: grade.correctWords,
    crossingsCompared: grade.crossingsCompared,
    crossingsAgreeing: grade.crossingsAgreeing,
    predictedGrid: grade.predictedGrid.join("\n"),
  };
}

export function crosswordPredictedGrid(options: {
  crosswordDetails?: ProblemEvaluation["details"];
  evaluation?: ProblemEvaluation;
}): string | undefined {
  const fromDetails =
    typeof options.crosswordDetails?.predictedGrid === "string"
      ? options.crosswordDetails.predictedGrid
      : undefined;
  if (gridHasLetters(fromDetails)) return fromDetails;
  const fromEval =
    typeof options.evaluation?.details?.predictedGrid === "string"
      ? options.evaluation.details.predictedGrid
      : undefined;
  return gridHasLetters(fromEval) ? fromEval : fromDetails ?? fromEval;
}
