import { getCrosswordBenchSourceMeta } from "./crossword/loadCrosswordBench";
import { CROSSWORD_PROBLEMS } from "./crosswordProblems";
import { getRedditEthicsSourceMeta } from "./moral/loadRedditEthics";
import { MORAL_PHILOSOPHICAL_PROBLEMS } from "./moralPhilosophical";
import { getTheoremQaSourceMeta } from "./proof/loadTheoremQa";
import { PROOF_PROBLEMS } from "./proofProblems";
import type { Problem, ProblemCategory, ProblemCategoryMeta } from "./types";

const crosswordSource = getCrosswordBenchSourceMeta();
const moralSource = getRedditEthicsSourceMeta();
const proofSource = getTheoremQaSourceMeta();

export const PROBLEM_CATEGORIES: ProblemCategoryMeta[] = [
  {
    id: "crossword",
    label: "Crossword",
    description: `CrossWordBench full puzzles (${crosswordSource.huggingface}, ${crosswordSource.config} ${crosswordSource.split}, ${CROSSWORD_PROBLEMS.length} puzzles).`,
  },
  {
    id: "moral_philosophical",
    label: "Moral / Philosophical",
    description: `Reddit Ethics open-ended dilemmas (${moralSource.huggingface}, ${MORAL_PHILOSOPHICAL_PROBLEMS.length} items). No gold answers.`,
  },
  {
    id: "proof",
    label: "Proof",
    description: `TheoremQA theorem-driven problems (${proofSource.huggingface}, ${PROOF_PROBLEMS.length} items). Short answers graded.`,
  },
];

const BY_CATEGORY: Record<ProblemCategory, Problem[]> = {
  crossword: CROSSWORD_PROBLEMS,
  moral_philosophical: MORAL_PHILOSOPHICAL_PROBLEMS,
  proof: PROOF_PROBLEMS,
};

export function getProblemsForCategory(category: ProblemCategory): Problem[] {
  return BY_CATEGORY[category];
}

export function selectProblems(
  category: ProblemCategory,
  count: number,
): Problem[] {
  const pool = getProblemsForCategory(category);
  if (count <= 0) return [];
  if (count >= pool.length) return [...pool];
  return pool.slice(0, count);
}

export function getCategoryMeta(
  category: ProblemCategory,
): ProblemCategoryMeta {
  const meta = PROBLEM_CATEGORIES.find((c) => c.id === category);
  if (!meta) {
    throw new Error(`Unknown problem category: ${category}`);
  }
  return meta;
}

export function getProblemById(
  category: ProblemCategory,
  problemId: string,
): Problem | undefined {
  return getProblemsForCategory(category).find((p) => p.id === problemId);
}
