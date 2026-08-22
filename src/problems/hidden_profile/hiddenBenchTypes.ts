/**
 * Official HiddenBench task shapes (Yassellee/HiddenBench_ICML data/benchmark.json).
 * Fields match the published benchmark; do not invent schema.
 */

export type HiddenBenchTask = {
  id: number;
  name: string;
  description: string;
  shared_information: string[];
  /** One private fact string per original agent (length 3 or 4). */
  hidden_information: string[];
  possible_answers: string[];
  correct_answer: string;
  /** Present on most generated tasks; evaluator-only when adapted. */
  rationale?: string;
};

export type HiddenBenchBenchmarkFile = HiddenBenchTask[];

export type HiddenBenchSourceMeta = {
  name: "HiddenBench";
  license: "MIT";
  github: string;
  huggingface: string;
  file: string;
  /** Git commit that provided the vendored benchmark.json. */
  commit: string;
  commitDate: string;
  count: number;
  note: string;
};
