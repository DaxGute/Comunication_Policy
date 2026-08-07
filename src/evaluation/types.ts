export type ProblemEvaluation = {
  problemId: string;
  problemTitle: string;
  turns: number;
  finalAnswer?: string;
  /** Category-specific score; meaning depends on evaluator. */
  score?: number;
  label?: string;
  notes?: string;
  /** Grader-specific structured fields (e.g. crossword metrics). */
  details?: Record<string, string | number | boolean | null | undefined>;
};

export type EvaluationResult = {
  /** Lightweight aggregate fields — not a universal metric. */
  summary: Record<string, number | string>;
  problems: ProblemEvaluation[];
};
