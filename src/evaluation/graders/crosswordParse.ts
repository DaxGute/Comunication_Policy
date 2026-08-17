/**
 * Crossword answer parsing and grid reconstruction.
 *
 * Scoring (letter/word accuracy, crossings) lives in crosswordGrader.ts.
 */
import type {
  CrosswordClue,
  CrosswordDirection,
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

export function assignmentsFromGrid(
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

