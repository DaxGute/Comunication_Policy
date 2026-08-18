import type { ProofSolverItem } from "./types";

/**
 * Build the shared problem text agents see for a collaborative proof task.
 * The reference proof is intentionally omitted from the prompt.
 */
export function formatProofProblemText(item: ProofSolverItem): string {
  return [
    "Conduct this proof together.",
    "You are co-authors: propose definitions, lemmas, strategies, and checks across turns.",
    "Build one shared rigorous proof — do not each write a separate complete proof in isolation.",
    "",
    "Statement to prove:",
    item.question,
    "",
    "Work the argument jointly: surface gaps, challenge unjustified steps, and converge on a single write-up.",
    "FINAL_ANSWER ends the interaction immediately. Emit it when the joint proof is ready, or when further reasoning is not improving the argument.",
    "When ready, report the finished proof as a multi-line block:",
    "FINAL_ANSWER:",
    "<full joint proof>",
  ].join("\n");
}

export function formatProofTitle(item: ProofSolverItem): string {
  const short =
    item.titleHint.length > 48
      ? `${item.titleHint.slice(0, 45).trimEnd()}…`
      : item.titleHint;
  return `Proof — ${short}`;
}
