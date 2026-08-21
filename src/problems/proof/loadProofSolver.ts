import subset from "../data/proofsolver_subset.json" with { type: "json" };
import type { Problem } from "../types";
import { formatProofProblemText, formatProofTitle } from "./formatProofProblem";
import type { ProofSolverItem, ProofSolverSubsetFile } from "./types";

const DATA = subset as ProofSolverSubsetFile;

export function getProofSolverSourceMeta(): ProofSolverSubsetFile["source"] {
  return DATA.source;
}

export function getProofSolverItems(): ProofSolverItem[] {
  return DATA.items;
}

export function proofItemToProblem(item: ProofSolverItem): Problem {
  return {
    id: item.id,
    category: "proof",
    kind: "proof",
    title: formatProofTitle(item),
    text: formatProofProblemText(item),
    // No expectedAnswer — proofs are not short-answer graded.
    proof: {
      question: item.question,
      referenceProof: item.referenceProof,
      source: "proofsolver",
      sourceIndex: item.sourceIndex,
      ...(item.informationUnits && item.informationUnits.length > 0
        ? { informationUnits: item.informationUnits }
        : {}),
    },
  };
}

export function loadProofSolverProblems(): Problem[] {
  return getProofSolverItems().map(proofItemToProblem);
}
