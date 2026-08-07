export type CrosswordDirection = "across" | "down";

/**
 * One numbered entry in a full crossword puzzle.
 * `answer` is the gold fill — evaluation only; never agent-facing.
 */
export type CrosswordClue = {
  number: number;
  direction: CrosswordDirection;
  clue: string;
  /** 0-indexed row of the first cell. */
  row: number;
  /** 0-indexed column of the first cell. */
  col: number;
  length: number;
  /** Letters-only uppercase gold answer. */
  answer: string;
};

/**
 * One complete crossword puzzle (the experimental unit).
 * `grid` uses `#` blocked / `.` empty; `solution` holds gold letters.
 */
export type CrosswordPuzzle = {
  id: string;
  sourceId: number;
  width: number;
  height: number;
  difficulty: string;
  category: string;
  grid: string[];
  solution: string[];
  clues: CrosswordClue[];
};

export type CrosswordBenchSubsetFile = {
  source: {
    name: string;
    huggingface: string;
    config: string;
    split: string;
    paper: string;
    url: string;
    paperUrl: string;
    note: string;
  };
  curatedAt: string;
  count: number;
  items: CrosswordPuzzle[];
};

/** Typed payload attached to Problem when kind === "crossword_puzzle". */
export type CrosswordSpec = {
  width: number;
  height: number;
  difficulty: string;
  category: string;
  /** Empty geometry: `#` blocked, `.` fillable. */
  grid: string[];
  /** Gold solution grid — evaluation only. */
  solution: string[];
  clues: CrosswordClue[];
  source: "crosswordbench";
  sourceId: number;
};
