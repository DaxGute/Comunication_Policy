import type { HiddenProfileItem } from "./types";

/**
 * Shared task framing both agents see. Private packets are attached separately.
 * Gold answer and evaluator metadata are never included.
 */
export function formatHiddenProfileProblemText(item: HiddenProfileItem): string {
  const options = item.options.map((option) => `- ${option}`).join("\n");
  return [
    "Make a joint decision with your partner.",
    "Relevant information may be distributed: you may not see every fact your partner sees.",
    "Communicate what matters. Build shared reasoning in the graph; do not assume full conversation history.",
    "",
    `Title: ${item.title}`,
    "",
    "Decision:",
    item.question,
    "",
    "Options:",
    options,
    "",
    "The shared reasoning graph begins empty.",
    "Create subjects only when information is independently revisable, materially relevant,",
    "and would impair later reasoning if forgotten. Prefer revising existing subjects.",
    "Do not invent fixed lanes for options, evidence categories, or evaluator dimensions.",
    "",
    "Continue while shared reasoning is still changing materially.",
    "Set readyToFinalize: true only when the decision-relevant state looks stable enough",
    "that another exchange is unlikely to change the joint choice.",
    "When ready, report exactly one option as:",
    "FINAL_ANSWER: <exact option text>",
  ].join("\n");
}

export function formatHiddenProfileTitle(item: HiddenProfileItem): string {
  const short =
    item.title.length > 56 ? `${item.title.slice(0, 53).trimEnd()}…` : item.title;
  return `Hidden Profile — ${short}`;
}
