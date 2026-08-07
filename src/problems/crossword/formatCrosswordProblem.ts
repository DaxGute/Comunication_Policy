import type { CrosswordClue, CrosswordPuzzle } from "./types";

function formatClueLine(clue: CrosswordClue): string {
  const row = clue.row + 1;
  const col = clue.col + 1;
  return `${clue.number}. [row ${row}, col ${col}, ${clue.length} letters] ${clue.clue}`;
}

function formatGridBlock(grid: string[]): string {
  const width = grid[0]?.length ?? 0;
  const colHeader = Array.from({ length: width }, (_, i) => String(i + 1)).join(
    " ",
  );
  const rows = grid.map((row, i) => {
    const cells = row.split("").join(" ");
    return `${String(i + 1).padStart(2, " ")}  ${cells}`;
  });
  return [`   ${colHeader}`, ...rows].join("\n");
}

/**
 * Agent-facing serialization of a complete crossword.
 * Gold answers / solution letters are intentionally omitted.
 */
export function formatCrosswordProblemText(puzzle: CrosswordPuzzle): string {
  const across = puzzle.clues
    .filter((c) => c.direction === "across")
    .sort((a, b) => a.number - b.number);
  const down = puzzle.clues
    .filter((c) => c.direction === "down")
    .sort((a, b) => a.number - b.number);

  return [
    "CROSSWORD",
    "",
    "Grid:",
    formatGridBlock(puzzle.grid),
    "",
    '"." = unknown letter',
    '"#" = blocked square',
    "",
    "ACROSS",
    ...across.map(formatClueLine),
    "",
    "DOWN",
    ...down.map(formatClueLine),
    "",
    "Your goal is to collaboratively solve the ENTIRE crossword.",
    "",
    "Use crossing letters and other clues to test tentative answers. You may revise earlier guesses.",
    "When communicating with the other agent, discuss useful candidate fills, conflicts, crossings, uncertainty, and revisions rather than treating each clue as an isolated question.",
    "You are not required to solve clues in number order.",
    "",
    "Do not emit a complete solution on every turn. Keep turns in natural language while you explore.",
    "When you jointly agree on a full solution, report clue assignments as:",
    "",
    "FINAL_ANSWER:",
    "ACROSS",
    "1: ANSWER",
    "3: ANSWER",
    "...",
    "DOWN",
    "1: ANSWER",
    "2: ANSWER",
    "...",
    "",
    "Use letters only in each answer (spaces and punctuation will be ignored). Match each clue's stated length.",
  ].join("\n");
}

export function formatCrosswordTitle(puzzle: CrosswordPuzzle): string {
  const across = puzzle.clues.filter((c) => c.direction === "across").length;
  const down = puzzle.clues.filter((c) => c.direction === "down").length;
  return `Crossword ${puzzle.width}×${puzzle.height} (${puzzle.difficulty}) — ${across} across / ${down} down`;
}
