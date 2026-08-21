/**
 * Deterministic metrics derived from canonical graph history.
 * Evaluators may sit above this; they must never rewrite canonical state.
 */
import { isStateChangeMutation, type ReasoningGraph } from "./types";

export type CanonicalReasoningMetrics = {
  introductionCount: number;
  revisionCount: number;
  removalCount: number;
  revisionRate: number;
  introductionsByAgent: { agent_a: number; agent_b: number };
  revisionsByAgent: { agent_a: number; agent_b: number };
  removalsByAgent: { agent_a: number; agent_b: number };
  agentOwnershipCurrent: { agent_a: number; agent_b: number };
  agentOwnershipFinal: { agent_a: number; agent_b: number };
  liveOwnershipA: number;
  liveOwnershipB: number;
  crossAgentRevisionCount: number;
  partnerOverwriteRate: number;
  partnerOverwriteAtoB: number;
  partnerOverwriteBtoA: number;
  directionalInfluenceAB: number;
  directionalInfluenceBA: number;
  crossAgentDerivedFromAtoB: number;
  crossAgentDerivedFromBtoA: number;
  selfDerivedFrom: number;
  crossAgentBasisRate: number;
  meanBasisCount: number;
  multiSourceDerivationRate: number;
  commitsWithBasis: number;
  commitsWithoutBasis: number;
  basisCoverageRate: number;
  crossAgentBasisCount: number;
  sameAgentBasisCount: number;
  revisionDepth: number;
  subjectPersistenceTurns: number | null;
  finalOwnership: { agent_a: number; agent_b: number };
  finalCrossAgentInfluence: { ab: number; ba: number };
  meanTurnsUntilRevision: number | null;
};

function zeroAgents(): { agent_a: number; agent_b: number } {
  return { agent_a: 0, agent_b: 0 };
}

function ownerCounts(graph: ReasoningGraph): { agent_a: number; agent_b: number } {
  const counts = zeroAgents();
  for (const version of graph.versions) {
    if (version.status !== "active") continue;
    counts[version.agentId] += 1;
  }
  return counts;
}

export function computeCanonicalReasoningMetrics(
  graph: ReasoningGraph,
): CanonicalReasoningMetrics {
  const accepted = graph.events.filter(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation),
  );
  const introductionsByAgent = zeroAgents();
  const revisionsByAgent = zeroAgents();
  const removalsByAgent = zeroAgents();
  let introductions = 0;
  let revisions = 0;
  let removals = 0;
  let crossAgent = 0;
  let overwriteAB = 0;
  let overwriteBA = 0;
  const firstTurn = new Map<string, number>();
  const revisionDelays: number[] = [];
  const lastOwner = new Map<string, "agent_a" | "agent_b">();
  const chainLength = new Map<string, number>();
  let lastTurn = 0;

  for (const event of accepted) {
    lastTurn = Math.max(lastTurn, event.turnIndex);
    const mutation = event.mutation;
    const actor = event.actor === "agent_a" || event.actor === "agent_b" ? event.actor : undefined;
    if (mutation.type === "SET") {
      introductions += 1;
      if (actor) introductionsByAgent[actor] += 1;
      firstTurn.set(mutation.subjectId, event.turnIndex);
      chainLength.set(mutation.subjectId, 1);
      if (actor) lastOwner.set(mutation.subjectId, actor);
    } else if (mutation.type === "REVISE") {
      revisions += 1;
      if (actor) revisionsByAgent[actor] += 1;
      chainLength.set(
        mutation.subjectId,
        (chainLength.get(mutation.subjectId) ?? 1) + 1,
      );
      const prior = lastOwner.get(mutation.subjectId);
      if (prior && actor && prior !== actor) {
        crossAgent += 1;
        if (prior === "agent_a") overwriteAB += 1;
        else overwriteBA += 1;
      }
      const introduced = firstTurn.get(mutation.subjectId);
      if (introduced !== undefined) {
        revisionDelays.push(event.turnIndex - introduced);
      }
      if (actor) lastOwner.set(mutation.subjectId, actor);
    } else if (mutation.type === "REMOVE") {
      removals += 1;
      if (actor) removalsByAgent[actor] += 1;
    }
  }

  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  let derivedAB = 0;
  let derivedBA = 0;
  let selfDerived = 0;
  let commitsWithBasis = 0;
  let commitsWithoutBasis = 0;
  let basisTotal = 0;
  let multiSource = 0;
  let crossAgentBasisCount = 0;
  let sameAgentBasisCount = 0;
  const commitVersions = graph.versions.filter(
    (version) => version.status === "active" || version.status === "superseded" || version.status === "removed",
  );

  for (const version of commitVersions) {
    const basis = version.derivedFromVersionIds ?? [];
    if (basis.length === 0) {
      commitsWithoutBasis += 1;
      continue;
    }
    commitsWithBasis += 1;
    basisTotal += basis.length;
    if (basis.length > 1) multiSource += 1;
    for (const sourceId of basis) {
      const source = byId.get(sourceId);
      if (!source) continue;
      if (source.agentId === version.agentId) {
        selfDerived += 1;
        sameAgentBasisCount += 1;
      } else if (source.agentId === "agent_a" && version.agentId === "agent_b") {
        derivedAB += 1;
        crossAgentBasisCount += 1;
      } else if (source.agentId === "agent_b" && version.agentId === "agent_a") {
        derivedBA += 1;
        crossAgentBasisCount += 1;
      }
    }
  }

  const stateChanges = introductions + revisions + removals;
  const provenanceCommits = commitsWithBasis + commitsWithoutBasis;
  const ownership = ownerCounts(graph);
  const persistence =
    firstTurn.size === 0 || lastTurn === 0
      ? null
      : [...firstTurn.values()].reduce((sum, turn) => sum + (lastTurn - turn + 1), 0) /
        firstTurn.size;
  const revisionDepth =
    chainLength.size === 0
      ? 0
      : [...chainLength.values()].reduce((sum, n) => sum + n, 0) / chainLength.size;

  return {
    introductionCount: introductions,
    revisionCount: revisions,
    removalCount: removals,
    revisionRate: stateChanges > 0 ? revisions / stateChanges : 0,
    introductionsByAgent,
    revisionsByAgent,
    removalsByAgent,
    agentOwnershipCurrent: ownership,
    agentOwnershipFinal: ownership,
    liveOwnershipA: ownership.agent_a,
    liveOwnershipB: ownership.agent_b,
    crossAgentRevisionCount: crossAgent,
    partnerOverwriteRate: revisions > 0 ? crossAgent / revisions : 0,
    partnerOverwriteAtoB: overwriteAB,
    partnerOverwriteBtoA: overwriteBA,
    directionalInfluenceAB: derivedAB,
    directionalInfluenceBA: derivedBA,
    crossAgentDerivedFromAtoB: derivedAB,
    crossAgentDerivedFromBtoA: derivedBA,
    selfDerivedFrom: selfDerived,
    crossAgentBasisRate:
      crossAgentBasisCount + sameAgentBasisCount > 0
        ? crossAgentBasisCount / (crossAgentBasisCount + sameAgentBasisCount)
        : 0,
    meanBasisCount: commitsWithBasis > 0 ? basisTotal / commitsWithBasis : 0,
    multiSourceDerivationRate:
      provenanceCommits > 0 ? multiSource / provenanceCommits : 0,
    commitsWithBasis,
    commitsWithoutBasis,
    basisCoverageRate: provenanceCommits > 0 ? commitsWithBasis / provenanceCommits : 0,
    crossAgentBasisCount,
    sameAgentBasisCount,
    revisionDepth,
    subjectPersistenceTurns: persistence,
    finalOwnership: ownership,
    finalCrossAgentInfluence: { ab: derivedAB, ba: derivedBA },
    meanTurnsUntilRevision:
      revisionDelays.length > 0
        ? revisionDelays.reduce((sum, n) => sum + n, 0) / revisionDelays.length
        : null,
  };
}
