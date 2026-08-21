import type { MoralDilemmaItem } from "./types";

/**
 * Build the shared problem text agents see for an open-ended dilemma.
 * Source sample answers / resolutions are intentionally omitted.
 * Benchmark issue labels stay on the problem object for evaluation only —
 * they are not listed here so they do not become agent memory.
 */
export function formatMoralProblemText(item: MoralDilemmaItem): string {
  return [
    "Develop and pressure-test the considerations needed for a well-supported",
    "final answer to this ethical / philosophical dilemma.",
    "There is no single objectively correct answer — do not hunt for a gold label.",
    "The stance belongs in FINAL SYNTHESIS, not in every reasoning turn.",
    "",
    `Title: ${item.title}`,
    "",
    "Scenario:",
    item.description,
    "",
    "Discussion question:",
    item.question,
    "",
    "The shared reasoning graph begins empty.",
    "Start with the most important considerations needed to begin reasoning.",
    "Do not attempt an exhaustive decomposition of the dilemma on the first turn.",
    "Later turns may reveal additional considerations.",
    "",
    "During the reasoning phase, each turn should make a small, targeted contribution",
    "to the shared reasoning state rather than synthesize the entire dilemma.",
    "Focus on the most important unresolved part of the current state.",
    "A consideration may be a factor, principle, factual assessment, tradeoff, assumption,",
    "or intermediate conclusion.",
    "Create a new consideration only when it materially affects the problem and can evolve",
    "independently of other considerations.",
    "Do not create rows for the question, overall answer, summaries, examples, or every",
    "sentence you say.",
    "You do not need to resolve every uncertainty immediately — leave some issues open",
    "for the partner to develop.",
    "",
    "Continue while shared reasoning is still changing materially.",
    "Set readyToFinalize: true only when important considerations are sufficiently",
    "developed and there is no specific unresolved issue that another exchange is",
    "reasonably likely to improve.",
    "If your partner's previous turn materially changed the graph, readiness should",
    "normally be false until you have evaluated the consequences of that change.",
    "Mutual readiness on a stable graph opens FINALIZATION PHASE; only then produce",
    "the first comprehensive treatment of the entire dilemma:",
    "FINAL_ANSWER: <1-3 sentence synthesized response>",
  ].join("\n");
}

export function formatMoralTitle(item: MoralDilemmaItem): string {
  const short =
    item.title.length > 56 ? `${item.title.slice(0, 53).trimEnd()}…` : item.title;
  return `Ethics — ${short}`;
}
