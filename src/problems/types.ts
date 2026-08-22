import type { CrosswordSpec } from "./crossword/types";
import type { HiddenProfileSpec } from "./hidden_profile/types";
import type { MoralSpec } from "./moral/types";

export type ProblemCategory =
  | "crossword"
  | "moral_philosophical"
  | "hidden_profile";

export type ProblemKind =
  | "crossword_puzzle"
  | "moral"
  | "hidden_profile"
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
  /**
   * Present when kind === "hidden_profile".
   * Gold answer + evaluatorMetadata are eval/research only — never agent-facing.
   */
  hiddenProfile?: HiddenProfileSpec;
};

export type ProblemCategoryMeta = {
  id: ProblemCategory;
  label: string;
  description: string;
};
