import type { ProblemConversation } from "../../experiment/types";
import type { Problem, ProblemCategory } from "../../problems/types";
import { extractFinalAnswerFromMessages } from "../graders/answerExtraction";
import { gradeCrosswordPuzzle } from "../graders/crosswordGrader";
import { gradeMoralConversation } from "../graders/moralGrader";
import { gradeHiddenProfileDecision } from "../graders/hiddenProfileGrader";
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
  // Prefer re-extraction from messages so blank-line Across/Down blocks
  // are recovered even when a truncated finalAnswer was stored earlier.
  const finalAnswer =
    extractFinalAnswerFromMessages(conversation.messages) ??
    conversation.finalAnswer;

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
    notes: [
      grade.notes,
      grade.stance ? `stance=${grade.stance}` : undefined,
      `tensionSignals=${grade.exploredTensionCount}`,
    ]
      .filter(Boolean)
      .join(" · "),
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

function evaluateHiddenProfile(
  conversation: ProblemConversation,
  problem: Problem | undefined,
): ProblemEvaluation {
  const finalAnswer =
    conversation.finalAnswer ??
    extractFinalAnswerFromMessages(conversation.messages);

  const spec = problem?.hiddenProfile;
  if (!spec) {
    return {
      ...baseFields(conversation, finalAnswer),
      label: "no_answer",
      notes: "Hidden Profile problem missing spec; cannot grade.",
      details: { grader: "hidden_profile" },
    };
  }

  const grade = gradeHiddenProfileDecision({
    predicted: finalAnswer,
    goldAnswer: spec.goldAnswer,
    options: spec.options,
  });

  return {
    ...baseFields(conversation, finalAnswer),
    score: grade.correct ? 1 : 0,
    label: grade.label,
    notes: grade.notes,
    details: {
      grader: "hidden_profile",
      hasGoldAnswer: true,
      selected: grade.selected,
      goldAnswer: grade.goldAnswer,
      correct: grade.correct,
      evidenceStructure: spec.evaluatorMetadata.evidenceStructure,
      decisiveInformationIds: spec.evaluatorMetadata.decisiveInformationIds,
      question: spec.question,
      options: spec.options,
      source: spec.source,
      sourceId: spec.sourceId,
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

function markIncomplete(evaluation: ProblemEvaluation): ProblemEvaluation {
  return {
    ...evaluation,
    label: "incomplete",
    notes: [evaluation.notes, "Reached max turns without finishing."]
      .filter(Boolean)
      .join(" · "),
    details: {
      ...evaluation.details,
      incomplete: true,
    },
  };
}

export function isIncompleteConversation(
  conversation: Pick<ProblemConversation, "stoppedReason" | "status">,
): boolean {
  return (
    conversation.status !== "running" &&
    conversation.stoppedReason === "max_turns" ||
    conversation.stoppedReason === "reasoning_protocol_stalled"
  );
}

export function evaluateProblem(
  category: ProblemCategory,
  conversation: ProblemConversation,
  problem: Problem | undefined,
): ProblemEvaluation {
  let evaluation: ProblemEvaluation;
  if (category === "moral_philosophical" || problem?.kind === "moral") {
    evaluation = evaluateMoral(conversation, problem);
  } else if (
    problem?.kind === "crossword_puzzle" ||
    problem?.crossword ||
    category === "crossword"
  ) {
    if (!problem) {
      const finalAnswer =
        extractFinalAnswerFromMessages(conversation.messages) ??
        conversation.finalAnswer;
      evaluation = {
        ...baseFields(conversation, finalAnswer),
        label: "no_answer",
        notes: "Crossword problem missing from local pool; cannot grade.",
        details: { grader: "crossword" },
      };
    } else {
      evaluation = evaluateCrossword(conversation, problem);
    }
  } else if (
    category === "hidden_profile" ||
    problem?.kind === "hidden_profile" ||
    problem?.hiddenProfile
  ) {
    evaluation = evaluateHiddenProfile(conversation, problem);
  } else {
    evaluation = scoreWithExpected(conversation, problem);
  }

  if (isIncompleteConversation(conversation)) {
    return markIncomplete(evaluation);
  }
  return evaluation;
}
