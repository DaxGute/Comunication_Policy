/**
 * Full-puzzle crossword grading.
 *
 * Primary score: letter accuracy (correct fillable cells / total fillable).
 * Secondary: word accuracy, completion, crossing consistency, exact solve.
 */

import type {
  CrosswordClue,
  CrosswordDirection,
  CrosswordSpec,
} from "../../problems/crossword/types";

export type ClueAssignment = {
  number: number;
  direction: CrosswordDirection;
  answer: string;
};

export type CrosswordCrossing = {
  row: number;
  col: number;
  acrossNumber: number;
  downNumber: number;
  acrossIndex: number;
  downIndex: number;
};

export type CrosswordPuzzleGrade = {
  label: "exact_solve" | "partial" | "no_answer";
  /** Primary continuous score. */
  letterAccuracy: number;
  wordAccuracy: number;
  completion: number;
  crossingConsistency: number | null;
  exactSolve: boolean;
  fillableCells: number;
  correctLetters: number;
  filledCells: number;
  totalClues: number;
  correctWords: number;
  crossingsCompared: number;
  crossingsAgreeing: number;
  predictedAssignments: ClueAssignment[];
  predictedGrid: string[];
  notes?: string;
};

/** Letters-only uppercase normalization. */
export function normalizeCrosswordAnswer(answer: string): string {
  return answer.replace(/[^A-Za-z]/g, "").toUpperCase();
}

export function crosswordLetterLength(answer: string): number {
  return normalizeCrosswordAnswer(answer).length;
}

export function emptyWorkingGrid(geometry: string[]): string[] {
  return geometry.map((row) =>
    row
      .split("")
      .map((c) => (c === "#" ? "#" : "."))
      .join(""),
  );
}

export function countFillableCells(grid: string[]): number {
  let n = 0;
  for (const row of grid) {
    for (const c of row) {
      if (c !== "#") n += 1;
    }
  }
  return n;
}

export function clueKey(direction: CrosswordDirection, number: number): string {
  return `${direction}:${number}`;
}

/**
 * Parse FINAL_ANSWER clue-assignment blocks.
 * Tolerates lowercase, markdown, punctuation, and flexible separators.
 */
export function parseClueAssignments(raw: string): ClueAssignment[] {
  const text = raw.replace(/\r/g, "").trim();
  if (!text) return [];

  const assignments: ClueAssignment[] = [];
  let direction: CrosswordDirection | null = null;

  for (const originalLine of text.split("\n")) {
    let line = originalLine.trim();
    if (!line) continue;
    line = line.replace(/^\*\*|\*\*$/g, "").replace(/^#+\s*/, "").trim();
    line = line.replace(/^[`*]+|[`*]+$/g, "").trim();

    const header = line.replace(/:$/, "").trim().toLowerCase();
    if (header === "across") {
      direction = "across";
      continue;
    }
    if (header === "down") {
      direction = "down";
      continue;
    }

    // 1: ANSWER | 1. ANSWER | Across 1: ANSWER | 1 - ANSWER
    const withDir = line.match(
      /^(across|down)\s+(\d+)\s*[:.\-–—)]\s*(.+)$/i,
    );
    const numbered = line.match(/^(\d+)\s*[:.\-–—)]\s*(.+)$/);

    let num: number | undefined;
    let answerRaw: string | undefined;
    let dir = direction;

    if (withDir) {
      dir = withDir[1].toLowerCase() as CrosswordDirection;
      num = Number(withDir[2]);
      answerRaw = withDir[3];
    } else if (numbered && dir) {
      num = Number(numbered[1]);
      answerRaw = numbered[2];
    } else {
      continue;
    }

    const answer = normalizeCrosswordAnswer(answerRaw ?? "");
    if (!dir || !Number.isFinite(num) || !answer) continue;

    // Last write wins for duplicate keys.
    const existing = assignments.findIndex(
      (a) => a.direction === dir && a.number === num,
    );
    const next = { number: num, direction: dir, answer };
    if (existing >= 0) assignments[existing] = next;
    else assignments.push(next);
  }

  return assignments;
}

/**
 * Optionally parse a raw letter grid (rows of letters/#) if clue parsing fails.
 */
export function parseGridAnswer(
  raw: string,
  width: number,
  height: number,
): string[] | undefined {
  const recovered = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(across|down|final_answer)/i.test(l))
    .map((l) =>
      l
        .replace(/[^A-Za-z#.\s]/g, "")
        .replace(/\s+/g, "")
        .toUpperCase()
        .replace(/\./g, ""),
    )
    .filter((l) => l.length > 0);

  if (recovered.length !== height) return undefined;
  if (!recovered.every((l) => l.length === width)) return undefined;
  return recovered.map((row) =>
    row
      .split("")
      .map((c) => (c === "#" ? "#" : /[A-Z]/.test(c) ? c : "."))
      .join(""),
  );
}

export function findClueCrossings(clues: CrosswordClue[]): CrosswordCrossing[] {
  const across = clues.filter((c) => c.direction === "across");
  const down = clues.filter((c) => c.direction === "down");
  const crossings: CrosswordCrossing[] = [];

  for (const a of across) {
    for (let ai = 0; ai < a.length; ai++) {
      const row = a.row;
      const col = a.col + ai;
      for (const d of down) {
        for (let di = 0; di < d.length; di++) {
          if (d.row + di === row && d.col === col) {
            crossings.push({
              row,
              col,
              acrossNumber: a.number,
              downNumber: d.number,
              acrossIndex: ai,
              downIndex: di,
            });
          }
        }
      }
    }
  }
  return crossings;
}

export function reconstructGridFromAssignments(args: {
  geometry: string[];
  clues: CrosswordClue[];
  assignments: ClueAssignment[];
}): string[] {
  const grid = emptyWorkingGrid(args.geometry);
  const byKey = new Map(
    args.clues.map((c) => [clueKey(c.direction, c.number), c]),
  );
  const placed = new Map(
    args.assignments.map((a) => [clueKey(a.direction, a.number), a]),
  );

  // Collect candidate letters per cell; keep a letter only when all sources agree.
  const candidates: Array<Array<Set<string> | null>> = grid.map((row) =>
    row.split("").map((c) => (c === "#" ? null : new Set<string>())),
  );

  for (const [key, assignment] of placed) {
    const clue = byKey.get(key);
    if (!clue) continue;
    const letters = assignment.answer.slice(0, clue.length);
    for (let i = 0; i < letters.length; i++) {
      const r = clue.direction === "across" ? clue.row : clue.row + i;
      const c = clue.direction === "across" ? clue.col + i : clue.col;
      const cell = candidates[r]?.[c];
      if (!cell) continue;
      cell.add(letters[i]);
    }
  }

  for (let r = 0; r < grid.length; r++) {
    const rowChars = grid[r].split("");
    for (let c = 0; c < rowChars.length; c++) {
      const cell = candidates[r][c];
      if (!cell) continue;
      if (cell.size === 1) {
        rowChars[c] = [...cell][0];
      }
      // size 0 → remains "."; size > 1 → conflict, leave unfilled
    }
    grid[r] = rowChars.join("");
  }

  return grid;
}

function assignmentsFromGrid(
  grid: string[],
  clues: CrosswordClue[],
): ClueAssignment[] {
  const out: ClueAssignment[] = [];
  for (const clue of clues) {
    const letters: string[] = [];
    let missing = false;
    for (let i = 0; i < clue.length; i++) {
      const r = clue.direction === "across" ? clue.row : clue.row + i;
      const c = clue.direction === "across" ? clue.col + i : clue.col;
      const ch = grid[r]?.[c];
      if (!ch || ch === "#" || ch === ".") {
        missing = true;
        break;
      }
      letters.push(ch);
    }
    if (!missing) {
      out.push({
        number: clue.number,
        direction: clue.direction,
        answer: letters.join(""),
      });
    }
  }
  return out;
}

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
