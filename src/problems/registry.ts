import { getCrosswordBenchSourceMeta } from "./crossword/loadCrosswordBench";
import { CROSSWORD_PROBLEMS } from "./crosswordProblems";
import { getRedditEthicsSourceMeta } from "./moral/loadRedditEthics";
import { MORAL_PHILOSOPHICAL_PROBLEMS } from "./moralPhilosophical";
import { getProofSolverSourceMeta } from "./proof/loadProofSolver";
import { PROOF_PROBLEMS } from "./proofProblems";
import type { Problem, ProblemCategory, ProblemCategoryMeta } from "./types";

const crosswordSource = getCrosswordBenchSourceMeta();
const moralSource = getRedditEthicsSourceMeta();
const proofSource = getProofSolverSourceMeta();

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
    description: `ProofSolver prove-that problems (${proofSource.huggingface}, ${PROOF_PROBLEMS.length} items). Agents write a joint proof; not short-answer graded.`,
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

/** Uniform sample without replacement. Order is shuffled even when taking the full pool. */
function sampleProblems(pool: Problem[], count: number): Problem[] {
  const n = Math.min(count, pool.length);
  const copy = [...pool];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy.slice(0, n);
}

export function selectProblems(
  category: ProblemCategory,
  count: number,
): Problem[] {
  const pool = getProblemsForCategory(category);
  if (count <= 0) return [];
  return sampleProblems(pool, count);
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
