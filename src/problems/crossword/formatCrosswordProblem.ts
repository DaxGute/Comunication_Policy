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
 * Every Across/Down letter pair that occupies the same cell.
 * Agent-facing only — no gold letters.
 */
function formatCrossingLines(clues: CrosswordClue[]): string[] {
  const across = clues.filter((c) => c.direction === "across");
  const down = clues.filter((c) => c.direction === "down");
  const lines: string[] = [];

  for (const a of across) {
    for (let ai = 0; ai < a.length; ai++) {
      const row = a.row;
      const col = a.col + ai;
      for (const d of down) {
        for (let di = 0; di < d.length; di++) {
          if (d.row + di === row && d.col === col) {
            lines.push(
              `- Across ${a.number} letter ${ai + 1} = Down ${d.number} letter ${di + 1} (row ${row + 1}, col ${col + 1})`,
            );
          }
        }
      }
    }
  }

  return lines;
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
  const crossings = formatCrossingLines(puzzle.clues);

  return [
    "CROSSWORD",
    "",
    "Grid (1-indexed rows and columns):",
    formatGridBlock(puzzle.grid),
    "",
    '"." = empty cell that needs a letter',
    '"#" = blocked square (no letter)',
    "",
    "ACROSS",
    ...across.map(formatClueLine),
    "",
    "DOWN",
    ...down.map(formatClueLine),
    "",
    "CROSSINGS (shared cells — these letters MUST match):",
    ...(crossings.length > 0
      ? crossings
      : ["- (no across/down overlaps in this grid)"]),
    "",
    "Your goal is to collaboratively solve the ENTIRE crossword.",
    "",
    "## Hard placement rules",
    "Answers that break these rules cannot sit on the grid together:",
    "1. Exact length — each answer must have exactly the stated letter count (no shorter, no longer).",
    "2. Spatial overlap — every CROSSINGS line above is a shared cell. The Across letter and the Down letter at that cell must be identical.",
    "3. Consistency — before locking in FINAL_ANSWER, walk the crossings list and confirm every shared letter agrees. If two candidates disagree at a crossing, at least one is wrong; revise it.",
    "4. Full cover — assign every Across and Down clue. Partial lists leave holes.",
    "",
    "How to check a candidate fill:",
    "- Across N starts at its [row, col] and runs right for N's length.",
    "- Down M starts at its [row, col] and runs down for M's length.",
    "- Where those paths share a cell (listed under CROSSINGS), both answers must put the same letter there.",
    "",
    "Discuss candidates, crossings, conflicts, and revisions with your partner. Do not treat clues as isolated trivia.",
    "You are not required to solve clues in number order; often solving a crossing pair together is better.",
    "",
    "Do not emit a complete solution on every turn. Keep turns in natural language while you explore.",
    "FINAL_ANSWER ends the interaction immediately — only emit it once every clue is filled, every length matches, every crossing agrees, and you need no further partner review.",
    "When ready, report clue assignments as:",
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
    "Use letters only in each answer (spaces and punctuation will be ignored).",
  ].join("\n");
}

export function formatCrosswordTitle(puzzle: CrosswordPuzzle): string {
  const across = puzzle.clues.filter((c) => c.direction === "across").length;
  const down = puzzle.clues.filter((c) => c.direction === "down").length;
  return `Crossword ${puzzle.width}×${puzzle.height} (${puzzle.difficulty}) — ${across} across / ${down} down`;
}
