import type { InformationUnit } from "../../information/types";

export type MoralDilemmaItem = {
  id: string;
  sourceIndex: number;
  title: string;
  description: string;
  issues: string[];
  question: string;
  alternateQuestions: string[];
  /**
   * Optional authored case facts for asymmetric-information experiments.
   * When absent, the loader segments `description` deterministically.
   * Never includes evaluator-only issue labels as agent-facing units.
   */
  informationUnits?: InformationUnit[];
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
  /** Authored or deterministically segmented case facts (splitable units). */
  informationUnits?: InformationUnit[];
};
