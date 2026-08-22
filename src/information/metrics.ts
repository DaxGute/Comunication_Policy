/**
 * Deterministic information-flow metrics from known private-unit ownership
 * and agent-declared sourceInformationIds.
 */

import type { AgentId } from "../agents/types";
import type { ProblemConversation } from "../experiment/types";
import type { Problem } from "../problems/types";
import type { PropositionVersion, ReasoningEvent } from "../reasoning/types";
import type {
  InformationAssignment,
  InformationFlowMetrics,
} from "./types";

function citedIdsFromMutation(mutation: unknown): string[] {
  if (!mutation || typeof mutation !== "object") return [];
  const record = mutation as Record<string, unknown>;
  const raw =
    record.sourceInformationIds ??
    record.source_information_ids ??
    record.sourceInformationUnitIds;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

function citationsByAgent(
  events: ReasoningEvent[] | undefined,
): { agent_a: Set<string>; agent_b: Set<string> } {
  const out = {
    agent_a: new Set<string>(),
    agent_b: new Set<string>(),
  };
  for (const event of events ?? []) {
    if (!event.accepted) continue;
    if (event.actor !== "agent_a" && event.actor !== "agent_b") continue;
    for (const id of citedIdsFromMutation(event.mutation)) {
      out[event.actor].add(id);
    }
    for (const id of event.sourceInformationIds ?? []) {
      out[event.actor].add(id);
    }
  }
  return out;
}

function versionSourceIds(
  versions: PropositionVersion[] | undefined,
): Map<string, { agentId: AgentId; sources: string[] }> {
  const map = new Map<string, { agentId: AgentId; sources: string[] }>();
  for (const version of versions ?? []) {
    map.set(version.id, {
      agentId: version.agentId,
      sources: [...(version.sourceInformationIds ?? [])],
    });
  }
  return map;
}

/**
 * Walk derived_from edges to see whether a later agent used a version that
 * cited the other agent's private unit.
 */
function crossAgentTransfers(args: {
  assignment: InformationAssignment;
  versions: PropositionVersion[] | undefined;
}): { AtoB: Set<string>; BtoA: Set<string> } {
  const aPrivate = new Set(args.assignment.agentAOnlyUnitIds);
  const bPrivate = new Set(args.assignment.agentBOnlyUnitIds);
  const byId = versionSourceIds(args.versions);
  const AtoB = new Set<string>();
  const BtoA = new Set<string>();

  for (const version of args.versions ?? []) {
    const ownSources = version.sourceInformationIds ?? [];
    for (const id of ownSources) {
      if (version.agentId === "agent_b" && aPrivate.has(id)) AtoB.add(id);
      if (version.agentId === "agent_a" && bPrivate.has(id)) BtoA.add(id);
    }
    for (const parentId of version.derivedFromVersionIds ?? []) {
      const parent = byId.get(parentId);
      if (!parent) continue;
      for (const id of parent.sources) {
        if (version.agentId === "agent_b" && aPrivate.has(id)) AtoB.add(id);
        if (version.agentId === "agent_a" && bPrivate.has(id)) BtoA.add(id);
      }
    }
  }
  return { AtoB, BtoA };
}

function finalCitedSources(conversation: ProblemConversation): Set<string> {
  const out = new Set<string>();
  for (const id of conversation.finalSourceInformationIds ?? []) {
    out.add(id);
  }
  const basis = new Set(conversation.finalBasisVersionIds ?? []);
  for (const version of conversation.reasoningVersions ?? []) {
    if (!basis.has(version.id)) continue;
    for (const id of version.sourceInformationIds ?? []) out.add(id);
  }
  return out;
}

function firstRevealTurn(
  events: ReasoningEvent[] | undefined,
  agentId: AgentId,
  privateIds: readonly string[],
): number | null {
  const wanted = new Set(privateIds);
  if (wanted.size === 0) return null;
  let earliest: number | null = null;
  for (const event of events ?? []) {
    if (!event.accepted || event.actor !== agentId) continue;
    const cited = [
      ...citedIdsFromMutation(event.mutation),
      ...(event.sourceInformationIds ?? []),
    ];
    if (!cited.some((id) => wanted.has(id))) continue;
    const turn = event.turnIndex;
    if (typeof turn !== "number") continue;
    if (earliest === null || turn < earliest) earliest = turn;
  }
  return earliest;
}

function firstPartnerUptakeTurn(
  events: ReasoningEvent[] | undefined,
  versions: PropositionVersion[] | undefined,
  assignment: InformationAssignment,
): number | null {
  const aPrivate = new Set(assignment.agentAOnlyUnitIds);
  const bPrivate = new Set(assignment.agentBOnlyUnitIds);
  const byId = versionSourceIds(versions);
  let earliest: number | null = null;
  for (const event of events ?? []) {
    if (!event.accepted) continue;
    if (event.actor !== "agent_a" && event.actor !== "agent_b") continue;
    const versionId =
      event.versionId ??
      (event.mutation && typeof event.mutation === "object"
        ? (event.mutation as { afterVersionId?: string }).afterVersionId
        : undefined);
    const version = versionId ? byId.get(versionId) : undefined;
    const sources = new Set([
      ...citedIdsFromMutation(event.mutation),
      ...(event.sourceInformationIds ?? []),
      ...(version?.sources ?? []),
    ]);
    for (const parentId of version
      ? (versions ?? []).find((v) => v.id === versionId)?.derivedFromVersionIds ??
        []
      : []) {
      const parent = byId.get(parentId);
      if (!parent) continue;
      for (const id of parent.sources) sources.add(id);
    }
    const uptake =
      (event.actor === "agent_b" && [...sources].some((id) => aPrivate.has(id))) ||
      (event.actor === "agent_a" && [...sources].some((id) => bPrivate.has(id)));
    if (!uptake) continue;
    const turn = event.turnIndex;
    if (typeof turn !== "number") continue;
    if (earliest === null || turn < earliest) earliest = turn;
  }
  return earliest;
}

function crossAgentRevisionCount(
  events: ReasoningEvent[] | undefined,
  versions: PropositionVersion[] | undefined,
): number {
  const ownerBySubject = new Map<string, AgentId>();
  for (const version of versions ?? []) {
    if (!ownerBySubject.has(version.subjectId)) {
      ownerBySubject.set(version.subjectId, version.agentId);
    }
  }
  let count = 0;
  for (const event of events ?? []) {
    if (!event.accepted) continue;
    if (event.actor !== "agent_a" && event.actor !== "agent_b") continue;
    const mutation = event.mutation;
    if (!mutation || typeof mutation !== "object") continue;
    const type = (mutation as { type?: string }).type;
    if (type !== "REVISE" && type !== "revise") continue;
    const subjectId = (mutation as { subjectId?: string }).subjectId;
    if (!subjectId) continue;
    const owner = ownerBySubject.get(subjectId);
    if (owner && owner !== event.actor) count += 1;
  }
  return count;
}

export function computeInformationFlowMetrics(
  conversation: ProblemConversation,
  problem?: Problem,
): InformationFlowMetrics | undefined {
  const assignment = conversation.informationAssignment;
  if (!assignment || assignment.totalUnits === 0) return undefined;

  const aPrivate = assignment.agentAOnlyUnitIds;
  const bPrivate = assignment.agentBOnlyUnitIds;
  const citations = citationsByAgent(conversation.reasoningEvents);
  const transfers = crossAgentTransfers({
    assignment,
    versions: conversation.reasoningVersions,
  });
  const finalSources = finalCitedSources(conversation);

  const communicatedA = aPrivate.filter((id) => citations.agent_a.has(id));
  const communicatedB = bPrivate.filter((id) => citations.agent_b.has(id));

  const persistedA = aPrivate.filter((id) =>
    (conversation.reasoningVersions ?? []).some(
      (version) =>
        version.agentId === "agent_a" &&
        (version.sourceInformationIds ?? []).includes(id),
    ),
  );
  const persistedB = bPrivate.filter((id) =>
    (conversation.reasoningVersions ?? []).some(
      (version) =>
        version.agentId === "agent_b" &&
        (version.sourceInformationIds ?? []).includes(id),
    ),
  );

  const allPrivate = [...aPrivate, ...bPrivate];
  const used = new Set([
    ...communicatedA,
    ...communicatedB,
    ...persistedA,
    ...persistedB,
    ...transfers.AtoB,
    ...transfers.BtoA,
  ]);
  const unused = allPrivate.filter((id) => !used.has(id));

  const privateSurviving = allPrivate.filter((id) => finalSources.has(id));
  const privateDenom = allPrivate.length;

  // Bypass: final answer cites private units that never entered shared graph
  // via an accepted mutation sourceInformationIds on any version.
  const graphCited = new Set<string>();
  for (const version of conversation.reasoningVersions ?? []) {
    for (const id of version.sourceInformationIds ?? []) graphCited.add(id);
  }
  let privateInfoBypass = false;
  for (const id of conversation.finalSourceInformationIds ?? []) {
    if (
      (aPrivate.includes(id) || bPrivate.includes(id)) &&
      !graphCited.has(id)
    ) {
      privateInfoBypass = true;
      break;
    }
  }

  const transferCount = transfers.AtoB.size + transfers.BtoA.size;
  const transferable = privateDenom;

  const decisiveIds =
    problem?.hiddenProfile?.evaluatorMetadata.decisiveInformationIds ?? [];
  const decisiveCoverage =
    decisiveIds.length === 0
      ? null
      : decisiveIds.filter((id) => finalSources.has(id) || graphCited.has(id))
          .length / decisiveIds.length;

  const finalCoverageA =
    aPrivate.length === 0
      ? 1
      : aPrivate.filter((id) => finalSources.has(id)).length / aPrivate.length;
  const finalCoverageB =
    bPrivate.length === 0
      ? 1
      : bPrivate.filter((id) => finalSources.has(id)).length / bPrivate.length;

  return {
    privateUnitsA: aPrivate.length,
    privateUnitsB: bPrivate.length,
    sharedUnits: assignment.sharedUnitIds.length,
    privateUnitsCommunicatedA: communicatedA.length,
    privateUnitsCommunicatedB: communicatedB.length,
    privateUnitsPersistedToGraphA: persistedA.length,
    privateUnitsPersistedToGraphB: persistedB.length,
    AInfoUsedByB: transfers.AtoB.size,
    BInfoUsedByA: transfers.BtoA.size,
    transferAtoB: transfers.AtoB.size,
    transferBtoA: transfers.BtoA.size,
    crossAgentPrivateInfoTransferRate:
      transferable > 0 ? transferCount / transferable : 0,
    privateInfoSurvivalToFinal:
      privateDenom > 0 ? privateSurviving.length / privateDenom : 0,
    unusedPrivateInfoCount: unused.length,
    distortedPrivateInfoCount: 0,
    privateInfoBypass,
    privateInformationCountA: aPrivate.length,
    privateInformationCountB: bPrivate.length,
    privateInformationRevealedA: communicatedA.length,
    privateInformationRevealedB: communicatedB.length,
    privateInformationWithheldA: aPrivate.length - communicatedA.length,
    privateInformationWithheldB: bPrivate.length - communicatedB.length,
    timeToRevealA: firstRevealTurn(
      conversation.reasoningEvents,
      "agent_a",
      aPrivate,
    ),
    timeToRevealB: firstRevealTurn(
      conversation.reasoningEvents,
      "agent_b",
      bPrivate,
    ),
    partnerPrivateInformationUsedA: transfers.BtoA.size,
    partnerPrivateInformationUsedB: transfers.AtoB.size,
    timeToPartnerUptake: firstPartnerUptakeTurn(
      conversation.reasoningEvents,
      conversation.reasoningVersions,
      assignment,
    ),
    crossAgentRevisionCount: crossAgentRevisionCount(
      conversation.reasoningEvents,
      conversation.reasoningVersions,
    ),
    AtoBInfluence: transfers.AtoB.size,
    BtoAInfluence: transfers.BtoA.size,
    finalCoverageOfAPrivateInformation: finalCoverageA,
    finalCoverageOfBPrivateInformation: finalCoverageB,
    decisiveInformationCoverage: decisiveCoverage,
  };
}

/** Whether a unit id is visible to the given agent under the assignment. */
export function unitVisibleToAgent(
  assignment: InformationAssignment,
  agentId: AgentId,
  unitId: string,
): boolean {
  const ids =
    agentId === "agent_a" ? assignment.agentAUnitIds : assignment.agentBUnitIds;
  return ids.includes(unitId);
}

/**
 * Per-unit information-flow timeline for researcher inspectability.
 * Does not invent ACCEPT/REJECT labels — only timestamps supported by events.
 */
export type PrivateInformationFlowRow = {
  unitId: string;
  initially: "A only" | "B only" | "shared";
  firstCommunicatedTurn: number | null;
  firstCommunicatedBy: AgentId | null;
  enteredGraphVersionId: string | null;
  firstUsedByPartnerTurn: number | null;
  usedInFinalAnswer: boolean;
};

export function buildPrivateInformationFlowTable(
  conversation: ProblemConversation,
): PrivateInformationFlowRow[] {
  const assignment = conversation.informationAssignment;
  if (!assignment) return [];

  const rows: PrivateInformationFlowRow[] = [];
  const catalog = [
    ...assignment.sharedUnitIds.map((id) => ({ id, initially: "shared" as const })),
    ...assignment.agentAOnlyUnitIds.map((id) => ({
      id,
      initially: "A only" as const,
    })),
    ...assignment.agentBOnlyUnitIds.map((id) => ({
      id,
      initially: "B only" as const,
    })),
  ];

  const finalSources = finalCitedSources(conversation);
  const versions = conversation.reasoningVersions ?? [];
  const events = conversation.reasoningEvents ?? [];

  for (const entry of catalog) {
    if (entry.initially === "shared") continue;
    let firstCommunicatedTurn: number | null = null;
    let firstCommunicatedBy: AgentId | null = null;
    let enteredGraphVersionId: string | null = null;
    let firstUsedByPartnerTurn: number | null = null;

    for (const event of events) {
      if (!event.accepted) continue;
      if (event.actor !== "agent_a" && event.actor !== "agent_b") continue;
      const cited = [
        ...citedIdsFromMutation(event.mutation),
        ...(event.sourceInformationIds ?? []),
      ];
      if (!cited.includes(entry.id)) continue;
      const turn = event.turnIndex;
      if (typeof turn !== "number") continue;
      const ownerOk =
        (entry.initially === "A only" && event.actor === "agent_a") ||
        (entry.initially === "B only" && event.actor === "agent_b");
      if (
        ownerOk &&
        (firstCommunicatedTurn === null || turn < firstCommunicatedTurn)
      ) {
        firstCommunicatedTurn = turn;
        firstCommunicatedBy = event.actor;
      }
      const partnerOk =
        (entry.initially === "A only" && event.actor === "agent_b") ||
        (entry.initially === "B only" && event.actor === "agent_a");
      if (
        partnerOk &&
        (firstUsedByPartnerTurn === null || turn < firstUsedByPartnerTurn)
      ) {
        firstUsedByPartnerTurn = turn;
      }
    }

    for (const version of versions) {
      if (!(version.sourceInformationIds ?? []).includes(entry.id)) continue;
      if (!enteredGraphVersionId) enteredGraphVersionId = version.id;
      const partnerOk =
        (entry.initially === "A only" && version.agentId === "agent_b") ||
        (entry.initially === "B only" && version.agentId === "agent_a");
      if (partnerOk && firstUsedByPartnerTurn === null) {
        firstUsedByPartnerTurn = version.createdAtTurn ?? null;
      }
    }

    rows.push({
      unitId: entry.id,
      initially: entry.initially,
      firstCommunicatedTurn,
      firstCommunicatedBy,
      enteredGraphVersionId,
      firstUsedByPartnerTurn,
      usedInFinalAnswer: finalSources.has(entry.id),
    });
  }

  return rows;
}
