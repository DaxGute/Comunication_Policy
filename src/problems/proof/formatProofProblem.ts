import type { TheoremQaItem } from "./types";

/**
 * Build the shared problem text agents see for a theorem-driven proof/QA item.
 * Gold answer is intentionally omitted from the prompt.
 */
export function formatProofProblemText(item: TheoremQaItem): string {
  const theoremLine = item.theorem
    ? `Relevant theorem / concept: ${item.theorem}`
    : "Derive the result carefully from first principles or a named theorem.";

  return [
    "Solve this theorem-driven problem together.",
    "Provide a short joint proof / derivation, then a final answer.",
    "",
    `Field: ${item.field}${item.subfield ? ` / ${item.subfield}` : ""}`,
    theoremLine,
    "",
    "Problem:",
    item.question,
    "",
    "Discuss the reasoning, check edge cases, and converge.",
    "FINAL_ANSWER ends the interaction immediately — only emit it once the result is locked in and you need no further partner review.",
    "When ready, report the final result as:",
    "FINAL_ANSWER: <answer>",
    "",
    answerFormatHint(item.answerType),
  ].join("\n");
}

export function formatProofTitle(item: TheoremQaItem): string {
  const label = item.theorem || item.subfield || item.field;
  const short =
    label.length > 40 ? `${label.slice(0, 37).trimEnd()}…` : label;
  return `Proof — ${short}`;
}

function answerFormatHint(answerType: string): string {
  switch (answerType) {
    case "integer":
      return "Expected answer form: an integer.";
    case "float":
      return "Expected answer form: a number (integer or decimal).";
    case "bool":
      return "Expected answer form: true or false.";
    case "list of integer":
      return "Expected answer form: a list of integers, e.g. [0, 1, 2].";
    case "list of float":
      return "Expected answer form: a list of numbers, e.g. [1.0, 2.5].";
    case "option":
      return "Expected answer form: the chosen option (letter or option text).";
    default:
      return `Expected answer form: ${answerType}.`;
  }
}
