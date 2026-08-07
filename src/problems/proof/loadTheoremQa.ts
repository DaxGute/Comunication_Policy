import subset from "../data/theoremqa_subset.json" with { type: "json" };
import type { Problem } from "../types";
import { formatProofProblemText, formatProofTitle } from "./formatProofProblem";
import type { TheoremQaItem, TheoremQaSubsetFile } from "./types";

const DATA = subset as TheoremQaSubsetFile;

export function getTheoremQaSourceMeta(): TheoremQaSubsetFile["source"] {
  return DATA.source;
}

export function getTheoremQaItems(): TheoremQaItem[] {
  return DATA.items;
}

export function theoremItemToProblem(item: TheoremQaItem): Problem {
  return {
    id: item.id,
    category: "proof",
    kind: "proof",
    title: formatProofTitle(item),
    text: formatProofProblemText(item),
    expectedAnswer: item.answer,
    proof: {
      question: item.question,
      answer: item.answer,
      answerType: item.answerType,
      theorem: item.theorem,
      field: item.field,
      subfield: item.subfield,
      source: "theoremqa",
      sourceId: item.sourceId,
      sourceIndex: item.sourceIndex,
    },
  };
}

export function loadTheoremQaProblems(): Problem[] {
  return getTheoremQaItems().map(theoremItemToProblem);
}
