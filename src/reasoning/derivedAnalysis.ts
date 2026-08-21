/**
 * Inferred labels sitting above the canonical graph.
 * Never written back into subjects, versions, or events.
 */
import { computeCanonicalReasoningMetrics, type CanonicalReasoningMetrics } from "./metrics";
import type { ReasoningGraph } from "./types";

export type DerivedReasoningAnalysis = {
  inferred: true;
  likelySynthesisCount: number;
  likelyDeferenceAB: number;
  likelyDeferenceBA: number;
  likelyDisagreementRevisions: number;
  metrics: Pick<
    CanonicalReasoningMetrics,
    | "crossAgentDerivedFromAtoB"
    | "crossAgentDerivedFromBtoA"
    | "multiSourceDerivationRate"
    | "partnerOverwriteAtoB"
    | "partnerOverwriteBtoA"
  >;
};

/**
 * Heuristics from explicit provenance and overwrite counts.
 * These are research annotations, not graph facts.
 */
export function deriveReasoningAnalysis(graph: ReasoningGraph): DerivedReasoningAnalysis {
  const metrics = computeCanonicalReasoningMetrics(graph);
  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  let likelyDeferenceAB = 0;
  let likelyDeferenceBA = 0;
  for (const version of graph.versions) {
    const basis = version.derivedFromVersionIds ?? [];
    if (basis.length === 0) continue;
    const sources = basis
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (sources.length === 0) continue;
    const allFromA = sources.every((source) => source.agentId === "agent_a");
    const allFromB = sources.every((source) => source.agentId === "agent_b");
    if (version.agentId === "agent_b" && allFromA) likelyDeferenceAB += 1;
    if (version.agentId === "agent_a" && allFromB) likelyDeferenceBA += 1;
  }
  return {
    inferred: true,
    likelySynthesisCount: graph.versions.filter(
      (version) => (version.derivedFromVersionIds?.length ?? 0) > 1,
    ).length,
    likelyDeferenceAB,
    likelyDeferenceBA,
    likelyDisagreementRevisions: metrics.crossAgentRevisionCount,
    metrics: {
      crossAgentDerivedFromAtoB: metrics.crossAgentDerivedFromAtoB,
      crossAgentDerivedFromBtoA: metrics.crossAgentDerivedFromBtoA,
      multiSourceDerivationRate: metrics.multiSourceDerivationRate,
      partnerOverwriteAtoB: metrics.partnerOverwriteAtoB,
      partnerOverwriteBtoA: metrics.partnerOverwriteBtoA,
    },
  };
}
