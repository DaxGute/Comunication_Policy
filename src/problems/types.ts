import type { CrosswordSpec } from "./crossword/types";
import type { MoralSpec } from "./moral/types";
import type { ProofSpec } from "./proof/types";

export type ProblemCategory =
  | "crossword"
  | "moral_philosophical"
  | "proof";

export type ProblemKind =
  | "crossword_puzzle"
  | "moral"
  | "proof"
  | "generic";

export type Problem = {
  id: string;
  category: ProblemCategory;
  title: string;
  text: string;
  kind?: ProblemKind;
  /** Optional gold answer for categories that have one (not used for crossword). */
  expectedAnswer?: string;
  /** Present when kind === "crossword_puzzle". Full puzzle; solution is eval-only. */
  crossword?: CrosswordSpec;
  /** Present when kind === "moral". Open-ended; no gold answer. */
  moral?: MoralSpec;
  /** Present when kind === "proof". Collaborative prove-that; reference is eval-only. */
  proof?: ProofSpec;
};

export type ProblemCategoryMeta = {
  id: ProblemCategory;
  label: string;
  description: string;
};
