/**
 * Thin task adapters: map live reasoning nodes onto universal object kinds
 * and optional taskGrounding. They do not compute metrics.
 */
import type { ProblemCategory } from "../../problems/types";
import type { ReasoningNode } from "../../reasoning/types";
import type { ReasoningObjectKind, TaskGrounding } from "./types";

export const INTERACTION_ADAPTER_VERSION = "interaction-adapter-v1";

export type InteractionAdapter = {
  category: ProblemCategory;
  objectKind(node: ReasoningNode): ReasoningObjectKind;
  taskGrounding(node: ReasoningNode): TaskGrounding | undefined;
};

function nodeSubjectId(node: ReasoningNode): string | undefined {
  return "subjectId" in node && typeof node.subjectId === "string"
    ? node.subjectId
    : undefined;
}

function metaString(
  node: ReasoningNode,
  key: string,
): string | undefined {
  const value = node.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

const crosswordAdapter: InteractionAdapter = {
  category: "crossword",
  objectKind(node) {
    if (node.type === "proposal") return "proposal";
    if (node.type === "claim") return "claim";
    if (node.type === "evidence") return "evidence";
    if (node.type === "final_answer") return "conclusion";
    if (node.type === "issue") return "question";
    return "claim";
  },
  taskGrounding(node) {
    if (node.type === "final_answer" || node.type === "issue") return undefined;
    const subjectId = nodeSubjectId(node);
    return {
      kind: "crossword_entry",
      clueId: subjectId,
      subjectId,
      identity: metaString(node, "candidateIdentity"),
    };
  },
};

const moralAdapter: InteractionAdapter = {
  category: "moral_philosophical",
  objectKind(node) {
    if (node.type === "proposal") return "proposal";
    if (node.type === "claim") return "claim";
    if (node.type === "evidence") return "axiom";
    if (node.type === "final_answer") return "conclusion";
    if (node.type === "issue") return "question";
    return "idea";
  },
  taskGrounding(node) {
    return {
      kind: node.type === "evidence" ? "moral_axiom" : "moral_claim",
      subjectId: nodeSubjectId(node),
    };
  },
};

const proofAdapter: InteractionAdapter = {
  category: "proof",
  objectKind(node) {
    if (node.type === "proposal") return "proposal";
    if (node.type === "claim") return "claim";
    if (node.type === "evidence") return "assumption";
    if (node.type === "final_answer") return "conclusion";
    if (node.type === "issue") return "question";
    return "claim";
  },
  taskGrounding(node) {
    const subjectId = nodeSubjectId(node);
    return {
      kind: "proof_step",
      subjectId,
      theoremComponent: metaString(node, "theoremComponent") ?? subjectId,
    };
  },
};

export function interactionAdapterFor(
  category: ProblemCategory | string | undefined,
): InteractionAdapter {
  if (category === "crossword") return crosswordAdapter;
  if (category === "proof") return proofAdapter;
  return moralAdapter;
}
