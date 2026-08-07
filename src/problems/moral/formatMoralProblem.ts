import type { MoralDilemmaItem } from "./types";

/**
 * Build the shared problem text agents see for an open-ended dilemma.
 * Source sample answers / resolutions are intentionally omitted.
 */
export function formatMoralProblemText(item: MoralDilemmaItem): string {
  const issues =
    item.issues.length > 0
      ? item.issues.map((issue) => `- ${issue}`).join("\n")
      : "- (none listed)";

  return [
    "Discuss this ethical / philosophical dilemma together.",
    "There is no single objectively correct answer.",
    "",
    `Title: ${item.title}`,
    "",
    "Scenario:",
    item.description,
    "",
    "Key tensions:",
    issues,
    "",
    "Discussion question:",
    item.question,
    "",
    "Explore competing principles, counterarguments, and uncertainty.",
    "FINAL_ANSWER ends the interaction immediately — only emit it once your shared stance is locked in and you need no further partner review.",
    "When ready, report it as:",
    "FINAL_ANSWER: <1-3 sentence joint stance>",
  ].join("\n");
}

export function formatMoralTitle(item: MoralDilemmaItem): string {
  const short =
    item.title.length > 56 ? `${item.title.slice(0, 53).trimEnd()}…` : item.title;
  return `Ethics — ${short}`;
}
