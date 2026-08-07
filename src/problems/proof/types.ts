export type ProofAnswerType =
  | "integer"
  | "float"
  | "bool"
  | "list of integer"
  | "list of float"
  | "option"
  | string;

export type TheoremQaItem = {
  id: string;
  sourceId: string;
  sourceIndex: number;
  question: string;
  answer: string;
  answerType: ProofAnswerType;
  theorem: string;
  field: string;
  subfield: string;
};

export type TheoremQaSubsetFile = {
  source: {
    name: string;
    huggingface: string;
    paper: string;
    license: string;
    url: string;
    note: string;
  };
  curatedAt: string;
  count: number;
  items: TheoremQaItem[];
};

export type ProofSpec = {
  question: string;
  answer: string;
  answerType: ProofAnswerType;
  theorem: string;
  field: string;
  subfield: string;
  source: "theoremqa";
  sourceId: string;
  sourceIndex: number;
};
