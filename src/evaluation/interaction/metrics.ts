/**
 * Universal behavioral metrics. Task-independent reductions over events + graph.
 */
import type { ConversationMessage } from "../../experiment/types";
import {
  agentTokens,
  sharePair,
} from "../belief/metricsShared";
import {
  agentObjects,
  branchingFactor,
  descendantsOf,
  edgesOf,
  eventChangedState,
  isAgent,
  maxGraphDepth,
  meanGraphDepth,
  parentIdsOf,
  partnerOriginated,
  type InteractionGraphView,
} from "./objects";
import { directionalOpportunity, opportunity } from "./rates";
import type {
  AdoptionMetrics,
  AgentCounts,
  ChallengeMetrics,
  ContributionMetrics,
  CorrectionMetrics,
  DevelopmentMetrics,
  DisagreementMetrics,
  EfficiencyMetrics,
  InfluenceMetrics,
  InteractionAgentId,
  InteractionEvent,
  InteractionFamilies,
  ReasoningObject,
  VerificationMetrics,
} from "./types";

export type DisagreementRecord = {
  objectId: string;
  introducer: InteractionAgentId;
  challenger: InteractionAgentId;
  resolution: "acceptance" | "rejection" | "revision" | "synthesis" | "unresolved";
  winner: InteractionAgentId | "synthesis" | null;
};

function zero(): AgentCounts {
  return { agent_a: 0, agent_b: 0 };
}

function ofType(
  events: InteractionEvent[],
  type: InteractionEvent["type"],
): InteractionEvent[] {
  return events.filter((event) => event.type === type);
}

function uniqueCanonical(objects: ReasoningObject[]): ReasoningObject[] {
  const seen = new Set<string>();
  const out: ReasoningObject[] = [];
  for (const object of objects) {
    if (object.originatingAgent === "system") continue;
    if (seen.has(object.canonicalId)) continue;
    seen.add(object.canonicalId);
    out.push(object);
  }
  return out;
}

export function buildDisagreements(
  view: InteractionGraphView,
  events: InteractionEvent[],
): DisagreementRecord[] {
  const out: DisagreementRecord[] = [];
  const seen = new Set<string>();
  for (const challenge of ofType(events, "challenged")) {
    if (!challenge.objectId || !isAgent(challenge.actor)) continue;
    const object = view.byId.get(challenge.objectId);
    if (!object || !isAgent(object.originatingAgent)) continue;
    if (object.originatingAgent === challenge.actor) continue;
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    const later = events.filter(
      (event) => event.turn >= challenge.turn && event.objectId === object.id,
    );
    const synth = events.some(
      (event) =>
        event.type === "synthesized" &&
        (event.relatedObjectIds ?? []).includes(object.id),
    );
    const abandoned = later.some(
      (event) =>
        event.actor === object.originatingAgent &&
        (event.type === "withdrawn" ||
          event.type === "rejected" ||
          event.type === "conceded"),
    );
    const revised = later.some(
      (event) =>
        event.actor === object.originatingAgent && event.type === "revised",
    );
    const hasFinalAnswer = Boolean(view.graph.finalAnswer);
    const challengerAdopted = later.some(
      (event) => event.actor === challenge.actor && event.type === "adopted",
    );
    let resolution: DisagreementRecord["resolution"] = "unresolved";
    let winner: DisagreementRecord["winner"] = null;
    if (synth) {
      resolution = "synthesis";
      winner = "synthesis";
    } else if (abandoned) {
      resolution = "rejection";
      winner = challenge.actor;
    } else if (revised) {
      resolution = "revision";
      winner = challenge.actor;
    } else if (challengerAdopted) {
      resolution = "acceptance";
      winner = object.originatingAgent;
    } else if (hasFinalAnswer && object.inFinalPosition) {
      resolution = "acceptance";
      winner = object.originatingAgent;
    } else if (object.status === "rejected" || object.status === "superseded") {
      resolution = "rejection";
      winner = challenge.actor;
    }
    out.push({
      objectId: object.id,
      introducer: object.originatingAgent,
      challenger: challenge.actor,
      resolution,
      winner,
    });
  }
  return out;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number(
    (values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(4),
  );
}

export function computeInteractionMetrics(options: {
  view: InteractionGraphView;
  events: InteractionEvent[];
  messages: ConversationMessage[];
}): InteractionFamilies {
  const { view, events, messages } = options;
  const objects = view.objects.filter((o) => o.originatingAgent !== "system");
  const unique = uniqueCanonical(objects);
  const disagreements = buildDisagreements(view, events);
  const turns = Math.max(
    messages.length,
    ...messages.map((m) => m.turnIndex),
    0,
  );
  const contributions = contributionMetrics(objects, unique);
  const adoption = adoptionMetrics(objects, events);
  const verification = verificationMetrics(events);
  const challenges = challengeMetrics(objects, events, disagreements);
  const corrections = correctionMetrics(events, disagreements);
  const disagreement = disagreementMetrics(objects, events, disagreements);
  const influence = influenceMetrics(view, objects, events, disagreements);
  const efficiency = efficiencyMetrics(view, events, messages, turns, unique.length);
  const reasoningDevelopment = developmentMetrics(
    view,
    objects,
    events,
    turns,
  );
  return {
    contributions,
    adoption,
    verification,
    challenges,
    corrections,
    disagreement,
    influence,
    efficiency,
    reasoningDevelopment,
  };
}

function contributionMetrics(
  objects: ReasoningObject[],
  unique: ReasoningObject[],
): ContributionMetrics {
  const introduced = zero();
  const novel = zero();
  const support = zero();
  for (const object of objects) {
    if (!isAgent(object.originatingAgent)) continue;
    introduced[object.originatingAgent] += 1;
    if (
      object.kind === "evidence" ||
      object.kind === "axiom" ||
      object.kind === "assumption"
    ) {
      support[object.originatingAgent] += 1;
    }
  }
  for (const object of unique) {
    if (isAgent(object.originatingAgent)) novel[object.originatingAgent] += 1;
  }
  const origin = sharePair(introduced.agent_a, introduced.agent_b);
  const survA = objects.filter(
    (o) => o.originatingAgent === "agent_a" && o.inFinalPosition,
  ).length;
  const survB = objects.filter(
    (o) => o.originatingAgent === "agent_b" && o.inFinalPosition,
  ).length;
  const surviving = sharePair(survA, survB);
  let dominant: InteractionAgentId | null = null;
  if (introduced.agent_a > introduced.agent_b) dominant = "agent_a";
  if (introduced.agent_b > introduced.agent_a) dominant = "agent_b";
  return {
    introducedByAgent: introduced,
    novelByAgent: novel,
    supportIntroducedByAgent: support,
    originShare: {
      agent_aShare: origin.agent_aShare,
      agent_bShare: origin.agent_bShare,
    },
    survivingShare: {
      agent_aShare: surviving.agent_aShare,
      agent_bShare: surviving.agent_bShare,
      herfindahl: surviving.herfindahl,
    },
    ancestryShare: {
      agent_aShare: surviving.agent_aShare,
      agent_bShare: surviving.agent_bShare,
    },
    contributionConcentration: {
      herfindahl: origin.herfindahl,
      dominantAgent: dominant,
    },
  };
}

function adoptionBy(
  events: InteractionEvent[],
  actor: InteractionAgentId,
): InteractionEvent[] {
  return ofType(events, "adopted").filter((e) => e.actor === actor);
}

function adoptionMetrics(
  objects: ReasoningObject[],
  events: InteractionEvent[],
): AdoptionMetrics {
  // Adoption is not a canonical graph fact. These rates stay at zero unless a
  // separate inferred overlay emits `adopted` / `unsupported_adoption`.
  const oppsA = partnerOriginated(objects, "agent_a").length;
  const oppsB = partnerOriginated(objects, "agent_b").length;
  const a = adoptionBy(events, "agent_a");
  const b = adoptionBy(events, "agent_b");
  const unsupported = (actor: InteractionAgentId) =>
    ofType(events, "unsupported_adoption").filter((e) => e.actor === actor);
  const independent = (actor: InteractionAgentId) =>
    ofType(events, "independently_derived").filter((e) => e.actor === actor);
  const challengedBefore = (actor: InteractionAgentId, adopted: InteractionEvent[]) =>
    adopted.filter((event) =>
      events.some(
        (item) =>
          item.actor === actor &&
          item.objectId === event.objectId &&
          item.turn <= event.turn &&
          item.type === "challenged",
      ),
    ).length;
  const latencies: number[] = [];
  for (const event of ofType(events, "adopted")) {
    if (!event.objectId) continue;
    const object = objects.find((item) => item.id === event.objectId);
    if (object) latencies.push(Math.max(0, event.turn - object.firstTurn));
  }
  return {
    adoption: directionalOpportunity(a.length, oppsA, b.length, oppsB),
    latencyTurns: { mean: mean(latencies), samples: latencies.length },
    supportedAdoption: directionalOpportunity(
      a.length - unsupported("agent_a").length,
      a.length,
      b.length - unsupported("agent_b").length,
      b.length,
    ),
    unsupportedAdoption: directionalOpportunity(
      unsupported("agent_a").length,
      a.length,
      unsupported("agent_b").length,
      b.length,
    ),
    challengeBeforeAdoption: directionalOpportunity(
      challengedBefore("agent_a", a),
      a.length,
      challengedBefore("agent_b", b),
      b.length,
    ),
    independentDerivationBeforeAdoption: directionalOpportunity(
      independent("agent_a").length,
      a.length,
      independent("agent_b").length,
      b.length,
    ),
  };
}

function verificationMetrics(
  events: InteractionEvent[],
): VerificationMetrics {
  const a = adoptionBy(events, "agent_a");
  const b = adoptionBy(events, "agent_b");
  const verified = (actor: InteractionAgentId) =>
    ofType(events, "verified").filter((e) => e.actor === actor);
  const before = (actor: InteractionAgentId) =>
    adoptionBy(events, actor).filter((adopt) =>
      events.some(
        (item) =>
          item.actor === actor &&
          item.objectId === adopt.objectId &&
          item.turn <= adopt.turn &&
          (item.type === "verified" || item.type === "independently_derived"),
      ),
    ).length;
  const after = (actor: InteractionAgentId) =>
    adoptionBy(events, actor).filter((adopt) =>
      events.some(
        (item) =>
          item.actor === actor &&
          item.objectId === adopt.objectId &&
          item.turn > adopt.turn &&
          (item.type === "verified" || item.type === "independently_derived"),
      ),
    ).length;
    const unsupported = (actor: InteractionAgentId) =>
    ofType(events, "unsupported_adoption").filter((e) => e.actor === actor);
  return {
    independentVerification: directionalOpportunity(
      verified("agent_a").length,
      a.length,
      verified("agent_b").length,
      b.length,
    ),
    verificationBeforeAcceptance: directionalOpportunity(
      before("agent_a"),
      a.length,
      before("agent_b"),
      b.length,
    ),
    verificationAfterAcceptance: directionalOpportunity(
      after("agent_a"),
      a.length,
      after("agent_b"),
      b.length,
    ),
    unsupportedAcceptance: directionalOpportunity(
      unsupported("agent_a").length,
      a.length,
      unsupported("agent_b").length,
      b.length,
    ),
  };
}

function challengeMetrics(
  objects: ReasoningObject[],
  events: InteractionEvent[],
  disagreements: DisagreementRecord[],
): ChallengeMetrics {
  const challenges = ofType(events, "challenged");
  const toward = (target: InteractionAgentId) =>
    challenges.filter((e) => e.targetAgent === target).length;
  const successful = disagreements.filter(
    (d) => d.resolution === "rejection" || d.resolution === "revision",
  ).length;
  const unsuccessful = disagreements.filter(
    (d) => d.resolution === "acceptance" || d.resolution === "unresolved",
  ).length;
  const revised = ofType(events, "revised").filter((event) =>
    events.some(
      (item) =>
        item.type === "challenged" &&
        item.objectId === event.relatedObjectIds?.[0] &&
        item.turn <= event.turn,
    ),
  ).length;
  const corrected = ofType(events, "corrected").filter((event) =>
    events.some(
      (item) =>
        item.type === "challenged" &&
        item.objectId === event.objectId &&
        item.turn <= event.turn,
    ),
  ).length;
  return {
    frequency: opportunity(challenges.length, objects.length),
    directional: directionalOpportunity(
      toward("agent_b"),
      partnerOriginated(objects, "agent_a").length,
      toward("agent_a"),
      partnerOriginated(objects, "agent_b").length,
    ),
    successful: opportunity(successful, disagreements.length),
    unsuccessful: opportunity(unsuccessful, disagreements.length),
    revisionAfterChallenge: opportunity(revised, disagreements.length),
    correctionAfterChallenge: opportunity(corrected, disagreements.length),
  };
}

function correctionMetrics(
  events: InteractionEvent[],
  disagreements: DisagreementRecord[],
): CorrectionMetrics {
  const corrected = ofType(events, "corrected");
  const self = corrected.filter((event) => {
    const challenge = events.find(
      (item) =>
        item.type === "challenged" && item.objectId === event.objectId,
    );
    return !challenge || challenge.targetAgent === event.actor;
  });
  const cross = corrected.filter((event) => !self.includes(event));
  return {
    corrected: opportunity(corrected.length, disagreements.length),
    selfCorrection: opportunity(self.length, disagreements.length),
    crossAgentCorrection: opportunity(cross.length, disagreements.length),
    correctionAcceptance: opportunity(
      ofType(events, "adopted").filter((event) =>
        corrected.some((c) => c.objectId === event.objectId),
      ).length,
      corrected.length,
    ),
    correctionRejection: opportunity(0, corrected.length),
    latencyTurns: { mean: null, samples: 0 },
  };
}

function disagreementMetrics(
  objects: ReasoningObject[],
  events: InteractionEvent[],
  disagreements: DisagreementRecord[],
): DisagreementMetrics {
  const concessions = ofType(events, "conceded");
  const partnerObjects =
    partnerOriginated(objects, "agent_a").length +
    partnerOriginated(objects, "agent_b").length;
  return {
    disagreements: opportunity(disagreements.length, partnerObjects),
    resolved: opportunity(
      disagreements.filter((d) => d.resolution !== "unresolved").length,
      disagreements.length,
    ),
    unresolved: opportunity(
      disagreements.filter((d) => d.resolution === "unresolved").length,
      disagreements.length,
    ),
    concession: directionalOpportunity(
      concessions.filter((e) => e.actor === "agent_a").length,
      disagreements.length,
      concessions.filter((e) => e.actor === "agent_b").length,
      disagreements.length,
    ),
    revision: opportunity(
      disagreements.filter((d) => d.resolution === "revision").length,
      disagreements.length,
    ),
    rejection: opportunity(
      disagreements.filter((d) => d.resolution === "rejection").length,
      disagreements.length,
    ),
    synthesis: opportunity(
      disagreements.filter((d) => d.resolution === "synthesis").length,
      disagreements.length,
    ),
    survivor: {
      agent_a: disagreements.filter((d) => d.winner === "agent_a").length,
      agent_b: disagreements.filter((d) => d.winner === "agent_b").length,
      synthesis: disagreements.filter((d) => d.winner === "synthesis").length,
      unresolved: disagreements.filter((d) => d.winner === null || d.resolution === "unresolved").length,
    },
  };
}

function influenceMetrics(
  view: InteractionGraphView,
  objects: ReasoningObject[],
  events: InteractionEvent[],
  disagreements: DisagreementRecord[],
): InfluenceMetrics {
  const edges = edgesOf(view.graph);
  const downstream = zero();
  const centrality = zero();
  for (const object of objects) {
    if (!isAgent(object.originatingAgent)) continue;
    const desc = descendantsOf(object.id, edges);
    downstream[object.originatingAgent] += desc.size;
    centrality[object.originatingAgent] += desc.size;
  }
  const proposals = objects.filter(
    (o) => o.kind === "proposal" || o.kind === "claim",
  );
  const surv = (agent: InteractionAgentId) => {
    const pool = agentObjects(proposals, agent);
    return {
      n: pool.filter((o) => o.inFinalPosition).length,
      d: pool.length,
    };
  };
  const a = surv("agent_a");
  const b = surv("agent_b");
  const scored = disagreements.filter(
    (d) => d.winner === "agent_a" || d.winner === "agent_b",
  );
  const aWins = scored.filter((d) => d.winner === "agent_a").length;
  const bWins = scored.filter((d) => d.winner === "agent_b").length;
  const finalA = objects.filter(
    (o) => o.originatingAgent === "agent_a" && o.inFinalPosition,
  ).length;
  const finalB = objects.filter(
    (o) => o.originatingAgent === "agent_b" && o.inFinalPosition,
  ).length;
  const share = sharePair(finalA, finalB);
  let dominant: InteractionAgentId | null = null;
  if (finalA > finalB) dominant = "agent_a";
  if (finalB > finalA) dominant = "agent_b";
  const concessions = ofType(events, "conceded");
  return {
    downstreamDependencies: downstream,
    centrality,
    proposalSurvival: directionalOpportunity(a.n, a.d, b.n, b.d),
    disagreementSurvival: directionalOpportunity(
      aWins,
      scored.length,
      bWins,
      scored.length,
    ),
    concessionDirection: directionalOpportunity(
      concessions.filter((e) => e.actor === "agent_a").length,
      disagreements.length,
      concessions.filter((e) => e.actor === "agent_b").length,
      disagreements.length,
    ),
    finalAncestry: {
      agent_aShare: share.agent_aShare,
      agent_bShare: share.agent_bShare,
      herfindahl: share.herfindahl,
      dominantAgent: dominant,
    },
  };
}

function efficiencyMetrics(
  view: InteractionGraphView,
  events: InteractionEvent[],
  messages: ConversationMessage[],
  turns: number,
  uniqueCount: number,
): EfficiencyMetrics {
  const mutationTurns = new Set<number>();
  let mutations = 0;
  for (const event of view.graph.events) {
    if (event.turnIndex <= 0) continue;
    if (!eventChangedState(event)) continue;
    mutationTurns.add(event.turnIndex);
    mutations += 1;
  }
  const productive = events.filter(
    (e) =>
      e.type !== "repeated" &&
      e.type !== "requested_clarification" &&
      e.source !== "transcript",
  ).length;
  const tokensA = agentTokens(messages, "agent_a");
  const tokensB = agentTokens(messages, "agent_b");
  const tokenTotal =
    tokensA === null && tokensB === null ? null : (tokensA ?? 0) + (tokensB ?? 0);
  const surviving = view.objects.filter((o) => o.inFinalPosition).length;
  return {
    turns,
    tokensPerAgent: { agent_a: tokensA, agent_b: tokensB },
    uniqueObjectsPerTurn:
      turns <= 0 ? null : Number((uniqueCount / turns).toFixed(4)),
    graphMutationsPerTurn:
      turns <= 0 ? null : Number((mutations / turns).toFixed(4)),
    productiveEventsPerTurn:
      turns <= 0 ? null : Number((productive / turns).toFixed(4)),
    repetition: opportunity(ofType(events, "repeated").length, turns),
    zeroMutationTurns: Math.max(0, turns - mutationTurns.size),
    survivingPerToken:
      tokenTotal && tokenTotal > 0
        ? Number((surviving / tokenTotal).toFixed(6))
        : null,
    clarificationOverhead: opportunity(
      ofType(events, "requested_clarification").length,
      turns,
    ),
  };
}

function developmentMetrics(
  view: InteractionGraphView,
  objects: ReasoningObject[],
  events: InteractionEvent[],
  turns: number,
): DevelopmentMetrics {
  const edges = edgesOf(view.graph);
  const ids = objects.map((o) => o.id);
  const roots = ids.filter((id) => parentIdsOf(id, edges).length === 0);
  const survivingRoots = roots.filter((id) => {
    const object = view.byId.get(id);
    if (object?.inFinalPosition) return true;
    return [...descendantsOf(id, edges)].some(
      (child) => view.byId.get(child)?.inFinalPosition,
    );
  });
  const mutationTurns = new Set(
    view.graph.events
      .filter((e) => e.turnIndex > 0 && eventChangedState(e))
      .map((e) => e.turnIndex),
  );
  const active = objects.filter(
    (o) => o.status !== "rejected" && o.status !== "superseded",
  ).length;
  return {
    graphDepth: {
      average: meanGraphDepth(ids, edges),
      maximum: maxGraphDepth(ids, edges),
    },
    branchingFactor: branchingFactor(ids, edges),
    revisions: ofType(events, "revised").length,
    abandonedBranches: ofType(events, "withdrawn").length,
    independentBranches: roots.length,
    survivingBranches: survivingRoots.length,
    synthesisNodes: ofType(events, "synthesized").length,
    activeIdeaDelta: objects.length === 0 ? null : active - objects.length,
    mutationRate: opportunity(mutationTurns.size, turns),
  };
}
