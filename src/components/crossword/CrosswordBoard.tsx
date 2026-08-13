import type { ReactNode } from "react";
import type { CrosswordClue, CrosswordSpec } from "../../problems/crossword/types";

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function buildNumberMap(clues: CrosswordClue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const clue of clues) {
    const key = cellKey(clue.row, clue.col);
    if (!map.has(key)) map.set(key, clue.number);
  }
  return map;
}

type CrosswordBoardProps = {
  crossword: CrosswordSpec;
  /** Grid rows to display: geometry (`.` / `#`) or predicted fill. */
  rows: string[];
  label: string;
  /** When true, show letters from `rows` in open cells. */
  showLetters?: boolean;
  /**
   * When set with `showLetters`, tint filled cells light green/red vs gold.
   * Gold letters are never rendered — only used for coloring.
   */
  scoreAgainstSolution?: boolean;
};

export function CrosswordBoard({
  crossword,
  rows,
  label,
  showLetters = false,
  scoreAgainstSolution = false,
}: CrosswordBoardProps) {
  const { width, height, clues } = crossword;
  const numbers = buildNumberMap(clues);

  return (
    <figure className="crossword-board">
      <figcaption className="crossword-board__label">{label}</figcaption>
      <div
        className="crossword-board__grid"
        style={{
          gridTemplateColumns: `repeat(${width}, 25px)`,
          gridTemplateRows: `repeat(${height}, 25px)`,
        }}
        role="img"
        aria-label={`${label}: ${width} by ${height} crossword`}
      >
        {Array.from({ length: height }, (_, row) =>
          Array.from({ length: width }, (_, col) => {
            const geometry = crossword.grid[row]?.[col] ?? "#";
            const blocked = geometry === "#";
            const ch = rows[row]?.[col] ?? (blocked ? "#" : ".");
            const number = numbers.get(cellKey(row, col));
            const letter =
              showLetters && !blocked && ch !== "." && ch !== "#"
                ? ch.toUpperCase()
                : "";

            let cellClass = blocked
              ? "crossword-board__cell crossword-board__cell--blocked"
              : "crossword-board__cell";
            if (scoreAgainstSolution && letter) {
              const gold = (crossword.solution[row]?.[col] ?? "").toUpperCase();
              cellClass +=
                letter === gold
                  ? " crossword-board__cell--correct"
                  : " crossword-board__cell--incorrect";
            }

            return (
              <div key={cellKey(row, col)} className={cellClass}>
                {number != null ? (
                  <span className="crossword-board__num">{number}</span>
                ) : null}
                {letter ? (
                  <span className="crossword-board__letter">{letter}</span>
                ) : null}
              </div>
            );
          }),
        )}
      </div>
    </figure>
  );
}

type CrosswordClueListProps = {
  crossword: CrosswordSpec;
};

export function CrosswordClueList({ crossword }: CrosswordClueListProps) {
  const across = crossword.clues
    .filter((c) => c.direction === "across")
    .sort((a, b) => a.number - b.number);
  const down = crossword.clues
    .filter((c) => c.direction === "down")
    .sort((a, b) => a.number - b.number);

  return (
    <div className="crossword-clues">
      <div className="crossword-clues__col">
        <h4>Across</h4>
        <ol className="crossword-clues__list">
          {across.map((c) => (
            <li key={`a-${c.number}`}>
              <span className="crossword-clues__num">{c.number}.</span> {c.clue}
              <span className="muted"> ({c.length})</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="crossword-clues__col">
        <h4>Down</h4>
        <ol className="crossword-clues__list">
          {down.map((c) => (
            <li key={`d-${c.number}`}>
              <span className="crossword-clues__num">{c.number}.</span> {c.clue}
              <span className="muted"> ({c.length})</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

type CrosswordPreviewProps = {
  crossword: CrosswordSpec;
  /** Optional agent-predicted grid (newline-separated rows). Never gold. */
  predictedGrid?: string;
  /** Rendered to the right of the crossword square (e.g. grade metrics). */
  aside?: ReactNode;
};

/**
 * Predicted fill (or empty geometry before a run) and clue lists.
 * Gold solution letters are never rendered — only used to tint correct/incorrect cells.
 */
export function CrosswordPreview({
  crossword,
  predictedGrid,
  aside,
}: CrosswordPreviewProps) {
  const predictedRows = predictedGrid
    ?.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // Empty geometry (`.` / `#` only) is not a prediction — require letters.
  const hasPrediction = Boolean(
    predictedRows?.some((row) => /[A-Za-z]/.test(row)),
  );

  return (
    <div className="crossword-preview">
      <div className="crossword-preview__boards">
        <CrosswordBoard
          crossword={crossword}
          rows={hasPrediction ? predictedRows! : crossword.grid}
          label={hasPrediction ? "Predicted" : "Puzzle"}
          showLetters={hasPrediction}
          scoreAgainstSolution={hasPrediction}
        />
        {aside ? (
          <div className="crossword-preview__aside">{aside}</div>
        ) : null}
      </div>
      <CrosswordClueList crossword={crossword} />
    </div>
  );
}
