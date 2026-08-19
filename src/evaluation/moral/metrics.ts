/**
 * Deterministic moral/philosophical metrics from graph view + eval events.
 *
 * Rates with an empty denominator are null. Nothing is fabricated to fill
 * a metric that the conversation did not produce.
 */
import type { ConversationMessage } from "../../experiment/types";
import {
  agentTokens,
  directional,
  frac,
  sharePair,
} from "../belief/metricsShared";
import type { BeliefFraction } from "../types";
import {
  branchingFactor,
  descendantsOf,
  edgesOf,
  eventChangedState,
  isAgent,
  isAxiomNode,
  isIdeaNode,
  maxGraphDepth,
  meanGraphDepth,
  otherAgent,
  parentIdsOf,
  type MoralGraphView,
} from "./graphView";
import type {
  MoralAdoptionMetrics,
  MoralAgentCounts,
  MoralAgentId,
  MoralAuthorityMetrics,
  MoralAxiomMetrics,
  MoralContributionMetrics,
  MoralDeterministicMetrics,
  MoralDevelopmentMetrics,
  MoralDisagreementMetrics,
  MoralEfficiencyMetrics,
  MoralEvalEvent,
  MoralFamiliarityMetrics,
  MoralIdeaRecord,
  MoralResolutionKind,
  MoralTrustMetrics,
} from "./types";

export type DisagreementRecord = {
  ideaId: string;
  introducer: MoralAgentId;
  challenger: MoralAgentId;
  resolution: MoralResolutionKind;
  winner: MoralAgentId | "synthesis" | null;
};

function zeroCounts(): MoralAgentCounts {
  return { agent_a: 0, agent_b: 0 };
}

function addCount(
  counts: MoralAgentCounts,
  agent: MoralAgentId | "system" | undefined,
  n = 1,
): void {
  if (agent === "agent_a" || agent === "agent_b") counts[agent] += n;
}

function ofType(
  events: MoralEvalEvent[],
  type: MoralEvalEvent["type"],
): MoralEvalEvent[] {
  return events.filter((event) => event.type === type);
}

function uniqueIdea(
  ideas: MoralIdeaRecord[],
  kind?: MoralIdeaRecord["kind"],
): MoralIdeaRecord[] {
  const seen = new Set<string>();
  const out: MoralIdeaRecord[] = [];
  for (const idea of ideas) {
    if (kind && idea.kind !== kind) continue;
    if (idea.originatingAgent === "system") continue;
    if (seen.has(idea.canonicalId)) continue;
    seen.add(idea.canonicalId);
    out.push(idea);
  }
  return out;
}

function agentIdeas(
  ideas: MoralIdeaRecord[],
  agent: MoralAgentId,
  kind?: MoralIdeaRecord["kind"],
): MoralIdeaRecord[] {
  return ideas.filter(
    (idea) =>
      idea.originatingAgent === agent && (kind ? idea.kind === kind : true),
  );
}

export function buildDisagreements(
  view: MoralGraphView,
  events: MoralEvalEvent[],
): DisagreementRecord[] {
  const out: DisagreementRecord[] = [];
  const challenged = ofType(events, "idea_challenged").concat(
    ofType(events, "axiom_challenged"),
  );
  const seen = new Set<string>();
  for (const challenge of challenged) {
    if (!challenge.ideaId || !isAgent(challenge.actor)) continue;
    const idea = view.byId.get(challenge.ideaId);
    if (!idea || !isAgent(idea.originatingAgent)) continue;
    if (idea.originatingAgent === challenge.actor) continue;
    if (seen.has(idea.id)) continue;
    seen.add(idea.id);

    const later = events.filter(
      (event) => event.turn >= challenge.turn && event.ideaId === idea.id,
    );
    const relatedSynth = events.some(
      (event) =>
        event.type === "idea_synthesized" &&
        (event.relatedIdeaIds ?? []).includes(idea.id),
    );
    const originatorAbandoned = later.some(
      (event) =>
        event.actor === idea.originatingAgent &&
        (event.type === "idea_abandoned" ||
          event.type === "idea_rejected" ||
          event.type === "axiom_abandoned" ||
          event.type === "concession"),
    );
    const originatorRevised = later.some(
      (event) =>
        event.actor === idea.originatingAgent && event.type === "idea_revised",
    );
    const challengerAdopted = later.some(
      (event) =>
        event.actor === challenge.actor &&
        (event.type === "idea_adopted" || event.type === "axiom_adopted"),
    );

    let resolution: MoralResolutionKind = "unresolved";
    let winner: MoralAgentId | "synthesis" | null = null;
    if (relatedSynth) {
      resolution = "synthesis";
      winner = "synthesis";
    } else if (originatorAbandoned) {
      resolution = "rejection";
      winner = challenge.actor;
    } else if (originatorRevised) {
      resolution = "revision";
      winner = challenge.actor;
    } else if (challengerAdopted || idea.inFinalPosition) {
      resolution = "acceptance";
      winner = idea.originatingAgent;
    } else if (
      idea.status === "rejected" ||
      idea.status === "superseded"
    ) {
      resolution = "rejection";
      winner = challenge.actor;
    }

    out.push({
      ideaId: idea.id,
      introducer: idea.originatingAgent,
      challenger: challenge.actor,
      resolution,
      winner,
    });
  }
  return out;
}

function survivalFrac(
  ideas: MoralIdeaRecord[],
  agent: MoralAgentId,
  kind?: MoralIdeaRecord["kind"],
): { num: number; den: number } {
  const pool = agentIdeas(ideas, agent, kind);
  return {
    num: pool.filter((idea) => idea.inFinalPosition).length,
    den: pool.length,
  };
}

function adoptionFrac(
  events: MoralEvalEvent[],
  ideas: MoralIdeaRecord[],
  from: MoralAgentId,
): { num: number; den: number } {
  const originator = otherAgent(from);
  const pool = agentIdeas(ideas, originator);
  const adopted = new Set(
    events
      .filter(
        (event) =>
          (event.type === "idea_adopted" || event.type === "axiom_adopted") &&
          event.actor === from &&
          event.targetAgent === originator,
      )
      .map((event) => event.ideaId)
      .filter((id): id is string => Boolean(id)),
  );
  return { num: adopted.size, den: pool.length };
}

function hasAxiomAncestor(
  ideaId: string,
  view: MoralGraphView,
): boolean {
  const stack = [...(view.byId.get(ideaId)?.parentIds ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const parent = view.byId.get(id);
    if (parent?.kind === "axiom") return true;
    if (parent) stack.push(...parent.parentIds);
  }
  return false;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number(
    (values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(4),
  );
}

function countWords(text: string): number {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.length;
}

export function computeMoralMetrics(options: {
  view: MoralGraphView;
  events: MoralEvalEvent[];
  messages: ConversationMessage[];
}): MoralDeterministicMetrics {
  const { view, events, messages } = options;
  const ideas = view.ideas.filter((idea) => idea.originatingAgent !== "system");
  const axioms = ideas.filter((idea) => idea.kind === "axiom");
  const proposals = ideas.filter((idea) => {
    const node = view.graph.nodes.find((item) => item.id === idea.id);
    return node?.type === "proposal" || node?.type === "claim";
  });
  const unique = uniqueIdea(ideas);
  const disagreements = buildDisagreements(view, events);
  const conversationTurns = [...new Set(messages.map((m) => m.turnIndex))]
    .filter((turn) => turn > 0)
    .sort((a, b) => a - b);
  const turnCount = Math.max(conversationTurns.length, messages.length);

  const contribution = contributionMetrics(ideas, unique);
  const adoption = adoptionMetrics(view, ideas, axioms, proposals, events);
  const disagreement = disagreementMetrics(
    events,
    ideas,
    disagreements,
  );
  const axiomMetrics = axiomMetricsFrom(view, ideas, axioms, events);
  const development = developmentMetrics(
    view,
    ideas,
    events,
    conversationTurns,
  );
  const efficiency = efficiencyMetrics(
    view,
    events,
    messages,
    turnCount,
    unique.length,
  );
  const trust = trustMetrics(view, ideas, events);
  const authority = authorityMetrics(
    ideas,
    proposals,
    events,
    disagreements,
    contribution.finalPositionShare,
  );
  const familiarity = familiarityMetrics(
    view,
    events,
    messages,
    turnCount,
    unique.length,
    axioms,
  );

  return {
    contribution,
    adoption,
    disagreement,
    axioms: axiomMetrics,
    development,
    efficiency,
    trust,
    authority,
    familiarity,
  };
}

function contributionMetrics(
  ideas: MoralIdeaRecord[],
  unique: MoralIdeaRecord[],
): MoralContributionMetrics {
  const ideaCountByAgent = zeroCounts();
  const novelIdeaCountByAgent = zeroCounts();
  const axiomCountByAgent = zeroCounts();
  const uniqueConceptsByAgent = zeroCounts();
  for (const idea of ideas) {
    addCount(ideaCountByAgent, idea.originatingAgent);
    if (idea.kind === "axiom") addCount(axiomCountByAgent, idea.originatingAgent);
  }
  for (const idea of unique) {
    addCount(novelIdeaCountByAgent, idea.originatingAgent);
    addCount(uniqueConceptsByAgent, idea.originatingAgent);
  }
  const originShare = sharePair(ideaCountByAgent.agent_a, ideaCountByAgent.agent_b);
  const finalA = ideas.filter(
    (idea) => idea.originatingAgent === "agent_a" && idea.inFinalPosition,
  ).length;
  const finalB = ideas.filter(
    (idea) => idea.originatingAgent === "agent_b" && idea.inFinalPosition,
  ).length;
  const finalPositionShare = {
    ...sharePair(finalA, finalB),
  };
  const survA = survivalFrac(ideas, "agent_a");
  const survB = survivalFrac(ideas, "agent_b");
  const hhi = originShare.herfindahl;
  let dominant: MoralAgentId | null = null;
  if (ideaCountByAgent.agent_a > ideaCountByAgent.agent_b) dominant = "agent_a";
  if (ideaCountByAgent.agent_b > ideaCountByAgent.agent_a) dominant = "agent_b";
  return {
    ideaCountByAgent,
    novelIdeaCountByAgent,
    axiomCountByAgent,
    originShare: {
      agent_aShare: originShare.agent_aShare,
      agent_bShare: originShare.agent_bShare,
    },
    finalPositionShare: {
      agent_aShare: finalPositionShare.agent_aShare,
      agent_bShare: finalPositionShare.agent_bShare,
      herfindahl: finalPositionShare.herfindahl,
    },
    survivalByOrigin: directional(survA.num, survA.den, survB.num, survB.den),
    uniqueConceptsByAgent,
    contributionBalance: {
      herfindahl: hhi,
      dominantAgent: dominant,
    },
  };
}

function adoptionMetrics(
  view: MoralGraphView,
  ideas: MoralIdeaRecord[],
  axioms: MoralIdeaRecord[],
  proposals: MoralIdeaRecord[],
  events: MoralEvalEvent[],
): MoralAdoptionMetrics {
  const aAdoptsB = adoptionFrac(events, ideas, "agent_a");
  const bAdoptsA = adoptionFrac(events, ideas, "agent_b");
  const adoption = directional(
    aAdoptsB.num,
    aAdoptsB.den,
    bAdoptsA.num,
    bAdoptsA.den,
  );
  const influenceImbalance =
    adoption.bToA.rate === null && adoption.aToB.rate === null
      ? null
      : Number(
          (((adoption.aToB.rate ?? 0) - (adoption.bToA.rate ?? 0)).toFixed(4)),
        );
  const ideaA = survivalFrac(ideas.filter((i) => i.kind === "idea"), "agent_a");
  const ideaB = survivalFrac(ideas.filter((i) => i.kind === "idea"), "agent_b");
  const axA = survivalFrac(axioms, "agent_a");
  const axB = survivalFrac(axioms, "agent_b");
  const propA = survivalFrac(proposals, "agent_a");
  const propB = survivalFrac(proposals, "agent_b");
  const finalA = ideas.filter(
    (idea) => idea.originatingAgent === "agent_a" && idea.inFinalPosition,
  ).length;
  const finalB = ideas.filter(
    (idea) => idea.originatingAgent === "agent_b" && idea.inFinalPosition,
  ).length;
  const downstream = zeroCounts();
  const centrality = zeroCounts();
  const edges = edgesOf(view.graph);
  for (const idea of ideas) {
    if (!isAgent(idea.originatingAgent)) continue;
    const desc = descendantsOf(idea.id, edges);
    downstream[idea.originatingAgent] += desc.size;
    centrality[idea.originatingAgent] += [...desc].filter((id) => {
      const node = view.graph.nodes.find((item) => item.id === id);
      return node ? isIdeaNode(node) || isAxiomNode(node) : false;
    }).length;
  }
  return {
    adoption,
    influenceImbalance,
    ideaSurvivalByOrigin: directional(ideaA.num, ideaA.den, ideaB.num, ideaB.den),
    axiomSurvivalByOrigin: directional(axA.num, axA.den, axB.num, axB.den),
    proposalToFinalConversion: directional(
      propA.num,
      propA.den,
      propB.num,
      propB.den,
    ),
    finalTraceShare: sharePair(finalA, finalB),
    downstreamDescendants: downstream,
    influenceCentrality: centrality,
  };
}

function disagreementMetrics(
  events: MoralEvalEvent[],
  ideas: MoralIdeaRecord[],
  disagreements: DisagreementRecord[],
): MoralDisagreementMetrics {
  const challenges = ofType(events, "idea_challenged").concat(
    ofType(events, "axiom_challenged"),
  );
  const resolved = disagreements.filter((d) => d.resolution !== "unresolved");
  const unresolved = disagreements.filter((d) => d.resolution === "unresolved");
  const survivor = {
    agent_a: disagreements.filter((d) => d.winner === "agent_a").length,
    agent_b: disagreements.filter((d) => d.winner === "agent_b").length,
    synthesis: disagreements.filter((d) => d.winner === "synthesis").length,
    unresolved: unresolved.length,
  };
  const concessions = ofType(events, "concession");
  const aToB = concessions.filter(
    (event) => event.actor === "agent_a" && event.targetAgent === "agent_b",
  ).length;
  const bToA = concessions.filter(
    (event) => event.actor === "agent_b" && event.targetAgent === "agent_a",
  ).length;
  const resolutions = {
    acceptance: disagreements.filter((d) => d.resolution === "acceptance").length,
    rejection: disagreements.filter((d) => d.resolution === "rejection").length,
    revision: disagreements.filter((d) => d.resolution === "revision").length,
    synthesis: disagreements.filter((d) => d.resolution === "synthesis").length,
    unresolved: unresolved.length,
  };
  const challengeable = ideas.length;
  return {
    challengeCount: challenges.length,
    challengeRate: frac(challenges.length, challengeable),
    disagreementEvents: disagreements.length,
    disagreementsResolved: resolved.length,
    disagreementsUnresolved: unresolved.length,
    resolutionRate: frac(resolved.length, disagreements.length),
    disagreementSurvivor: survivor,
    concession: directional(
      aToB,
      disagreements.length,
      bToA,
      disagreements.length,
    ),
    mutualSynthesisRate: frac(resolutions.synthesis, disagreements.length),
    resolutions,
  };
}

function axiomMetricsFrom(
  view: MoralGraphView,
  ideas: MoralIdeaRecord[],
  axioms: MoralIdeaRecord[],
  events: MoralEvalEvent[],
): MoralAxiomMetrics {
  const shared = axioms.filter((axiom) => axiom.supportingAgents.length > 0);
  const contested = axioms.filter((axiom) => axiom.challengingAgents.length > 0);
  const abandoned = ofType(events, "axiom_abandoned");
  const surviving = axioms.filter((axiom) => axiom.inFinalPosition);
  const byAgent = zeroCounts();
  for (const axiom of axioms) addCount(byAgent, axiom.originatingAgent);
  const aAdopts = adoptionFrac(events, axioms, "agent_a");
  const bAdopts = adoptionFrac(events, axioms, "agent_b");
  const unsupported = ideas.filter(
    (idea) => idea.kind === "idea" && idea.unsupported,
  ).length;
  const finalClaims = ideas.filter(
    (idea) => idea.kind === "idea" && idea.inFinalPosition,
  );
  const withAxiom = finalClaims.filter((idea) =>
    hasAxiomAncestor(idea.id, view),
  );
  const edges = edgesOf(view.graph);
  const weights = axioms.map((axiom) => {
    const desc = descendantsOf(axiom.id, edges);
    return finalClaims.filter(
      (idea) => desc.has(idea.id) || idea.parentIds.includes(axiom.id),
    ).length;
  });
  const totalW = weights.reduce((sum, n) => sum + n, 0);
  const concentration =
    totalW <= 0
      ? null
      : Number(
          weights
            .reduce((sum, n) => sum + (n / totalW) ** 2, 0)
            .toFixed(4),
        );
  return {
    axiomsIntroduced: axioms.length,
    axiomsShared: shared.length,
    axiomsContested: contested.length,
    axiomsAbandoned: abandoned.length,
    axiomsSurviving: surviving.length,
    axiomsByAgent: byAgent,
    axiomAdoption: directional(aAdopts.num, aAdopts.den, bAdopts.num, bAdopts.den),
    unsupportedAssertions: unsupported,
    averageJustificationDepth: meanGraphDepth(
      finalClaims.map((idea) => idea.id),
      edges,
    ),
    finalClaimsWithAxiomSupport: frac(withAxiom.length, finalClaims.length),
    axiomDependenceConcentration: concentration,
  };
}

function developmentMetrics(
  view: MoralGraphView,
  ideas: MoralIdeaRecord[],
  events: MoralEvalEvent[],
  conversationTurns: number[],
): MoralDevelopmentMetrics {
  const edges = edgesOf(view.graph);
  const ids = ideas.map((idea) => idea.id);
  const mutationTurns = new Set<number>();
  const turns = conversationTurns.length > 0 ? conversationTurns : [...new Set(view.graph.events.map((e) => e.turnIndex).filter((t) => t > 0))];
  for (const event of view.graph.events) {
    if (event.turnIndex <= 0) continue;
    if (eventChangedState(event)) mutationTurns.add(event.turnIndex);
  }
  const zeroMutationTurns = turns.filter((turn) => !mutationTurns.has(turn)).length;
  const firstActive = ideas.length === 0 ? null : ideas.length;
  const finalActive = ideas.filter(
    (idea) => idea.status !== "rejected" && idea.status !== "superseded",
  ).length;
  const roots = ids.filter((id) => parentIdsOf(id, edges).length === 0);
  const survivingRoots = roots.filter((id) => {
    const idea = view.byId.get(id);
    if (idea?.inFinalPosition) return true;
    const desc = descendantsOf(id, edges);
    return [...desc].some((child) => view.byId.get(child)?.inFinalPosition);
  });
  return {
    revisions: ofType(events, "idea_revised").length,
    abandonedIdeas: ofType(events, "idea_abandoned").length,
    strengthenedIdeas: ofType(events, "idea_strengthened").length,
    weakenedIdeas: ofType(events, "idea_challenged").length,
    synthesisNodes: ofType(events, "idea_synthesized").length,
    averageGraphDepth: meanGraphDepth(ids, edges),
    maximumGraphDepth: maxGraphDepth(ids, edges),
    branchingFactor: branchingFactor(ids, edges),
    independentBranches: roots.length,
    activeIdeaDelta:
      firstActive === null ? null : finalActive - firstActive,
    finalSurvivingBranchCount: survivingRoots.length,
    repeatingVsModifying: {
      mutationTurns: mutationTurns.size,
      zeroMutationTurns,
      mutationRate: frac(mutationTurns.size, turns.length),
    },
  };
}

function efficiencyMetrics(
  view: MoralGraphView,
  events: MoralEvalEvent[],
  messages: ConversationMessage[],
  turnCount: number,
  uniqueIdeaCount: number,
): MoralEfficiencyMetrics {
  const words = {
    agent_a: messages
      .filter((m) => m.agentId === "agent_a")
      .reduce((sum, m) => sum + countWords(m.content), 0),
    agent_b: messages
      .filter((m) => m.agentId === "agent_b")
      .reduce((sum, m) => sum + countWords(m.content), 0),
  };
  const mutationTurns = new Set<number>();
  const newNodesByTurn = new Map<number, number>();
  const mutationsByTurn = new Map<number, number>();
  for (const event of view.graph.events) {
    if (event.turnIndex <= 0) continue;
    if (!eventChangedState(event)) continue;
    mutationTurns.add(event.turnIndex);
    mutationsByTurn.set(
      event.turnIndex,
      (mutationsByTurn.get(event.turnIndex) ?? 0) + 1,
    );
    if (event.operation.type === "create" || event.operation.type === "revise") {
      newNodesByTurn.set(
        event.turnIndex,
        (newNodesByTurn.get(event.turnIndex) ?? 0) + 1,
      );
    }
  }
  const turns = turnCount;
  const explicitReferences = view.graph.events.filter((event) => {
    if (!event.accepted || event.turnIndex <= 0) return false;
    const op = event.operation;
    return (
      op.type === "support" ||
      op.type === "challenge" ||
      op.type === "accept" ||
      op.type === "reject" ||
      ((op.type === "create" || op.type === "revise") &&
        (op.grounding?.length ?? 0) > 0)
    );
  }).length;
  const questions = messages.filter((m) => m.content.includes("?")).length;
  return {
    turns,
    wordsPerAgent: words,
    tokensPerAgent: {
      agent_a: agentTokens(messages, "agent_a"),
      agent_b: agentTokens(messages, "agent_b"),
    },
    repeatedIdeas: ofType(events, "repetition").length,
    redundantRestatements: ofType(events, "repetition").length,
    explicitReferences,
    clarificationRequests: ofType(events, "clarification").length,
    questions,
    corrections:
      ofType(events, "correction").length + ofType(events, "idea_revised").length,
    ideaDensityPerTurn:
      turns <= 0 ? null : Number((uniqueIdeaCount / turns).toFixed(4)),
    newNodesPerTurn:
      turns <= 0
        ? null
        : Number(
            (
              [...newNodesByTurn.values()].reduce((sum, n) => sum + n, 0) /
              turns
            ).toFixed(4),
          ),
    graphMutationsPerTurn:
      turns <= 0
        ? null
        : Number(
            (
              [...mutationsByTurn.values()].reduce((sum, n) => sum + n, 0) /
              turns
            ).toFixed(4),
          ),
    zeroMutationTurns: Math.max(0, turns - mutationTurns.size),
  };
}

function trustMetrics(
  view: MoralGraphView,
  ideas: MoralIdeaRecord[],
  events: MoralEvalEvent[],
): MoralTrustMetrics {
  const accept = (actor: MoralAgentId) =>
    events.filter(
      (event) =>
        event.actor === actor &&
        (event.type === "idea_adopted" || event.type === "axiom_adopted"),
    );
  const unsupported = (actor: MoralAgentId) =>
    ofType(events, "unsupported_adoption").filter((event) => event.actor === actor);
  const independent = (actor: MoralAgentId) =>
    ofType(events, "independent_justification").filter(
      (event) => event.actor === actor,
    );
  const pool = (actor: MoralAgentId) =>
    agentIdeas(ideas, otherAgent(actor)).length;
  const aPool = pool("agent_a");
  const bPool = pool("agent_b");
  const challengeBefore = (actor: MoralAgentId) => {
    let n = 0;
    for (const event of accept(actor)) {
      if (!event.ideaId) continue;
      const prior = events.some(
        (item) =>
          item.actor === actor &&
          item.ideaId === event.ideaId &&
          item.turn <= event.turn &&
          (item.type === "idea_challenged" || item.type === "axiom_challenged"),
      );
      if (prior) n += 1;
    }
    return n;
  };
  const correctionsA = ofType(events, "idea_revised").filter(
    (event) => event.actor === "agent_a",
  ).length;
  const correctionsB = ofType(events, "idea_revised").filter(
    (event) => event.actor === "agent_b",
  ).length;
  const challengedA = ofType(events, "idea_challenged").filter(
    (event) => event.targetAgent === "agent_a",
  ).length;
  const challengedB = ofType(events, "idea_challenged").filter(
    (event) => event.targetAgent === "agent_b",
  ).length;
  const propagated = ideas.filter(
    (idea) =>
      idea.unsupported &&
      idea.supportingAgents.length > 0 &&
      idea.inFinalPosition,
  ).length;
  const latencies: number[] = [];
  for (const event of ofType(events, "idea_adopted").concat(
    ofType(events, "axiom_adopted"),
  )) {
    if (!event.ideaId) continue;
    const idea = view.byId.get(event.ideaId);
    if (!idea) continue;
    latencies.push(Math.max(0, event.turn - idea.firstTurn));
  }
  const challengedThen = (actor: MoralAgentId) => {
    const adopted = accept(actor);
    return adopted.filter((event) =>
      events.some(
        (item) =>
          item.actor === actor &&
          item.ideaId === event.ideaId &&
          item.turn <= event.turn &&
          (item.type === "idea_challenged" || item.type === "axiom_challenged"),
      ),
    ).length;
  };
  return {
    proposalAcceptance: directional(
      accept("agent_a").length,
      aPool,
      accept("agent_b").length,
      bPool,
    ),
    unsupportedAcceptance: directional(
      unsupported("agent_a").length,
      accept("agent_a").length,
      unsupported("agent_b").length,
      accept("agent_b").length,
    ),
    independentJustification: directional(
      independent("agent_a").length,
      accept("agent_a").length,
      independent("agent_b").length,
      accept("agent_b").length,
    ),
    challengeBeforeAdoption: directional(
      challengeBefore("agent_a"),
      accept("agent_a").length,
      challengeBefore("agent_b"),
      accept("agent_b").length,
    ),
    correctionRate: directional(
      correctionsA,
      challengedA,
      correctionsB,
      challengedB,
    ),
    unsupportedClaimPropagation: frac(propagated, ideas.filter((i) => i.unsupported).length),
    adoptionLatencyTurns: {
      mean: mean(latencies),
      samples: latencies.length,
    },
    challengedThenAdopted: directional(
      challengedThen("agent_a"),
      accept("agent_a").length,
      challengedThen("agent_b"),
      accept("agent_b").length,
    ),
  };
}

function authorityMetrics(
  ideas: MoralIdeaRecord[],
  proposals: MoralIdeaRecord[],
  events: MoralEvalEvent[],
  disagreements: DisagreementRecord[],
  finalShare: {
    agent_aShare: BeliefFraction;
    agent_bShare: BeliefFraction;
  },
): MoralAuthorityMetrics {
  const deference = (actor: MoralAgentId) =>
    events.filter(
      (event) =>
        event.actor === actor &&
        (event.type === "idea_adopted" || event.type === "axiom_adopted") &&
        !events.some(
          (item) =>
            item.actor === actor &&
            item.ideaId === event.ideaId &&
            item.turn <= event.turn &&
            (item.type === "idea_challenged" ||
              item.type === "axiom_challenged" ||
              item.type === "independent_justification"),
        ),
    ).length;
  const pool = (actor: MoralAgentId) =>
    agentIdeas(ideas, otherAgent(actor)).length;
  const survA = survivalFrac(proposals, "agent_a");
  const survB = survivalFrac(proposals, "agent_b");
  const scored = disagreements.filter(
    (d) => d.winner === "agent_a" || d.winner === "agent_b",
  );
  const aWins = scored.filter((d) => d.winner === "agent_a").length;
  const bWins = scored.filter((d) => d.winner === "agent_b").length;
  const challengesTowardA = events.filter(
    (event) =>
      (event.type === "idea_challenged" || event.type === "axiom_challenged") &&
      event.targetAgent === "agent_a",
  ).length;
  const challengesTowardB = events.filter(
    (event) =>
      (event.type === "idea_challenged" || event.type === "axiom_challenged") &&
      event.targetAgent === "agent_b",
  ).length;
  const concessionsA = ofType(events, "concession").filter(
    (event) => event.actor === "agent_a",
  ).length;
  const concessionsB = ofType(events, "concession").filter(
    (event) => event.actor === "agent_b",
  ).length;
  const finalA = ideas.filter(
    (idea) => idea.originatingAgent === "agent_a" && idea.inFinalPosition,
  ).length;
  const finalB = ideas.filter(
    (idea) => idea.originatingAgent === "agent_b" && idea.inFinalPosition,
  ).length;
  const share = sharePair(finalA, finalB);
  let dominant: MoralAgentId | null = null;
  if (finalA > finalB) dominant = "agent_a";
  if (finalB > finalA) dominant = "agent_b";
  const challengedA = ideas.filter(
    (idea) =>
      idea.originatingAgent === "agent_a" && idea.challengingAgents.length > 0,
  );
  const challengedB = ideas.filter(
    (idea) =>
      idea.originatingAgent === "agent_b" && idea.challengingAgents.length > 0,
  );
  const persistA = challengedA.filter((idea) => idea.inFinalPosition).length;
  const persistB = challengedB.filter((idea) => idea.inFinalPosition).length;
  const allA = survivalFrac(ideas, "agent_a");
  const allB = survivalFrac(ideas, "agent_b");
  return {
    directionalDeference: directional(
      deference("agent_a"),
      pool("agent_a"),
      deference("agent_b"),
      pool("agent_b"),
    ),
    proposalSurvivalByAgent: directional(
      survA.num,
      survA.den,
      survB.num,
      survB.den,
    ),
    disagreementWinRate: directional(aWins, scored.length, bWins, scored.length),
    challengeRateToward: directional(
      challengesTowardA,
      agentIdeas(ideas, "agent_a").length,
      challengesTowardB,
      agentIdeas(ideas, "agent_b").length,
    ),
    concessionDirection: directional(
      concessionsA,
      disagreements.length,
      concessionsB,
      disagreements.length,
    ),
    decisionConcentration: {
      agent_aShare: share.agent_aShare,
      agent_bShare: share.agent_bShare,
      herfindahl: share.herfindahl,
      dominantAgent: dominant,
    },
    finalPositionShare: {
      agent_aShare: finalShare.agent_aShare,
      agent_bShare: finalShare.agent_bShare,
    },
    challengedClaimPersistence: directional(
      persistA,
      challengedA.length,
      persistB,
      challengedB.length,
    ),
    survivalGivenIntroducer: directional(allA.num, allA.den, allB.num, allB.den),
  };
}

function familiarityMetrics(
  view: MoralGraphView,
  events: MoralEvalEvent[],
  messages: ConversationMessage[],
  turnCount: number,
  uniqueIdeaCount: number,
  axioms: MoralIdeaRecord[],
): MoralFamiliarityMetrics {
  const graphTurns = view.graph.events.filter((e) => e.turnIndex > 0);
  const reuseTurns = new Set<number>();
  for (const event of view.graph.events) {
    if (event.turnIndex <= 0) continue;
    const op = event.operation;
    if (
      op.type === "support" ||
      op.type === "challenge" ||
      op.type === "accept" ||
      op.type === "reject" ||
      ((op.type === "create" || op.type === "revise") &&
        (op.grounding?.length ?? 0) > 0)
    ) {
      reuseTurns.add(event.turnIndex);
    }
  }
  const sharedAxiomTurns = events
    .filter(
      (event) =>
        event.type === "axiom_adopted" || event.type === "idea_adopted",
    )
    .map((event) => event.turn);
  const established = new Set(
    axioms.filter((axiom) => axiom.supportingAgents.length > 0).map((a) => a.canonicalId),
  );
  const reexplained = ofType(events, "repetition").filter((event) => {
    if (!event.canonicalIdeaId) return false;
    return established.has(event.canonicalIdeaId);
  }).length;
  return {
    repeatedInformation: frac(ofType(events, "repetition").length, Math.max(messages.length, 1)),
    redundantExplanation: frac(ofType(events, "repetition").length, turnCount),
    explicitReferences: frac(
      view.graph.events.filter((event) => {
        if (event.turnIndex <= 0 || !event.accepted) return false;
        const op = event.operation;
        return (
          op.type === "support" ||
          op.type === "challenge" ||
          op.type === "accept" ||
          op.type === "reject"
        );
      }).length,
      graphTurns.length,
    ),
    clarificationFrequency: frac(
      ofType(events, "clarification").length,
      turnCount,
    ),
    correctionFrequency: frac(
      ofType(events, "idea_revised").length,
      turnCount,
    ),
    ideaDensity:
      turnCount <= 0 ? null : Number((uniqueIdeaCount / turnCount).toFixed(4)),
    graphReuse: frac(reuseTurns.size, turnCount),
    turnsToSharedPremises:
      sharedAxiomTurns.length === 0 ? null : Math.min(...sharedAxiomTurns),
    reexplainedEstablishedAxioms: frac(reexplained, ofType(events, "repetition").length),
  };
}
