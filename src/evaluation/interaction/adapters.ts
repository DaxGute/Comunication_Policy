/**
 * Thin task adapters: map live reasoning versions onto universal object kinds.
 */
import type { ProblemCategory } from "../../problems/types";
import type { EvalNode } from "../moral/graphView";
import type { ReasoningObjectKind, TaskGrounding } from "./types";

export const INTERACTION_ADAPTER_VERSION = "interaction-adapter-v1";

export type InteractionAdapter = {
  category: ProblemCategory;
  objectKind(node: EvalNode): ReasoningObjectKind;
  taskGrounding(node: EvalNode): TaskGrounding | undefined;
};

const crosswordAdapter: InteractionAdapter = {
  category: "crossword",
  objectKind() {
    return "claim";
  },
  taskGrounding(node) {
    return {
      kind: "crossword_entry",
      clueId: node.subjectId,
      subjectId: node.subjectId,
    };
  },
};

const moralAdapter: InteractionAdapter = {
  category: "moral_philosophical",
  objectKind() {
    return "claim";
  },
  taskGrounding(node) {
    return {
      kind: "moral_claim",
      subjectId: node.subjectId,
    };
  },
};

const hiddenProfileAdapter: InteractionAdapter = {
  category: "hidden_profile",
  objectKind() {
    return "claim";
  },
  taskGrounding(node) {
    return {
      kind: "decision_claim",
      subjectId: node.subjectId,
    };
  },
};

export function interactionAdapterFor(
  category: ProblemCategory | string | undefined,
): InteractionAdapter {
  if (category === "crossword") return crosswordAdapter;
  if (category === "hidden_profile") return hiddenProfileAdapter;
  return moralAdapter;
}
