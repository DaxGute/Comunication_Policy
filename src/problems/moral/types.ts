export type MoralDilemmaItem = {
  id: string;
  sourceIndex: number;
  title: string;
  description: string;
  issues: string[];
  question: string;
  alternateQuestions: string[];
};

export type MoralSubsetFile = {
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
  items: MoralDilemmaItem[];
};

export type MoralSpec = {
  title: string;
  description: string;
  issues: string[];
  question: string;
  source: "reddit_ethics";
  sourceIndex: number;
};
