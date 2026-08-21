/**
 * Final-synthesis provenance. Not a graph mutation and not a derived_from edge.
 * Agents may cite active considerations that materially contributed.
 * Missing basis is left empty; it is never inferred.
 */
import { parseBasisField, resolveBasisRef } from "./provenance";
import type { ReasoningGraph } from "./types";

export type FinalBasisResolution = {
  declared: boolean;
  versionIds: string[];
  errors: string[];
};

export function parseFinalBasisField(raw: unknown): {
  declared: boolean;
  refs: string[];
} {
  if (raw === undefined) return { declared: false, refs: [] };
  return { declared: true, refs: parseBasisField(raw) };
}

export function resolveFinalBasis(
  refs: string[] | undefined,
  declared: boolean,
  graph: ReasoningGraph,
): FinalBasisResolution {
  if (!declared) {
    return { declared: false, versionIds: [], errors: [] };
  }
  const versionIds: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs ?? []) {
    const resolved = resolveBasisRef(ref, graph.versions, graph.subjects);
    if (resolved.error || !resolved.versionId) {
      errors.push(resolved.error ?? `unresolved finalBasis ${ref}`);
      continue;
    }
    if (seen.has(resolved.versionId)) continue;
    seen.add(resolved.versionId);
    versionIds.push(resolved.versionId);
  }
  return { declared: true, versionIds, errors };
}
