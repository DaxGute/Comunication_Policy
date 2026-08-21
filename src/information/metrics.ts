/**
 * Deterministic information-flow metrics from known private-unit ownership
 * and agent-declared sourceInformationIds.
 */

import type { AgentId } from "../agents/types";
import type { ProblemConversation } from "../experiment/types";
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

export function computeInformationFlowMetrics(
  conversation: ProblemConversation,
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
