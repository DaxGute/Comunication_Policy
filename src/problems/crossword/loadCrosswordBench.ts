import subset from "../data/crosswordbench_subset.json" with { type: "json" };
import type { Problem } from "../types";
import {
  formatCrosswordProblemText,
  formatCrosswordTitle,
} from "./formatCrosswordProblem";
import type { CrosswordBenchSubsetFile, CrosswordPuzzle } from "./types";

const DATA = subset as CrosswordBenchSubsetFile;

export function getCrosswordBenchSourceMeta(): CrosswordBenchSubsetFile["source"] {
  return DATA.source;
}

export function getCrosswordBenchPuzzles(): CrosswordPuzzle[] {
  return DATA.items;
}

export function crosswordPuzzleToProblem(puzzle: CrosswordPuzzle): Problem {
  return {
    id: puzzle.id,
    category: "crossword",
    kind: "crossword_puzzle",
    title: formatCrosswordTitle(puzzle),
    text: formatCrosswordProblemText(puzzle),
    // No scalar expectedAnswer — gold lives only on crossword.solution / clues.
    crossword: {
      width: puzzle.width,
      height: puzzle.height,
      difficulty: puzzle.difficulty,
      category: puzzle.category,
      grid: puzzle.grid,
      solution: puzzle.solution,
      clues: puzzle.clues,
      source: "crosswordbench",
      sourceId: puzzle.sourceId,
    },
  };
}

export function loadCrosswordBenchProblems(): Problem[] {
  return getCrosswordBenchPuzzles().map(crosswordPuzzleToProblem);
}
