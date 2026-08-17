import type { CrosswordClue } from "../problems/crossword/types";
import type { ReasoningEdge, ReasoningGraph, ReasoningNode } from "./types";

export type AtomicityWarning = {
  nodeId: string;
  reasons: string[];
};

export type ReasoningGraphDiagnostics = {
  nodeCount: number;
  nodesPerTurn: number;
  proposalCount: number;
  claimCount: number;
  evidenceCount: number;
  issueCount: number;
  atomicityWarningCount: number;
  atomicityWarnings: AtomicityWarning[];
  unlinkedNodeCount: number;
  relationshipCount: number;
  /** Share of non-final nodes incident to at least one typed relationship. */
  relationshipCoverage: number;
  /** Share of evidence nodes used as a source of support or challenge. */
  evidenceUsage: number;
  finalSupportingNodeCount: number;
  invalidFinalSupportCount: number;
  /**
   * Share of deterministically identifiable final-answer parts represented by
   * cited graph nodes. Undefined when the answer has no parseable part keys.
   */
  finalSupportCoverage?: number;
  crossword?: {
    clueSlotCount: number;
    distinctClueSpecificHypothesisCount: number;
  };
};

type DiagnosticOptions = {
  turnCount: number;
  finalAnswer?: string;
  crosswordClues?: CrosswordClue[];
};

const CLUE_REF = /\b(?:(\d+)\s*[- ]?\s*(across|down)|(\d+)\s*([ad]))\b/gi;
const ASSIGNMENT = /\b(?:\d+\s*[- ]?\s*(?:across|down)|\d+\s*[ad])\s*(?:=|is|:)\s*[A-Za-z][A-Za-z -]{0,24}/gi;

function clueKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const match of text.matchAll(CLUE_REF)) {
    const number = match[1] ?? match[3];
    const direction = (match[2] ?? match[4] ?? "").toLowerCase();
    if (!number || !direction) continue;
    keys.add(`${direction.startsWith("a") ? "across" : "down"}:${number}`);
  }
  return keys;
}

function warningFor(node: ReasoningNode): AtomicityWarning | undefined {
  if (node.type === "final_answer") return undefined;
  const reasons: string[] = [];
  const refs = clueKeys(node.text);
  const assignments = node.text.match(ASSIGNMENT)?.length ?? 0;
  const listSeparators = (node.text.match(/[;,]/g) ?? []).length;
  const enumeratedItems = (node.text.match(/(?:^|\s)(?:\d+[.)]|[-•])\s+/g) ?? []).length;

  if (refs.size >= 3) reasons.push(`mentions ${refs.size} distinct clue slots`);
  if (assignments >= 3) reasons.push(`contains ${assignments} answer-like assignments`);
  if (listSeparators >= 4) reasons.push("contains a long enumeration");
  if (enumeratedItems >= 3) reasons.push("contains multiple enumerated propositions");
  return reasons.length > 0 ? { nodeId: node.id, reasons } : undefined;
}

function incidentNodeIds(edges: ReasoningEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    ids.add(edge.sourceNodeId);
    ids.add(edge.targetNodeId);
  }
  return ids;
}

function finalPartKeys(finalAnswer: string | undefined): Set<string> {
  const keys = finalAnswer ? clueKeys(finalAnswer) : new Set<string>();
  if (!finalAnswer) return keys;
  let direction: "across" | "down" | undefined;
  for (const line of finalAnswer.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^across$/i.test(trimmed)) {
      direction = "across";
      continue;
    }
    if (/^down$/i.test(trimmed)) {
      direction = "down";
      continue;
    }
    const assignment = trimmed.match(/^(\d+)\s*:\s*\S+/);
    if (direction && assignment) keys.add(`${direction}:${assignment[1]}`);
  }
  return keys;
}

export function computeReasoningGraphDiagnostics(
  graph: ReasoningGraph,
  options: DiagnosticOptions,
): ReasoningGraphDiagnostics {
  const nodes = graph.nodes.filter((node) => node.type !== "final_answer");
  const edges = graph.edges ?? [];
  const incident = incidentNodeIds(edges);
  const warnings = nodes
    .map(warningFor)
    .filter((warning): warning is AtomicityWarning => Boolean(warning));
  const evidence = nodes.filter((node) => node.type === "evidence");
  const usedEvidence = new Set(
    edges
      .filter(
        (edge) =>
          edge.type === "supports" || edge.type === "challenges",
      )
      .map((edge) => edge.sourceNodeId),
  );
  const finalNode = graph.nodes.find((node) => node.type === "final_answer");
  const validFinalSupports =
    finalNode?.type === "final_answer"
      ? finalNode.supportingNodeIds.filter((id) =>
          graph.nodes.some(
            (node) =>
              node.id === id &&
              node.type !== "final_answer" &&
              node.status !== "rejected" &&
              node.status !== "superseded",
          ),
        )
      : [];
  const finalKeys = finalPartKeys(options.finalAnswer ?? finalNode?.text);
  const citedKeys = new Set<string>();
  for (const id of validFinalSupports) {
    const node = graph.nodes.find((candidate) => candidate.id === id);
    if (!node) continue;
    for (const key of clueKeys(node.text)) citedKeys.add(key);
  }

  const distinctHypotheses = new Set<string>();
  for (const node of nodes) {
    if (!node.text.match(ASSIGNMENT)) continue;
    for (const key of clueKeys(node.text)) distinctHypotheses.add(`${key}:${node.text}`);
  }

  return {
    nodeCount: nodes.length,
    nodesPerTurn: options.turnCount > 0 ? nodes.length / options.turnCount : 0,
    proposalCount: nodes.filter((node) => node.type === "proposal").length,
    claimCount: nodes.filter((node) => node.type === "claim").length,
    evidenceCount: evidence.length,
    issueCount: nodes.filter((node) => node.type === "issue").length,
    atomicityWarningCount: warnings.length,
    atomicityWarnings: warnings,
    unlinkedNodeCount: nodes.filter((node) => !incident.has(node.id)).length,
    relationshipCount: edges.filter(
      (edge) => edge.targetNodeId !== "__final_answer__",
    ).length,
    relationshipCoverage:
      nodes.length > 0
        ? nodes.filter((node) => incident.has(node.id)).length / nodes.length
        : 0,
    evidenceUsage:
      evidence.length > 0
        ? evidence.filter((node) => usedEvidence.has(node.id)).length /
          evidence.length
        : 0,
    finalSupportingNodeCount: validFinalSupports.length,
    invalidFinalSupportCount:
      finalNode?.type === "final_answer" ? finalNode.supportErrors.length : 0,
    ...(finalKeys.size > 0
      ? {
          finalSupportCoverage:
            [...finalKeys].filter((key) => citedKeys.has(key)).length /
            finalKeys.size,
        }
      : {}),
    ...(options.crosswordClues
      ? {
          crossword: {
            clueSlotCount: options.crosswordClues.length,
            distinctClueSpecificHypothesisCount: distinctHypotheses.size,
          },
        }
      : {}),
  };
}
