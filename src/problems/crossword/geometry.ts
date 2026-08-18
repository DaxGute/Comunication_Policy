import type { CrosswordClue } from "./types";

export type CrosswordCrossing = {
  row: number;
  col: number;
  acrossNumber: number;
  downNumber: number;
  acrossIndex: number;
  downIndex: number;
};

/** Deterministic crossing geometry. Gold answers are never consulted. */
export function findCrosswordCrossings(
  clues: CrosswordClue[],
): CrosswordCrossing[] {
  const across = clues.filter((clue) => clue.direction === "across");
  const down = clues.filter((clue) => clue.direction === "down");
  const crossings: CrosswordCrossing[] = [];
  for (const a of across) {
    for (const d of down) {
      const row = d.row;
      const col = a.col + (d.col - a.col);
      const acrossIndex = d.col - a.col;
      const downIndex = a.row - d.row;
      if (
        row <= a.row &&
        a.row < d.row + d.length &&
        col === d.col &&
        acrossIndex >= 0 &&
        acrossIndex < a.length &&
        downIndex >= 0 &&
        downIndex < d.length
      ) {
        crossings.push({
          row: a.row,
          col: d.col,
          acrossNumber: a.number,
          downNumber: d.number,
          acrossIndex,
          downIndex,
        });
      }
    }
  }
  return crossings;
}
