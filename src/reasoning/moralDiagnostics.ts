/**
 * Moral final-synthesis and agent-created consideration diagnostics.
 * Coverage vs benchmark reference labels is post-hoc only.
 */
import { isForbiddenMoralSubject } from "./moralOntology";
import type { ReasoningGraph, ReasoningSubject } from "./types";

export type MoralSynthesisDiagnostics = {
  activeConsiderationCount: number;
  seededConsiderationCount: number;
  dynamicallyCreatedConsiderationCount: number;
  agentCreatedConsiderationCount: number;
  considerationsCreatedA: number;
  considerationsCreatedB: number;
  considerationsRevisedA: number;
  considerationsRevisedB: number;
  revisedConsiderationCount: number;
  finalBasisCount: number;
  finalBasisDeclared: boolean;
  finalBasisCoverageRate: number | null;
  unusedActiveConsiderationCount: number;
  finalBasisAContribution: number;
  finalBasisBContribution: number;
  /** Post-hoc: share of reference labels with a fuzzy match among agent lanes. */
  referenceConsiderationCoverage: number | null;
  novelConsiderationCount: number;
  referenceConsiderationCount: number;
};

function considerationSubjects(graph: ReasoningGraph): ReasoningSubject[] {
  return graph.subjects.filter((subject) => !isForbiddenMoralSubject(subject));
}

function normalizeLabel(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function labelsOverlap(a: string, b: string): boolean {
  const left = normalizeLabel(a);
  const right = normalizeLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(" ").filter((t) => t.length > 2));
  const rightTokens = right.split(" ").filter((t) => t.length > 2);
  if (leftTokens.size === 0 || rightTokens.length === 0) return false;
  const hit = rightTokens.filter((t) => leftTokens.has(t)).length;
  return hit / Math.max(leftTokens.size, rightTokens.length) >= 0.5;
}

export function computeMoralSynthesisDiagnostics(
  graph: ReasoningGraph,
  options: {
    finalBasisVersionIds?: string[];
    finalBasisDeclared?: boolean;
    /** Benchmark issue labels; never shown to agents by default. */
    referenceConsiderations?: string[];
  } = {},
): MoralSynthesisDiagnostics {
  const subjects = considerationSubjects(graph);
  const active = subjects.filter((subject) =>
    graph.versions.some(
      (version) => version.subjectId === subject.id && version.status === "active",
    ),
  );
  const seeded = subjects.filter((subject) => subject.source === "task");
  const created = subjects.filter((subject) => subject.source === "agent");
  const revisedSubjects = new Set(
    graph.versions
      .filter((version) => version.previousVersionId)
      .map((version) => version.subjectId),
  );
  let considerationsRevisedA = 0;
  let considerationsRevisedB = 0;
  for (const version of graph.versions) {
    if (!version.previousVersionId) continue;
    if (version.agentId === "agent_a") considerationsRevisedA += 1;
    if (version.agentId === "agent_b") considerationsRevisedB += 1;
  }
  const basisIds = options.finalBasisVersionIds ?? [];
  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  const basisVersions = basisIds
    .map((id) => byId.get(id))
    .filter((version): version is NonNullable<typeof version> => Boolean(version));
  const usedSubjects = new Set(basisVersions.map((version) => version.subjectId));
  const unused = active.filter((subject) => !usedSubjects.has(subject.id)).length;
  const declared = options.finalBasisDeclared === true;
  const references = (options.referenceConsiderations ?? [])
    .map((item) => item.trim())
    .filter(Boolean);
  let covered = 0;
  const matchedSubjectIds = new Set<string>();
  for (const reference of references) {
    const match = subjects.find((subject) =>
      labelsOverlap(subject.label ?? subject.id, reference),
    );
    if (match) {
      covered += 1;
      matchedSubjectIds.add(match.id);
    }
  }
  return {
    activeConsiderationCount: active.length,
    seededConsiderationCount: seeded.length,
    dynamicallyCreatedConsiderationCount: created.length,
    agentCreatedConsiderationCount: created.length,
    considerationsCreatedA: created.filter((subject) => subject.createdBy === "agent_a")
      .length,
    considerationsCreatedB: created.filter((subject) => subject.createdBy === "agent_b")
      .length,
    considerationsRevisedA,
    considerationsRevisedB,
    revisedConsiderationCount: [...revisedSubjects].filter((id) =>
      subjects.some((subject) => subject.id === id),
    ).length,
    finalBasisCount: basisVersions.length,
    finalBasisDeclared: declared,
    finalBasisCoverageRate:
      active.length > 0 ? basisVersions.length / active.length : null,
    unusedActiveConsiderationCount: unused,
    finalBasisAContribution: basisVersions.filter((version) => version.agentId === "agent_a")
      .length,
    finalBasisBContribution: basisVersions.filter((version) => version.agentId === "agent_b")
      .length,
    referenceConsiderationCount: references.length,
    referenceConsiderationCoverage:
      references.length > 0 ? covered / references.length : null,
    novelConsiderationCount: subjects.filter(
      (subject) => !matchedSubjectIds.has(subject.id),
    ).length,
  };
}
