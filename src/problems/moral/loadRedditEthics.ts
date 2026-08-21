import subset from "../data/reddit_ethics_subset.json" with { type: "json" };
import type { Problem } from "../types";
import { formatMoralProblemText, formatMoralTitle } from "./formatMoralProblem";
import type { MoralDilemmaItem, MoralSubsetFile } from "./types";

const DATA = subset as MoralSubsetFile;

export function getRedditEthicsSourceMeta(): MoralSubsetFile["source"] {
  return DATA.source;
}

export function getRedditEthicsItems(): MoralDilemmaItem[] {
  return DATA.items;
}

export function moralItemToProblem(item: MoralDilemmaItem): Problem {
  return {
    id: item.id,
    category: "moral_philosophical",
    kind: "moral",
    title: formatMoralTitle(item),
    text: formatMoralProblemText(item),
    // Intentionally no expectedAnswer — open-ended.
    moral: {
      title: item.title,
      description: item.description,
      issues: item.issues,
      question: item.question,
      source: "reddit_ethics",
      sourceIndex: item.sourceIndex,
      ...(item.informationUnits && item.informationUnits.length > 0
        ? { informationUnits: item.informationUnits }
        : {}),
    },
  };
}

export function loadRedditEthicsProblems(): Problem[] {
  return getRedditEthicsItems().map(moralItemToProblem);
}
