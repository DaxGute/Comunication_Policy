import { getCrosswordBenchSourceMeta } from "./crossword/loadCrosswordBench";
import { CROSSWORD_PROBLEMS } from "./crosswordProblems";
import { getHiddenProfileSourceMeta } from "./hidden_profile/loadHiddenProfile";
import { HIDDEN_PROFILE_PROBLEMS } from "./hiddenProfileProblems";
import { getRedditEthicsSourceMeta } from "./moral/loadRedditEthics";
import { MORAL_PHILOSOPHICAL_PROBLEMS } from "./moralPhilosophical";
import type { Problem, ProblemCategory, ProblemCategoryMeta } from "./types";
import { hashStringToSeed, mulberry32 } from "../information/split";

const crosswordSource = getCrosswordBenchSourceMeta();
const moralSource = getRedditEthicsSourceMeta();
const hiddenProfileSource = getHiddenProfileSourceMeta();

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
    id: "hidden_profile",
    label: "Hidden Profile",
    description: `HiddenBench objective decisions (${hiddenProfileSource.huggingface ?? "HiddenBench"}, ${HIDDEN_PROFILE_PROBLEMS.length} tasks). Gold answers are evaluator-only.`,
  },
];

const BY_CATEGORY: Record<ProblemCategory, Problem[]> = {
  crossword: CROSSWORD_PROBLEMS,
  moral_philosophical: MORAL_PHILOSOPHICAL_PROBLEMS,
  hidden_profile: HIDDEN_PROFILE_PROBLEMS,
};

export function getProblemsForCategory(category: ProblemCategory): Problem[] {
  return BY_CATEGORY[category];
}

export type SelectProblemsOptions = {
  /**
   * Deterministic sample seed. Same seed + category + count → same IDs/order.
   * When omitted, falls back to Math.random (legacy).
   */
  seed?: string;
  /**
   * Exact problem IDs to run (order preserved). Missing IDs are skipped.
   * When set, overrides count-based sampling.
   */
  problemIds?: readonly string[];
};

/** Uniform sample without replacement. Order is shuffled even when taking the full pool. */
function sampleProblems(
  pool: Problem[],
  count: number,
  seed?: string,
): Problem[] {
  const n = Math.min(count, pool.length);
  const copy = [...pool];
  const rand = seed
    ? mulberry32(hashStringToSeed(`problem-sample|${seed}`))
    : () => Math.random();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (copy.length - i));
    const a = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = a;
  }
  return copy.slice(0, n);
}

/**
 * Select problems for a run.
 * Prefer `problemIds` (paired sweeps) or `seed` (reproducible draws).
 */
export function selectProblems(
  category: ProblemCategory,
  count: number,
  options?: SelectProblemsOptions,
): Problem[] {
  const pool = getProblemsForCategory(category);
  if (count <= 0 && !options?.problemIds?.length) return [];

  if (options?.problemIds && options.problemIds.length > 0) {
    const byId = new Map(pool.map((p) => [p.id, p]));
    const resolved: Problem[] = [];
    for (const id of options.problemIds) {
      const problem = byId.get(id);
      if (problem) resolved.push(problem);
    }
    return resolved;
  }

  if (count <= 0) return [];
  return sampleProblems(pool, count, options?.seed);
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
