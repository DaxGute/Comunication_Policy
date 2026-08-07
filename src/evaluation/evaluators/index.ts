import type { ProblemConversation } from "../../experiment/types";
import type { Problem, ProblemCategory } from "../../problems/types";
import { extractFinalAnswerFromMessages } from "../graders/answerExtraction";
import { gradeCrosswordPuzzle } from "../graders/crosswordGrader";
import { gradeMoralConversation } from "../graders/moralGrader";
import { gradeProofAnswer } from "../graders/proofGrader";
import type { ProblemEvaluation } from "../types";

function normalizeLoose(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function pct(n: number): number {
  return Number((n * 100).toFixed(1));
}

function baseFields(
  conversation: ProblemConversation,
  finalAnswer?: string,
): Pick<ProblemEvaluation, "problemId" | "problemTitle" | "turns" | "finalAnswer"> {
  return {
    problemId: conversation.problemId,
    problemTitle: conversation.problemTitle,
    turns: conversation.messages.length,
    finalAnswer,
  };
}

function evaluateCrossword(
  conversation: ProblemConversation,
  problem: Problem,
): ProblemEvaluation {
  const finalAnswer =
    conversation.finalAnswer ??
    extractFinalAnswerFromMessages(conversation.messages);

  if (!problem.crossword) {
    return {
      ...baseFields(conversation, finalAnswer),
      label: "no_answer",
      notes: "Crossword problem missing puzzle spec.",
      details: { grader: "crossword" },
    };
  }

  const grade = gradeCrosswordPuzzle({
    predicted: finalAnswer,
    spec: problem.crossword,
  });

  return {
    ...baseFields(conversation, finalAnswer),
    score: Number(grade.letterAccuracy.toFixed(4)),
    label: grade.label,
    notes: [
      grade.notes,
      `letter=${pct(grade.letterAccuracy)}%`,
      `word=${pct(grade.wordAccuracy)}%`,
      `completion=${pct(grade.completion)}%`,
      grade.crossingConsistency === null
        ? "crossing=n/a"
        : `crossing=${pct(grade.crossingConsistency)}%`,
      `exact=${grade.exactSolve ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join(" · "),
    details: {
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
      difficulty: problem.crossword.difficulty,
      width: problem.crossword.width,
      height: problem.crossword.height,
      source: problem.crossword.source,
      sourceId: problem.crossword.sourceId,
      predictedGrid: grade.predictedGrid.join("\n"),
    },
  };
}

function evaluateMoral(
  conversation: ProblemConversation,
  problem: Problem | undefined,
): ProblemEvaluation {
  const finalAnswer =
    conversation.finalAnswer ??
    extractFinalAnswerFromMessages(conversation.messages);

  const grade = gradeMoralConversation({
    finalAnswer,
    messages: conversation.messages,
  });

  return {
    ...baseFields(conversation, finalAnswer),
    label: grade.label,
    notes: grade.notes,
    details: {
      grader: "moral_open_ended",
      hasGoldAnswer: false,
      stanceReached: grade.label === "stance_reached",
      exploredTensionSignals: grade.exploredTensionCount,
      question: problem?.moral?.question,
      source: problem?.moral?.source,
      sourceIndex: problem?.moral?.sourceIndex,
    },
  };
}

function evaluateProof(
  conversation: ProblemConversation,
  problem: Problem,
): ProblemEvaluation {
  const finalAnswer =
    conversation.finalAnswer ??
    extractFinalAnswerFromMessages(conversation.messages);

  const gold = problem.proof?.answer ?? problem.expectedAnswer ?? "";
  const answerType = problem.proof?.answerType ?? "option";

  const grade = gradeProofAnswer({
    predicted: finalAnswer,
    gold,
    answerType,
  });

  return {
    ...baseFields(conversation, finalAnswer),
    score: grade.correct ? 1 : 0,
    label: grade.label,
    notes: [
      grade.notes,
      `type=${answerType}`,
      `gold=${grade.goldNormalized}`,
      finalAnswer
        ? `predicted=${grade.predictedNormalized || "(empty)"}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
    details: {
      grader: "proof",
      correct: grade.correct,
      predictedNormalized: grade.predictedNormalized,
      goldNormalized: grade.goldNormalized,
      answerType,
      theorem: problem.proof?.theorem,
      field: problem.proof?.field,
      source: problem.proof?.source,
      sourceId: problem.proof?.sourceId,
    },
  };
}

function scoreWithExpected(
  conversation: ProblemConversation,
  problem: Problem | undefined,
): ProblemEvaluation {
  const finalAnswer =
    conversation.finalAnswer ??
    extractFinalAnswerFromMessages(conversation.messages);

  if (!problem?.expectedAnswer) {
    return {
      ...baseFields(conversation, finalAnswer),
      label: finalAnswer ? "answered" : "no_answer",
      notes: "No gold answer; recorded completion only.",
    };
  }

  const ok =
    finalAnswer !== undefined &&
    normalizeLoose(finalAnswer).includes(normalizeLoose(problem.expectedAnswer));

  return {
    ...baseFields(conversation, finalAnswer),
    score: ok ? 1 : 0,
    label: ok ? "correct" : "incorrect_or_missing",
  };
}

export function evaluateProblem(
  category: ProblemCategory,
  conversation: ProblemConversation,
  problem: Problem | undefined,
): ProblemEvaluation {
  if (category === "moral_philosophical" || problem?.kind === "moral") {
    return evaluateMoral(conversation, problem);
  }

  if (
    problem?.kind === "crossword_puzzle" ||
    problem?.crossword ||
    category === "crossword"
  ) {
    if (!problem) {
      return scoreWithExpected(conversation, problem);
    }
    return evaluateCrossword(conversation, problem);
  }

  if (category === "proof" || problem?.kind === "proof" || problem?.proof) {
    if (!problem) {
      return scoreWithExpected(conversation, problem);
    }
    return evaluateProof(conversation, problem);
  }

  return scoreWithExpected(conversation, problem);
}
