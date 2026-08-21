/**
 * Agent-declared provenance: resolve `basis` refs and reconstruct
 * `derived_from` edges. Never infers edges from utterance text.
 */
import type {
  PropositionVersion,
  ProvenanceEdge,
  ReasoningGraph,
  ReasoningSubject,
} from "./types";
import { versionsForSubject } from "./types";

const VERSION_ID = /^pv-\d+$/i;
const ORDINAL_REF = /^(.+)@v(\d+)$/i;
const ID_REF = /^(.+)@(pv-\d+)$/i;

export function versionsInCreationOrder(
  versions: PropositionVersion[],
  subjectId: string,
): PropositionVersion[] {
  return versions
    .filter((version) => version.subjectId === subjectId)
    .sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
}

/**
 * Canonical public version id is `pv-N`.
 * Legacy `subject@vN` remains parseable for historical basis refs only.
 */
export function versionPublicRef(
  _graph: Pick<ReasoningGraph, "versions">,
  version: PropositionVersion,
): string {
  return version.id;
}

/** @deprecated Historical display form. Prefer {@link versionPublicRef} (`pv-N`). */
export function versionOrdinalRef(
  graph: Pick<ReasoningGraph, "versions">,
  version: PropositionVersion,
): string {
  const ordered = versionsInCreationOrder(graph.versions, version.subjectId);
  const ordinal = ordered.findIndex((item) => item.id === version.id) + 1;
  return ordinal > 0 ? `${version.subjectId}@v${ordinal}` : version.id;
}

export function parseBasisField(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string" && raw.trim()
      ? [raw]
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function resolveBasisRef(
  raw: string,
  versions: PropositionVersion[],
  _subjects: ReasoningSubject[] = [],
): { versionId?: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "malformed basis reference" };
  if (trimmed.toLowerCase().startsWith("private:")) {
    return {
      error: `basis "${trimmed}" names private evidence; only shared proposition versions may be cited`,
    };
  }

  const byId = new Map(versions.map((version) => [version.id, version]));

  if (VERSION_ID.test(trimmed)) {
    const version = byId.get(trimmed) ?? byId.get(trimmed.toLowerCase());
    if (!version) return { error: `nonexistent basis ${trimmed}` };
    return { versionId: version.id };
  }

  const idMatch = trimmed.match(ID_REF);
  if (idMatch) {
    const subjectId = idMatch[1]!.trim();
    const versionId = idMatch[2]!;
    const version = byId.get(versionId);
    if (!version) return { error: `nonexistent basis ${trimmed}` };
    if (version.subjectId !== subjectId) {
      return {
        error: `malformed basis ${trimmed}: ${versionId} belongs to ${version.subjectId}`,
      };
    }
    return { versionId: version.id };
  }

  const ordinalMatch = trimmed.match(ORDINAL_REF);
  if (ordinalMatch) {
    const subjectId = ordinalMatch[1]!.trim();
    const ordinal = Number(ordinalMatch[2]);
    if (!Number.isInteger(ordinal) || ordinal < 1) {
      return { error: `malformed basis ${trimmed}` };
    }
    const ordered = versionsInCreationOrder(versions, subjectId);
    const version = ordered[ordinal - 1];
    if (!version) return { error: `nonexistent basis ${trimmed}` };
    return { versionId: version.id };
  }

  return { error: `malformed basis ${trimmed}` };
}

export type BasisValidation = {
  versionIds: string[];
  errors: string[];
};

export function resolveAndValidateBasis(
  raw: string[] | undefined,
  versions: PropositionVersion[],
  options: {
    nextVersionId: string;
    turnIndex: number;
    subjects?: ReasoningSubject[];
  },
): BasisValidation {
  const refs = parseBasisField(raw);
  const versionIds: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref === options.nextVersionId || ref.toLowerCase() === options.nextVersionId) {
      errors.push(`self-reference ${ref}`);
      continue;
    }
    const resolved = resolveBasisRef(ref, versions, options.subjects ?? []);
    if (resolved.error || !resolved.versionId) {
      errors.push(resolved.error ?? `nonexistent basis ${ref}`);
      continue;
    }
    if (resolved.versionId === options.nextVersionId) {
      errors.push(`self-reference ${ref}`);
      continue;
    }
    const version = versions.find((item) => item.id === resolved.versionId);
    if (!version) {
      errors.push(`nonexistent basis ${ref}`);
      continue;
    }
    if (version.turn > options.turnIndex) {
      errors.push(`future basis ${ref}`);
      continue;
    }
    if (seen.has(version.id)) continue;
    seen.add(version.id);
    versionIds.push(version.id);
  }
  return { versionIds, errors };
}

export function derivedFromEdges(
  graph: Pick<ReasoningGraph, "versions">,
): ProvenanceEdge[] {
  const edges: ProvenanceEdge[] = [];
  for (const version of graph.versions) {
    for (const from of version.derivedFromVersionIds ?? []) {
      edges.push({ from, to: version.id, kind: "derived_from" });
    }
  }
  return edges;
}

export function revisesEdges(
  graph: Pick<ReasoningGraph, "versions">,
): ProvenanceEdge[] {
  const edges: ProvenanceEdge[] = [];
  for (const version of graph.versions) {
    if (!version.previousVersionId) continue;
    edges.push({
      from: version.previousVersionId,
      to: version.id,
      kind: "revises",
    });
  }
  return edges;
}

export function provenanceEdges(
  graph: Pick<ReasoningGraph, "versions">,
): ProvenanceEdge[] {
  return [...revisesEdges(graph), ...derivedFromEdges(graph)];
}

export function usedByVersionIds(
  graph: Pick<ReasoningGraph, "versions">,
  versionId: string,
): string[] {
  return graph.versions
    .filter((version) => version.derivedFromVersionIds?.includes(versionId))
    .map((version) => version.id);
}

export function derivedFromCycleIds(graph: Pick<ReasoningGraph, "versions">): string[] {
  const edges = new Map<string, string[]>();
  for (const edge of derivedFromEdges(graph)) {
    const list = edges.get(edge.from) ?? [];
    list.push(edge.to);
    edges.set(edge.from, list);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic: string[] = [];
  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      cyclic.push(id);
      return true;
    }
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const version of graph.versions) visit(version.id);
  return [...new Set(cyclic)];
}

export function nextRevision(
  graph: Pick<ReasoningGraph, "versions">,
  version: PropositionVersion,
): PropositionVersion | undefined {
  return versionsForSubject(graph, version.subjectId).find(
    (item) => item.previousVersionId === version.id,
  );
}
