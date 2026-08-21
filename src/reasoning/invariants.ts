/**
 * Graph invariants for committed reasoning state.
 * Instrumentation, not runtime rejection.
 */
import { materializeGraph } from "./graph";
import { derivedFromCycleIds } from "./provenance";
import { activeVersion, isStateChangeMutation, type ReasoningGraph } from "./types";

export type GraphInvariantCode =
  | "competing_live_values"
  | "revision_missing_ancestry"
  | "revision_chain_broken"
  | "duplicate_version_ids"
  | "basis_target_missing"
  | "derived_from_cycle"
  | "future_basis_reference"
  | "replay_mismatch"
  | "duplicate_active_idea";

export type GraphInvariantViolation = {
  code: GraphInvariantCode;
  detail: string;
  nodeIds?: string[];
  turnIndex?: number;
  subjectId?: string;
};

export function ideasCreatedPerTurn(graph: ReasoningGraph): number[] {
  const byTurn = new Map<number, number>();
  for (const event of graph.events) {
    if (!event.accepted || event.stateChanged === false) continue;
    if (event.mutation.type !== "SET") continue;
    byTurn.set(event.turnIndex, (byTurn.get(event.turnIndex) ?? 0) + 1);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, count]) => count);
}

export function maxIdeasCreatedOnOneSubjectInOneTurn(
  graph: ReasoningGraph,
): number {
  const counts = new Map<string, number>();
  for (const event of graph.events) {
    if (!event.accepted || event.stateChanged === false) continue;
    if (event.mutation.type !== "SET") continue;
    const key = `${event.turnIndex}::${event.mutation.subjectId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts.size === 0 ? 0 : Math.max(...counts.values());
}

export function checkGraphInvariants(graph: ReasoningGraph): GraphInvariantViolation[] {
  const violations: GraphInvariantViolation[] = [];
  const byId = new Map<string, number>();
  for (const version of graph.versions) {
    byId.set(version.id, (byId.get(version.id) ?? 0) + 1);
  }
  for (const [id, count] of byId) {
    if (count > 1) {
      violations.push({
        code: "duplicate_version_ids",
        detail: `${id} appears ${count} times`,
        nodeIds: [id],
      });
    }
  }

  for (const subject of graph.subjects) {
    const active = graph.versions.filter(
      (version) => version.subjectId === subject.id && version.status === "active",
    );
    if (active.length > 1) {
      violations.push({
        code: "competing_live_values",
        detail: `${subject.id} has ${active.length} active versions`,
        subjectId: subject.id,
        nodeIds: active.map((version) => version.id),
      });
    }
  }

  const versions = new Map(graph.versions.map((version) => [version.id, version]));
  for (const event of graph.events) {
    if (!event.accepted || !isStateChangeMutation(event.mutation)) continue;
    if (event.mutation.type === "REVISE" && !event.previousVersionId) {
      violations.push({
        code: "revision_missing_ancestry",
        detail: `REVISE of ${event.mutation.subjectId} is missing previousVersionId`,
        turnIndex: event.turnIndex,
        subjectId: event.mutation.subjectId,
      });
    }
  }

  for (const version of graph.versions) {
    if (version.previousVersionId && !versions.has(version.previousVersionId)) {
      violations.push({
        code: "revision_chain_broken",
        detail: `${version.id} revises missing ${version.previousVersionId}`,
        nodeIds: [version.id, version.previousVersionId],
        subjectId: version.subjectId,
      });
    }
    for (const sourceId of version.derivedFromVersionIds ?? []) {
      const source = versions.get(sourceId);
      if (!source) {
        violations.push({
          code: "basis_target_missing",
          detail: `${version.id} derived_from missing ${sourceId}`,
          nodeIds: [version.id, sourceId],
          subjectId: version.subjectId,
        });
        continue;
      }
      if (source.turn > version.turn) {
        violations.push({
          code: "future_basis_reference",
          detail: `${version.id} derived_from future ${sourceId}`,
          nodeIds: [version.id, sourceId],
          turnIndex: version.turn,
        });
      }
    }
    if (version.status !== "active") continue;
    const current = activeVersion(graph, version.subjectId);
    if (current && current.id !== version.id) {
      violations.push({
        code: "duplicate_active_idea",
        detail: `${version.subjectId} has multiple live pointers`,
        subjectId: version.subjectId,
        nodeIds: [version.id, current.id],
      });
    }
  }

  const cyclic = derivedFromCycleIds(graph);
  if (cyclic.length > 0) {
    violations.push({
      code: "derived_from_cycle",
      detail: `derived_from cycle involving ${cyclic.join(", ")}`,
      nodeIds: cyclic,
    });
  }

  const accepted = graph.events.some(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation),
  );
  if (accepted) {
    const replayed = materializeGraph(
      graph.events,
      graph.subjects.filter((subject) => subject.source === "task"),
    );
    const fingerprint = (version: (typeof graph.versions)[number]) =>
      [
        version.id,
        version.subjectId,
        version.content,
        version.status,
        version.previousVersionId ?? "",
        ...(version.derivedFromVersionIds ?? []),
      ].join("|");
    const live = graph.versions.map(fingerprint).sort().join("\n");
    const replay = replayed.versions.map(fingerprint).sort().join("\n");
    if (live !== replay) {
      violations.push({
        code: "replay_mismatch",
        detail: "event replay != hydrated state",
      });
    }
  }

  return violations;
}
