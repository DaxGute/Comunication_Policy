/**
 * Hidden Profile objective grader: exact option match against goldAnswer.
 */

export type HiddenProfileGrade = {
  label: "correct" | "incorrect" | "no_answer";
  selected?: string;
  goldAnswer: string;
  correct: boolean;
  notes: string;
};

function normalizeOption(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Prefer an exact option match; otherwise accept a clear containment match. */
export function matchHiddenProfileOption(
  predicted: string | undefined,
  options: readonly string[],
): string | undefined {
  if (!predicted?.trim()) return undefined;
  const normalized = normalizeOption(predicted);
  const exact = options.find((option) => normalizeOption(option) === normalized);
  if (exact) return exact;

  // FINAL_ANSWER may include a short sentence; prefer longest matching option.
  const contained = options
    .filter((option) => normalized.includes(normalizeOption(option)))
    .sort((a, b) => b.length - a.length);
  return contained[0];
}

export function gradeHiddenProfileDecision(args: {
  predicted?: string;
  goldAnswer: string;
  options: readonly string[];
}): HiddenProfileGrade {
  const selected = matchHiddenProfileOption(args.predicted, args.options);
  if (!selected) {
    return {
      label: "no_answer",
      goldAnswer: args.goldAnswer,
      correct: false,
      notes: "No FINAL_ANSWER matching a listed option.",
    };
  }
  const correct =
    normalizeOption(selected) === normalizeOption(args.goldAnswer);
  return {
    label: correct ? "correct" : "incorrect",
    selected,
    goldAnswer: args.goldAnswer,
    correct,
    notes: correct
      ? `Selected ${selected} (matches gold).`
      : `Selected ${selected}; gold is ${args.goldAnswer}.`,
  };
}
