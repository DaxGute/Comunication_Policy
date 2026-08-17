/**
 * Full-puzzle crossword grading.
 *
 * Primary score: letter accuracy (correct fillable cells / total fillable).
 * Secondary: word accuracy, completion, crossing consistency, exact solve.
 * Parsing/reconstruction is in crosswordParse.ts.
 */
import type { CrosswordSpec } from "../../problems/crossword/types";
import type { CrosswordPuzzleGrade } from "./crosswordParse";
import {
  assignmentsFromGrid,
  clueKey,
  countFillableCells,
  emptyWorkingGrid,
  findClueCrossings,
  normalizeCrosswordAnswer,
  parseClueAssignments,
  parseGridAnswer,
  reconstructGridFromAssignments,
} from "./crosswordParse";

export {
  clueKey,
  countFillableCells,
  crosswordLetterLength,
  emptyWorkingGrid,
  findClueCrossings,
  normalizeCrosswordAnswer,
  parseClueAssignments,
  parseGridAnswer,
  reconstructGridFromAssignments,
} from "./crosswordParse";
export type { ClueAssignment, CrosswordCrossing, CrosswordPuzzleGrade } from "./crosswordParse";

export function gradeCrosswordPuzzle(args: {
  predicted?: string;
  spec: CrosswordSpec;
}): CrosswordPuzzleGrade {
  const { spec } = args;
  const fillableCells = countFillableCells(spec.grid);
  const totalClues = spec.clues.length;
  const crossings = findClueCrossings(spec.clues);

  const predictedRaw = args.predicted?.trim();
  if (!predictedRaw) {
    return {
      label: "no_answer",
      letterAccuracy: 0,
      wordAccuracy: 0,
      completion: 0,
      crossingConsistency: null,
      exactSolve: false,
      fillableCells,
      correctLetters: 0,
      filledCells: 0,
      totalClues,
      correctWords: 0,
      crossingsCompared: 0,
      crossingsAgreeing: 0,
      predictedAssignments: [],
      predictedGrid: emptyWorkingGrid(spec.grid),
      notes: "No FINAL_ANSWER extracted from the transcript.",
    };
  }

  let assignments = parseClueAssignments(predictedRaw);
  let predictedGrid: string[];

  if (assignments.length === 0) {
    const parsedGrid = parseGridAnswer(
      predictedRaw,
      spec.width,
      spec.height,
    );
    if (parsedGrid) {
      predictedGrid = parsedGrid;
      assignments = assignmentsFromGrid(parsedGrid, spec.clues);
    } else {
      predictedGrid = emptyWorkingGrid(spec.grid);
    }
  } else {
    predictedGrid = reconstructGridFromAssignments({
      geometry: spec.grid,
      clues: spec.clues,
      assignments,
    });
  }

  let correctLetters = 0;
  let filledCells = 0;
  for (let r = 0; r < spec.height; r++) {
    for (let c = 0; c < spec.width; c++) {
      if (spec.grid[r][c] === "#") continue;
      const pred = predictedGrid[r]?.[c] ?? ".";
      if (pred !== "." && pred !== "#") {
        filledCells += 1;
        if (pred === spec.solution[r][c]) correctLetters += 1;
      }
    }
  }

  const byKey = new Map(
    assignments.map((a) => [clueKey(a.direction, a.number), a]),
  );
  let correctWords = 0;
  for (const clue of spec.clues) {
    const pred = byKey.get(clueKey(clue.direction, clue.number));
    if (pred && pred.answer === clue.answer) correctWords += 1;
  }

  let crossingsCompared = 0;
  let crossingsAgreeing = 0;
  for (const x of crossings) {
    const across = byKey.get(clueKey("across", x.acrossNumber));
    const down = byKey.get(clueKey("down", x.downNumber));
    const aLetter = across?.answer[x.acrossIndex];
    const dLetter = down?.answer[x.downIndex];
    if (!aLetter || !dLetter) continue;
    crossingsCompared += 1;
    if (aLetter === dLetter) crossingsAgreeing += 1;
  }

  const letterAccuracy =
    fillableCells === 0 ? 0 : correctLetters / fillableCells;
  const wordAccuracy = totalClues === 0 ? 0 : correctWords / totalClues;
  const completion = fillableCells === 0 ? 0 : filledCells / fillableCells;
  const crossingConsistency =
    crossingsCompared === 0 ? null : crossingsAgreeing / crossingsCompared;
  const exactSolve = fillableCells > 0 && correctLetters === fillableCells;

  return {
    label: exactSolve ? "exact_solve" : assignments.length || filledCells ? "partial" : "no_answer",
    letterAccuracy,
    wordAccuracy,
    completion,
    crossingConsistency,
    exactSolve,
    fillableCells,
    correctLetters,
    filledCells,
    totalClues,
    correctWords,
    crossingsCompared,
    crossingsAgreeing,
    predictedAssignments: assignments,
    predictedGrid,
    notes:
      assignments.length === 0 && filledCells === 0
        ? "Could not parse clue assignments or grid from FINAL_ANSWER."
        : undefined,
  };
}

/** @deprecated Single-clue grader retained only for isolated answer-normalization checks in tests. */
export type CrosswordClueGrade = {
  correct: boolean;
  predictedRaw?: string;
  goldRaw: string;
  predictedNormalized: string;
  goldNormalized: string;
  lengthMatch: boolean | null;
  label: "correct" | "incorrect" | "no_answer" | "length_mismatch";
  notes?: string;
};

export function gradeCrosswordClueAnswer(args: {
  predicted?: string;
  gold: string;
  expectedLength?: number;
}): CrosswordClueGrade {
  const goldNormalized = normalizeCrosswordAnswer(args.gold);
  const predictedRaw = args.predicted?.trim();

  if (!predictedRaw) {
    return {
      correct: false,
      goldRaw: args.gold,
      predictedNormalized: "",
      goldNormalized,
      lengthMatch: args.expectedLength === undefined ? null : false,
      label: "no_answer",
      notes: "No answer provided.",
    };
  }

  const predictedNormalized = normalizeCrosswordAnswer(predictedRaw);
  const lengthMatch =
    args.expectedLength === undefined
      ? null
      : predictedNormalized.length === args.expectedLength;

  if (predictedNormalized === goldNormalized) {
    return {
      correct: true,
      predictedRaw,
      goldRaw: args.gold,
      predictedNormalized,
      goldNormalized,
      lengthMatch: lengthMatch ?? true,
      label: "correct",
    };
  }

  if (lengthMatch === false) {
    return {
      correct: false,
      predictedRaw,
      goldRaw: args.gold,
      predictedNormalized,
      goldNormalized,
      lengthMatch,
      label: "length_mismatch",
      notes: `Predicted length ${predictedNormalized.length} ≠ expected ${args.expectedLength}.`,
    };
  }

  return {
    correct: false,
    predictedRaw,
    goldRaw: args.gold,
    predictedNormalized,
    goldNormalized,
    lengthMatch,
    label: "incorrect",
  };
}
