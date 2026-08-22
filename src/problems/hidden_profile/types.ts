import type { InformationUnit } from "../../information/types";

/**
 * Hidden Profile decision problems with authored information visibility.
 *
 * Gold answer and evaluatorMetadata are research/eval only — never agent-facing.
 */

export type HiddenProfileVisibility = "shared" | "a_private" | "b_private";

export type HiddenProfileEvidenceStructure =
  | "complementary"
  | "conflicting"
  | "classic_hidden_profile"
  | "authority_conflict";

export type HiddenProfileInformationUnit = InformationUnit & {
  visibility: HiddenProfileVisibility;
};

export type HiddenProfileEvidenceByOption = Record<
  string,
  {
    supportingUnitIds: string[];
    /** Evaluator-only relative strength when known (higher = stronger). */
    evidenceStrength?: number;
  }
>;

export type HiddenProfileEvaluatorMetadata = {
  evidenceStructure: HiddenProfileEvidenceStructure;
  evidenceByOption: HiddenProfileEvidenceByOption;
  decisiveInformationIds: string[];
  /** Optional notes for researcher inspectability; never shown to agents. */
  notes?: string;
};

export type HiddenProfileItem = {
  id: string;
  title: string;
  question: string;
  options: string[];
  information: HiddenProfileInformationUnit[];
  goldAnswer: string;
  evaluatorMetadata: HiddenProfileEvaluatorMetadata;
};

/** Legacy smoke-test JSON envelope (not the live problem pool). */
export type HiddenProfileSubsetFile = {
  source: {
    name: string;
    license: string;
    note: string;
  };
  curatedAt: string;
  count: number;
  items: HiddenProfileItem[];
};

/**
 * Traceability back to the official HiddenBench item.
 * Never injected into agent prompts.
 */
export type HiddenBenchProvenance = {
  dataset: "HiddenBench";
  datasetVersion: string;
  datasetCommitDate: string;
  github: string;
  huggingface: string;
  sourceFile: string;
  sourceTaskId: number;
  sourceTaskName: string;
  /** Original HiddenBench agent count (= hidden_information.length). */
  sourceAgentCount: number;
  /** How N private facts were mapped onto A/B. */
  dyadicPartition: "round_robin";
  license: "MIT";
};

export type HiddenProfileSpec = {
  title: string;
  question: string;
  options: string[];
  information: HiddenProfileInformationUnit[];
  goldAnswer: string;
  evaluatorMetadata: HiddenProfileEvaluatorMetadata;
  source: "hiddenbench" | "diagnostic";
  /** Stable source key: HiddenBench `name`, or diagnostic id. */
  sourceId: string;
  /** Present when source === "hiddenbench". */
  hiddenBench?: HiddenBenchProvenance;
};

/** Run-level information condition for the same underlying problem. */
export type HiddenProfileInformationCondition = "distributed" | "full";
