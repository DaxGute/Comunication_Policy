export type ProofSolverItem = {
  id: string;
  sourceIndex: number;
  titleHint: string;
  question: string;
  /** Reference proof for research inspectability only — never agent-facing. */
  referenceProof: string;
};

export type ProofSolverSubsetFile = {
  source: {
    name: string;
    huggingface: string;
    split: string;
    license: string;
    url: string;
    note: string;
  };
  curatedAt: string;
  count: number;
  items: ProofSolverItem[];
};

export type ProofSpec = {
  question: string;
  /** Reference proof; evaluation-only / inspectability. */
  referenceProof: string;
  source: "proofsolver";
  sourceIndex: number;
};
