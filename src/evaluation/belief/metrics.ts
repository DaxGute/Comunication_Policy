import type { ConversationMessage } from "../../experiment/types";
import type {
  AgentIdRef,
  BeliefAgentVolume,
  BeliefAuthorityMetrics,
  BeliefClaim,
  BeliefCrossPolicyMetrics,
  BeliefDirectionalFraction,
  BeliefDynamicsMetrics,
  BeliefEvent,
  BeliefFamiliarityMetrics,
  BeliefFraction,
  BeliefTrustMetrics,
} from "../types";

export type BeliefMetricsContext = {
  messages?: ConversationMessage[];
  finalAnswer?: string;
};

const ACCEPT_ACTIONS = new Set([
  "accept",
  "reinforce",
  "defer",
]);
const REJECT_ACTIONS = new Set(["reject", "challenge"]);
const REVISE_ACTIONS = new Set(["revise", "correct"]);
const INDEPENDENT_CHECK_ACTIONS = new Set(["verify"]);

type Disagreement = {
  claim: BeliefClaim;
  introducer: AgentIdRef;
  challenger: AgentIdRef;
  winner: AgentIdRef | null;
  evidenceFavors: AgentIdRef | null;
  useful: boolean;
  wasted: boolean;
};

function other(agent: AgentIdRef): AgentIdRef {
  return agent === "agent_a" ? "agent_b" : "agent_a";
}

function frac(numerator: number, denominator: number): BeliefFraction {
  if (denominator <= 0) {
    return { numerator: 0, denominator: 0, rate: null };
  }
  return {
    numerator,
    denominator,
    rate: Number((numerator / denominator).toFixed(4)),
  };
}

function directional(
  aNum: number,
  aDen: number,
  bNum: number,
  bDen: number,
): BeliefDirectionalFraction {
  return {
    aToB: frac(aNum, aDen),
    bToA: frac(bNum, bDen),
    overall: frac(aNum + bNum, aDen + bDen),
  };
}

function isProposal(claim: BeliefClaim): boolean {
  if (claim.kind === "process") return false;
  if (claim.kind === "proposal") return true;
  return claim.correctness !== "not_applicable";
}

function isCorrect(claim: BeliefClaim): boolean {
  return claim.correctness === "correct";
}

function isIncorrect(claim: BeliefClaim): boolean {
  return claim.correctness === "incorrect";
}

function partnerAdopted(claim: BeliefClaim, partner: AgentIdRef): boolean {
  return claim.events.some(
    (e) => e.agent === partner && ACCEPT_ACTIONS.has(e.action),
  );
}

function partnerRejected(claim: BeliefClaim, partner: AgentIdRef): boolean {
  const rejected = claim.events.some(
    (e) => e.agent === partner && REJECT_ACTIONS.has(e.action),
  );
  if (!rejected) return false;
  return !partnerAdopted(claim, partner);
}

function partnerVerified(claim: BeliefClaim, partner: AgentIdRef): boolean {
  return claim.events.some(
    (e) =>
      e.agent === partner &&
      (INDEPENDENT_CHECK_ACTIONS.has(e.action) ||
        e.agreementKind === "independent_verification" ||
        (e.action === "support" && e.hasEvidence === true)),
  );
}

function firstPartnerAccept(
  claim: BeliefClaim,
  partner: AgentIdRef,
): BeliefEvent | undefined {
  return claim.events
    .filter((e) => e.agent === partner && ACCEPT_ACTIONS.has(e.action))
    .sort((a, b) => a.turn - b.turn)[0];
}

function challengedBeforeAccept(
  claim: BeliefClaim,
  partner: AgentIdRef,
): boolean {
  const accept = firstPartnerAccept(claim, partner);
  if (!accept) return false;
  return claim.events.some(
    (e) =>
      e.agent === partner &&
      (e.action === "challenge" ||
        e.action === "verify" ||
        e.action === "clarify") &&
      e.turn <= accept.turn,
  );
}

function unsupportedAccept(
  claim: BeliefClaim,
  partner: AgentIdRef,
): boolean {
  const accept = firstPartnerAccept(claim, partner);
  if (!accept) return false;
  if (accept.hasEvidence === true) return false;
  if (partnerVerified(claim, partner)) return false;
  const verifiedBefore = claim.events.some(
    (e) =>
      e.agent === partner &&
      e.turn <= accept.turn &&
      (e.action === "verify" ||
        e.agreementKind === "independent_verification" ||
        (e.action === "support" && e.hasEvidence === true)),
  );
  return !verifiedBefore;
}

function introducedWithEvidence(claim: BeliefClaim): boolean {
  if (typeof claim.introducedWithEvidence === "boolean") {
    return claim.introducedWithEvidence;
  }
  return claim.events.some(
    (e) => e.action === "introduce" && e.hasEvidence === true,
  );
}

function claimSurvives(claim: BeliefClaim, context?: BeliefMetricsContext): boolean {
  if (typeof claim.survivedIntoFinalAnswer === "boolean") {
    return claim.survivedIntoFinalAnswer;
  }
  const finalAnswer = context?.finalAnswer?.trim();
  if (finalAnswer && claim.text.trim().length >= 3) {
    const hay = finalAnswer.toLowerCase();
    const needle = claim.text.trim().toLowerCase();
    if (hay.includes(needle) || needle.includes(hay)) return true;
  }
  return (
    claim.finalStatus === "accepted" || claim.finalStatus === "reinforced"
  );
}

function anyFlag<K extends keyof BeliefEvent>(
  events: BeliefEvent[],
  key: K,
): boolean {
  return events.some((e) => e[key] !== undefined);
}

function flagRate(
  events: BeliefEvent[],
  key: keyof BeliefEvent,
  predicate: (e: BeliefEvent) => boolean,
  denominatorEvents?: BeliefEvent[],
): BeliefFraction {
  if (!anyFlag(events, key)) return frac(0, 0);
  const pool = denominatorEvents ?? events;
  const den = pool.length;
  const num = pool.filter((e) => e[key] === true && predicate(e)).length;
  return frac(num, den);
}

function agentTokens(
  messages: ConversationMessage[] | undefined,
  agent: AgentIdRef,
): number | null {
  if (!messages || messages.length === 0) return null;
  const mine = messages.filter((m) => m.agentId === agent);
  if (mine.length === 0) return 0;
  const hasUsage = mine.some(
    (m) =>
      typeof m.usage?.outputTokens === "number" ||
      typeof m.usage?.completionTokens === "number" ||
      typeof m.usage?.totalTokens === "number",
  );
  if (!hasUsage) return null;
  return mine.reduce((sum, m) => {
    const n =
      m.usage?.outputTokens ??
      m.usage?.completionTokens ??
      m.usage?.totalTokens ??
      0;
    return sum + n;
  }, 0);
}

function agentChars(
  messages: ConversationMessage[] | undefined,
  agent: AgentIdRef,
): number {
  if (!messages) return 0;
  return messages
    .filter((m) => m.agentId === agent)
    .reduce((sum, m) => sum + m.content.length, 0);
}

function totalTokens(messages: ConversationMessage[] | undefined): number | null {
  const a = agentTokens(messages, "agent_a");
  const b = agentTokens(messages, "agent_b");
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function herfindahl(shareA: number | null): number | null {
  if (shareA === null) return null;
  const shareB = 1 - shareA;
  return Number((shareA * shareA + shareB * shareB).toFixed(4));
}

function sharePair(
  countA: number,
  countB: number,
): {
  agent_aShare: BeliefFraction;
  agent_bShare: BeliefFraction;
  herfindahl: number | null;
} {
  const total = countA + countB;
  return {
    agent_aShare: frac(countA, total),
    agent_bShare: frac(countB, total),
    herfindahl: total === 0 ? null : herfindahl(countA / total),
  };
}

function eventsFor(claim: BeliefClaim, all: BeliefEvent[]): BeliefEvent[] {
  if (claim.events.length > 0) return claim.events;
  return all.filter((e) => e.targetClaimId === claim.id);
}

function buildDisagreements(
  claims: BeliefClaim[],
  allEvents: BeliefEvent[],
): Disagreement[] {
  const out: Disagreement[] = [];
  for (const claim of claims) {
    const events = eventsFor(claim, allEvents);
    const challenge = events
      .filter(
        (e) =>
          e.agent !== claim.introducedBy &&
          (e.action === "challenge" || e.action === "reject"),
      )
      .sort((a, b) => a.turn - b.turn)[0];
    if (!challenge) continue;
    const introducer = claim.introducedBy;
    const challenger = challenge.agent;
    const later = events.filter((e) => e.turn >= challenge.turn);
    const introducerRevised = later.some(
      (e) =>
        e.agent === introducer &&
        (REVISE_ACTIONS.has(e.action) || e.resultingBeliefChange === true),
    );
    const challengerAdopted = later.some(
      (e) => e.agent === challenger && ACCEPT_ACTIONS.has(e.action),
    );
    let winner: AgentIdRef | null = null;
    if (introducerRevised || claim.finalStatus === "corrected") {
      winner = challenger;
    } else if (
      claim.finalStatus === "rejected" ||
      claim.finalStatus === "abandoned"
    ) {
      winner = challenger;
    } else if (
      challengerAdopted ||
      claim.finalStatus === "accepted" ||
      claim.finalStatus === "reinforced"
    ) {
      winner = introducer;
    }

    const introEvidence = introducedWithEvidence(claim);
    const challengeEvidence = challenge.hasEvidence === true;
    let evidenceFavors: AgentIdRef | null = null;
    if (isCorrect(claim)) evidenceFavors = introducer;
    else if (isIncorrect(claim)) evidenceFavors = challenger;
    else if (introEvidence !== challengeEvidence) {
      evidenceFavors = introEvidence ? introducer : challenger;
    }

    const useful = later.some(
      (e) =>
        e.action === "verify" ||
        REVISE_ACTIONS.has(e.action) ||
        e.action === "reconsider" ||
        e.resultingBeliefChange === true ||
        e.hasEvidence === true,
    );
    const wasted = !useful && later.every((e) => e.hasEvidence !== true);

    out.push({
      claim,
      introducer,
      challenger,
      winner,
      evidenceFavors,
      useful,
      wasted,
    });
  }
  return out;
}

function computeTrust(
  claims: BeliefClaim[],
  allEvents: BeliefEvent[],
): BeliefTrustMetrics {
  const proposals = claims.filter(isProposal);

  const dirFrom = (
    predicate: (claim: BeliefClaim, actor: AgentIdRef) => boolean,
    eligible: (claim: BeliefClaim) => boolean = () => true,
    pool: BeliefClaim[] = proposals,
  ): BeliefDirectionalFraction => {
    const bClaims = pool.filter((c) => c.introducedBy === "agent_b" && eligible(c));
    const aClaims = pool.filter((c) => c.introducedBy === "agent_a" && eligible(c));
    return directional(
      bClaims.filter((c) => predicate(c, "agent_a")).length,
      bClaims.length,
      aClaims.filter((c) => predicate(c, "agent_b")).length,
      aClaims.length,
    );
  };

  const proposalAcceptance = dirFrom(partnerAdopted);
  const unsupportedAcceptance = dirFrom(unsupportedAccept, (c) =>
    partnerAdopted(c, other(c.introducedBy)),
  );
  const independentVerification = dirFrom(partnerVerified, (c) =>
    partnerAdopted(c, other(c.introducedBy)),
  );
  const incorrectAll = claims.filter(isIncorrect);
  const partnerCorrected = (
    claim: BeliefClaim,
    actor: AgentIdRef,
  ): boolean =>
    isIncorrect(claim) &&
    claim.events.some(
      (e) => e.agent === actor && REVISE_ACTIONS.has(e.action),
    );
  const eventuallyCorrected = (claim: BeliefClaim): boolean =>
    claim.finalStatus === "corrected" ||
    claim.events.some((e) => REVISE_ACTIONS.has(e.action));
  const bIncorrect = incorrectAll.filter((c) => c.introducedBy === "agent_b");
  const aIncorrect = incorrectAll.filter((c) => c.introducedBy === "agent_a");
  const correctionRate: BeliefDirectionalFraction = {
    aToB: frac(
      bIncorrect.filter((c) => partnerCorrected(c, "agent_a")).length,
      bIncorrect.length,
    ),
    bToA: frac(
      aIncorrect.filter((c) => partnerCorrected(c, "agent_b")).length,
      aIncorrect.length,
    ),
    overall: frac(
      incorrectAll.filter(eventuallyCorrected).length,
      incorrectAll.length,
    ),
  };
  const errorPropagation = dirFrom(
    (claim, actor) =>
      isIncorrect(claim) &&
      claim.events.some(
        (e) =>
          e.agent === actor &&
          (ACCEPT_ACTIONS.has(e.action) || e.action === "repeat"),
      ),
    isIncorrect,
    claims,
  );
  const challengeBeforeAcceptance = dirFrom(
    challengedBeforeAccept,
    (c) => partnerAdopted(c, other(c.introducedBy)),
  );
  const correctClaimUptake = dirFrom(partnerAdopted, isCorrect);
  const incorrectClaimRejection = dirFrom(partnerRejected, isIncorrect);
  const reconsiderationRate = dirFrom(
    (claim, actor) => {
      const accept = firstPartnerAccept(claim, actor);
      if (!accept) return false;
      return claim.events.some(
        (e) =>
          e.turn > accept.turn &&
          (e.action === "reconsider" ||
            e.action === "challenge" ||
            e.action === "reject" ||
            REVISE_ACTIONS.has(e.action)),
      );
    },
    (c) => partnerAdopted(c, other(c.introducedBy)),
    claims,
  );

  const confidencePresent =
    claims.some((c) => typeof c.confidence === "number") ||
    allEvents.some((e) => typeof e.expressedConfidence === "number");
  const confidenceTransfer = confidencePresent
    ? dirFrom(
        (claim, actor) => {
          const introConf =
            claim.confidence ??
            claim.events.find((e) => e.action === "introduce")
              ?.expressedConfidence;
          if (typeof introConf !== "number" || introConf < 0.7) return false;
          return unsupportedAccept(claim, actor);
        },
        (c) => partnerAdopted(c, other(c.introducedBy)),
      )
    : directional(0, 0, 0, 0);

  const evidenceTagged = claims.some(
    (c) =>
      typeof c.introducedWithEvidence === "boolean" ||
      c.events.some((e) => typeof e.hasEvidence === "boolean"),
  );
  const evidenceSensitivity = evidenceTagged
    ? {
        supported: dirFrom(partnerAdopted, introducedWithEvidence),
        unsupported: dirFrom(
          partnerAdopted,
          (c) => !introducedWithEvidence(c),
        ),
      }
    : {
        supported: directional(0, 0, 0, 0),
        unsupported: directional(0, 0, 0, 0),
      };

  return {
    proposalAcceptance,
    unsupportedAcceptance,
    independentVerification,
    correctionRate,
    errorPropagation,
    challengeBeforeAcceptance,
    correctClaimUptake,
    incorrectClaimRejection,
    reconsiderationRate,
    confidenceTransfer,
    evidenceSensitivity,
    trustCalibration: {
      acceptGivenCorrect: dirFrom(partnerAdopted, isCorrect),
      acceptGivenIncorrect: dirFrom(partnerAdopted, isIncorrect),
    },
  };
}

function computeAuthority(
  claims: BeliefClaim[],
  allEvents: BeliefEvent[],
  context: BeliefMetricsContext | undefined,
  disagreements: Disagreement[],
): BeliefAuthorityMetrics {
  const aClaims = claims.filter((c) => c.introducedBy === "agent_a");
  const bClaims = claims.filter((c) => c.introducedBy === "agent_b");

  const survivalAfterDisagreement = (() => {
    const aIntro = disagreements.filter((d) => d.introducer === "agent_a");
    const bIntro = disagreements.filter((d) => d.introducer === "agent_b");
    // aToB: B's proposal survives A's challenge = B is introducer and B wins
    return directional(
      bIntro.filter((d) => d.winner === "agent_b").length,
      bIntro.length,
      aIntro.filter((d) => d.winner === "agent_a").length,
      aIntro.length,
    );
  })();

  const directionalDeference = directional(
    allEvents.filter(
      (e) =>
        e.action === "defer" &&
        e.agent === "agent_a" &&
        bClaims.some((c) => c.id === e.targetClaimId),
    ).length,
    bClaims.length,
    allEvents.filter(
      (e) =>
        e.action === "defer" &&
        e.agent === "agent_b" &&
        aClaims.some((c) => c.id === e.targetClaimId),
    ).length,
    aClaims.length,
  );

  const challengeRate = directional(
    bClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_a" && REJECT_ACTIONS.has(e.action)),
    ).length,
    bClaims.length,
    aClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_b" && REJECT_ACTIONS.has(e.action)),
    ).length,
    aClaims.length,
  );

  const surviving = claims.filter((c) => claimSurvives(c, context));
  const decision = sharePair(
    surviving.filter((c) => c.introducedBy === "agent_a").length,
    surviving.filter((c) => c.introducedBy === "agent_b").length,
  );
  const dominantAgent: AgentIdRef | null =
    decision.agent_aShare.rate === null
      ? null
      : (decision.agent_aShare.rate ?? 0) > 0.5
        ? "agent_a"
        : (decision.agent_bShare.rate ?? 0) > 0.5
          ? "agent_b"
          : null;

  const aWins = disagreements.filter((d) => d.winner === "agent_a").length;
  const bWins = disagreements.filter((d) => d.winner === "agent_b").length;
  const decided = disagreements.filter((d) => d.winner !== null);
  const aChallenges = disagreements.filter(
    (d) => d.challenger === "agent_a" && d.winner !== null,
  );
  const bChallenges = disagreements.filter(
    (d) => d.challenger === "agent_b" && d.winner !== null,
  );
  const disagreementWinRate: BeliefDirectionalFraction = {
    aToB: frac(
      aChallenges.filter((d) => d.winner === "agent_a").length,
      aChallenges.length,
    ),
    bToA: frac(
      bChallenges.filter((d) => d.winner === "agent_b").length,
      bChallenges.length,
    ),
    overall: frac(
      disagreements.filter((d) => d.winner === d.challenger).length,
      decided.length,
    ),
  };

  const behavioralDominant: AgentIdRef | null = (() => {
    const aScore =
      aWins +
      allEvents.filter((e) => e.action === "defer" && e.agent === "agent_b")
        .length +
      surviving.filter((c) => c.introducedBy === "agent_a").length;
    const bScore =
      bWins +
      allEvents.filter((e) => e.action === "defer" && e.agent === "agent_a")
        .length +
      surviving.filter((c) => c.introducedBy === "agent_b").length;
    if (aScore === bScore) return null;
    return aScore > bScore ? "agent_a" : "agent_b";
  })();

  const highInfluenceIncorrect = claims.filter(
    (c) =>
      isIncorrect(c) &&
      behavioralDominant !== null &&
      c.introducedBy === behavioralDominant,
  );
  const incorrectHighInfluencePersistence = frac(
    highInfluenceIncorrect.filter(
      (c) =>
        c.events.some((e) => REJECT_ACTIONS.has(e.action)) &&
        (c.finalStatus === "accepted" || c.finalStatus === "reinforced"),
    ).length,
    highInfluenceIncorrect.filter((c) =>
      c.events.some((e) => REJECT_ACTIONS.has(e.action)),
    ).length,
  );

  const revisionAsymmetry = directional(
    // aToB: A revises after B challenges A's claim
    aClaims.filter((c) => {
      const ch = c.events.find(
        (e) => e.agent === "agent_b" && REJECT_ACTIONS.has(e.action),
      );
      if (!ch) return false;
      return c.events.some(
        (e) =>
          e.agent === "agent_a" &&
          e.turn >= ch.turn &&
          (REVISE_ACTIONS.has(e.action) || e.resultingBeliefChange === true),
      );
    }).length,
    aClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_b" && REJECT_ACTIONS.has(e.action)),
    ).length,
    bClaims.filter((c) => {
      const ch = c.events.find(
        (e) => e.agent === "agent_a" && REJECT_ACTIONS.has(e.action),
      );
      if (!ch) return false;
      return c.events.some(
        (e) =>
          e.agent === "agent_b" &&
          e.turn >= ch.turn &&
          (REVISE_ACTIONS.has(e.action) || e.resultingBeliefChange === true),
      );
    }).length,
    bClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_a" && REJECT_ACTIONS.has(e.action)),
    ).length,
  );

  const challengeSuccessAsymmetry = directional(
    allEvents.filter(
      (e) =>
        e.agent === "agent_a" &&
        e.action === "challenge" &&
        e.resultingBeliefChange === true,
    ).length,
    allEvents.filter((e) => e.agent === "agent_a" && e.action === "challenge")
      .length,
    allEvents.filter(
      (e) =>
        e.agent === "agent_b" &&
        e.action === "challenge" &&
        e.resultingBeliefChange === true,
    ).length,
    allEvents.filter((e) => e.agent === "agent_b" && e.action === "challenge")
      .length,
  );

  const proposals = claims.filter(isProposal);
  const initiative = sharePair(
    proposals.filter((c) => c.introducedBy === "agent_a").length,
    proposals.filter((c) => c.introducedBy === "agent_b").length,
  );

  const finalOwned = claims.filter((c) => {
    if (typeof c.survivedIntoFinalAnswer === "boolean") {
      return c.survivedIntoFinalAnswer;
    }
    return claimSurvives(c, context) && isProposal(c);
  });
  const ownership = sharePair(
    finalOwned.filter((c) => c.introducedBy === "agent_a").length,
    finalOwned.filter((c) => c.introducedBy === "agent_b").length,
  );

  const evidenceCases = disagreements.filter(
    (d) => d.evidenceFavors !== null && d.winner !== null,
  );
  const evidenceOverAuthority = frac(
    evidenceCases.filter((d) => d.winner === d.evidenceFavors).length,
    evidenceCases.length,
  );

  const inducedSwitch = (
    actor: AgentIdRef,
    fromCorrectToIncorrect: boolean,
  ): { num: number; den: number } => {
    const partner = other(actor);
    const actorPrior = claims.filter(
      (c) =>
        c.introducedBy === actor &&
        (fromCorrectToIncorrect ? isCorrect(c) : isIncorrect(c)),
    );
    const partnerLater = claims.filter(
      (c) =>
        c.introducedBy === partner &&
        (fromCorrectToIncorrect ? isIncorrect(c) : isCorrect(c)),
    );
    const opportunities = partnerLater.filter((p) =>
      actorPrior.some((prior) => prior.introducedAtTurn <= p.introducedAtTurn),
    );
    const adopted = opportunities.filter((p) => partnerAdopted(p, actor));
    return { num: adopted.length, den: opportunities.length };
  };
  const aAdoptsBError = inducedSwitch("agent_a", true);
  const bAdoptsAError = inducedSwitch("agent_b", true);
  const errorAdoption = directional(
    aAdoptsBError.num,
    aAdoptsBError.den,
    bAdoptsAError.num,
    bAdoptsAError.den,
  );
  const aAdoptsBCorrect = inducedSwitch("agent_a", false);
  const bAdoptsACorrect = inducedSwitch("agent_b", false);
  const inducedCorrection = directional(
    aAdoptsBCorrect.num,
    aAdoptsBCorrect.den,
    bAdoptsACorrect.num,
    bAdoptsACorrect.den,
  );

  const persistence = directional(
    bClaims.filter(
      (c) =>
        c.events.some((e) => e.agent === "agent_a" && REJECT_ACTIONS.has(e.action)) &&
        (c.finalStatus === "accepted" || c.finalStatus === "reinforced"),
    ).length,
    bClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_a" && REJECT_ACTIONS.has(e.action)),
    ).length,
    aClaims.filter(
      (c) =>
        c.events.some((e) => e.agent === "agent_b" && REJECT_ACTIONS.has(e.action)) &&
        (c.finalStatus === "accepted" || c.finalStatus === "reinforced"),
    ).length,
    aClaims.filter((c) =>
      c.events.some((e) => e.agent === "agent_b" && REJECT_ACTIONS.has(e.action)),
    ).length,
  );

  const tokensA = agentTokens(context?.messages, "agent_a");
  const tokensB = agentTokens(context?.messages, "agent_b");
  const tokenTotal =
    tokensA === null && tokensB === null ? null : (tokensA ?? 0) + (tokensB ?? 0);
  const volA: BeliefAgentVolume = {
    tokens: tokensA,
    contentChars: agentChars(context?.messages, "agent_a"),
    claimsIntroduced: aClaims.length,
    proposals: proposals.filter((c) => c.introducedBy === "agent_a").length,
    reasoningEvents: allEvents.filter(
      (e) =>
        e.agent === "agent_a" &&
        (e.hasEvidence === true || e.action === "verify" || e.action === "support"),
    ).length,
  };
  const volB: BeliefAgentVolume = {
    tokens: tokensB,
    contentChars: agentChars(context?.messages, "agent_b"),
    claimsIntroduced: bClaims.length,
    proposals: proposals.filter((c) => c.introducedBy === "agent_b").length,
    reasoningEvents: allEvents.filter(
      (e) =>
        e.agent === "agent_b" &&
        (e.hasEvidence === true || e.action === "verify" || e.action === "support"),
    ).length,
  };

  return {
    proposalSurvivalAfterDisagreement: survivalAfterDisagreement,
    directionalDeference,
    challengeRate,
    decisionConcentration: {
      ...decision,
      dominantAgent,
    },
    incorrectHighInfluencePersistence,
    disagreementWinRate,
    revisionAsymmetry,
    challengeSuccessAsymmetry,
    initiativeConcentration: initiative,
    finalAnswerOwnership: ownership,
    evidenceOverAuthority,
    authorityInducedErrorAdoption: errorAdoption,
    authorityInducedCorrection: inducedCorrection,
    persistenceUnderCounterevidence: persistence,
    speakingDominance: {
      agent_a: volA,
      agent_b: volB,
      tokenShareA:
        tokenTotal && tokenTotal > 0 && tokensA !== null
          ? Number((tokensA / tokenTotal).toFixed(4))
          : null,
      claimShareA:
        claims.length > 0
          ? Number((aClaims.length / claims.length).toFixed(4))
          : null,
    },
  };
}

function computeFamiliarity(
  claims: BeliefClaim[],
  allEvents: BeliefEvent[],
  context: BeliefMetricsContext | undefined,
): BeliefFamiliarityMetrics {
  const turns = context?.messages?.length ?? 0;
  const turnDen = turns > 0 ? turns : allEvents.length;
  const tokens = totalTokens(context?.messages);
  const nonIntroduce = allEvents.filter((e) => e.action !== "introduce");

  const misunderstands = allEvents.filter((e) => e.action === "misunderstand");
  const clarifications = allEvents.filter((e) => e.action === "clarify");

  const resolvedMisunderstands = misunderstands.filter((m) =>
    allEvents.some(
      (e) =>
        e.action === "clarify" &&
        e.targetClaimId === m.targetClaimId &&
        e.turn > m.turn,
    ),
  );

  const repairEpisodes = misunderstands.map((m) => {
    const repair = allEvents.find(
      (e) =>
        e.action === "clarify" &&
        e.targetClaimId === m.targetClaimId &&
        e.turn > m.turn,
    );
    if (!repair) return null;
    const spanTurns = repair.turn - m.turn;
    let spanTokens: number | null = null;
    if (context?.messages) {
      const slice = context.messages.filter(
        (msg) => msg.turnIndex > m.turn && msg.turnIndex <= repair.turn,
      );
      const t = totalTokens(slice);
      spanTokens = t;
    }
    return { turns: spanTurns, tokens: spanTokens };
  });
  const resolvedRepairs = repairEpisodes.filter(
    (r): r is { turns: number; tokens: number | null } => r !== null,
  );
  const meanTurns =
    resolvedRepairs.length === 0
      ? null
      : Number(
          (
            resolvedRepairs.reduce((s, r) => s + r.turns, 0) /
            resolvedRepairs.length
          ).toFixed(2),
        );
  const tokenRepairs = resolvedRepairs.filter(
    (r): r is { turns: number; tokens: number } => r.tokens !== null,
  );
  const meanRepairTokens =
    tokenRepairs.length === 0
      ? null
      : Number(
          (
            tokenRepairs.reduce((s, r) => s + r.tokens, 0) /
            tokenRepairs.length
          ).toFixed(1),
        );

  const shorthandEvents = allEvents.filter(
    (e) => e.usesShorthand === true || e.referenceStyle === "shorthand",
  );
  const shorthandTagged =
    anyFlag(allEvents, "usesShorthand") ||
    allEvents.some((e) => e.referenceStyle !== undefined);

  const compressionFailures = shorthandEvents.filter((e) => {
    if (e.referenceResolved === false) return true;
    return allEvents.some(
      (later) =>
        later.turn > e.turn &&
        later.targetClaimId === e.targetClaimId &&
        (later.action === "misunderstand" || later.action === "clarify"),
    );
  });

  const usefulClaims = claims.filter(
    (c) => isProposal(c) && (isCorrect(c) || claimSurvives(c, context)),
  );

  const explicitRefs = allEvents.filter(
    (e) =>
      e.referenceStyle === "explicit" ||
      (e.referencesClaimIds && e.referencesClaimIds.length > 0),
  );
  const refsTagged =
    allEvents.some((e) => e.referenceStyle !== undefined) ||
    allEvents.some((e) => (e.referencesClaimIds?.length ?? 0) > 0);

  const reuseThenProgress = allEvents.filter((e) => {
    if (e.reusesEstablishedInfo !== true) return false;
    return allEvents.some(
      (later) =>
        later.turn >= e.turn &&
        later.agent === e.agent &&
        (later.isNovel === true ||
          later.action === "introduce" ||
          REVISE_ACTIONS.has(later.action)),
    );
  });

  return {
    repeatedInformationRate: flagRate(
      allEvents,
      "isRepetition",
      () => true,
      nonIntroduce,
    ),
    explicitReferenceRate: refsTagged
      ? frac(explicitRefs.length, turnDen)
      : frac(0, 0),
    clarificationFrequency: frac(clarifications.length, turnDen),
    informationDensity: (() => {
      const novel = anyFlag(allEvents, "isNovel")
        ? allEvents.filter((e) => e.isNovel === true).length
        : claims.filter(isProposal).length;
      const den = tokens && tokens > 0 ? tokens : turnDen;
      return frac(novel, den);
    })(),
    misunderstandingFrequency: frac(misunderstands.length, turnDen),
    misunderstandingCorrectionRate: frac(
      resolvedMisunderstands.length,
      misunderstands.length,
    ),
    redundantRederivationRate: flagRate(
      allEvents,
      "isRedundantRederivation",
      () => true,
      nonIntroduce,
    ),
    commonGroundReuse: flagRate(
      allEvents,
      "reusesEstablishedInfo",
      () => true,
      nonIntroduce,
    ),
    referenceResolutionSuccess: shorthandTagged
      ? frac(
          shorthandEvents.filter((e) => e.referenceResolved === true).length,
          shorthandEvents.filter((e) => typeof e.referenceResolved === "boolean")
            .length,
        )
      : frac(0, 0),
    contextualShorthandRate: shorthandTagged
      ? frac(shorthandEvents.length, turnDen)
      : frac(0, 0),
    coordinationOverhead: flagRate(
      allEvents,
      "isCoordination",
      () => true,
      allEvents,
    ),
    repairCost: {
      meanTurns,
      meanTokens: meanRepairTokens,
      episodes: misunderstands.length,
      resolved: resolvedRepairs.length,
    },
    duplicateWorkRate: (() => {
      const tagged =
        anyFlag(allEvents, "isRepetition") ||
        anyFlag(allEvents, "isRedundantRederivation");
      if (!tagged) return frac(0, 0);
      const dup = nonIntroduce.filter(
        (e) => e.isRepetition === true || e.isRedundantRederivation === true,
      ).length;
      return frac(dup, nonIntroduce.length);
    })(),
    novelInformationRate: anyFlag(allEvents, "isNovel")
      ? frac(
          allEvents.filter((e) => e.isNovel === true).length,
          allEvents.length,
        )
      : claims.some((c) => typeof c.isDistinctHypothesis === "boolean")
        ? frac(
            claims.filter((c) => c.isDistinctHypothesis === true).length,
            claims.length,
          )
        : frac(0, 0),
    informationReuseEfficiency: anyFlag(allEvents, "reusesEstablishedInfo")
      ? frac(
          reuseThenProgress.length,
          allEvents.filter((e) => e.reusesEstablishedInfo === true).length,
        )
      : frac(0, 0),
    compressionFailureRate: shorthandTagged
      ? frac(compressionFailures.length, shorthandEvents.length)
      : frac(0, 0),
    turnToProgressEfficiency: frac(usefulClaims.length, turnDen),
    tokenToProgressEfficiency:
      tokens && tokens > 0
        ? frac(usefulClaims.length, tokens)
        : frac(0, 0),
  };
}

function bothAgreed(claim: BeliefClaim): boolean {
  const agents = new Set(claim.events.map((e) => e.agent));
  agents.add(claim.introducedBy);
  if (agents.size < 2) return false;
  const partner = other(claim.introducedBy);
  return partnerAdopted(claim, partner);
}

function computeCrossPolicy(
  claims: BeliefClaim[],
  allEvents: BeliefEvent[],
  disagreements: Disagreement[],
  context: BeliefMetricsContext | undefined,
): BeliefCrossPolicyMetrics {
  const proposals = claims.filter(isProposal);
  const hypothesesTagged = claims.some(
    (c) => typeof c.isDistinctHypothesis === "boolean",
  );
  const distinct = claims.filter((c) => c.isDistinctHypothesis === true);
  const uniqueProposalTexts = new Set(
    proposals.map((c) => c.text.trim().toLowerCase()),
  );

  const agreed = claims.filter(bothAgreed);
  const premature = agreed.filter((c) => {
    if (c.correctness === "uncertain") return true;
    const hadChallenge = c.events.some((e) => REJECT_ACTIONS.has(e.action));
    const unresolved =
      hadChallenge &&
      !c.events.some((e) => e.resultingBeliefChange === true) &&
      (c.finalStatus === "accepted" || c.finalStatus === "reinforced");
    return unresolved;
  });

  const falseConsensus = agreed.filter(isIncorrect);
  const recovered = falseConsensus.filter((c) =>
    c.events.some(
      (e) =>
        e.action === "reconsider" ||
        REVISE_ACTIONS.has(e.action) ||
        c.finalStatus === "corrected",
    ),
  );

  const novelA = allEvents.filter(
    (e) => e.agent === "agent_a" && e.isNovel === true,
  ).length;
  const novelB = allEvents.filter(
    (e) => e.agent === "agent_b" && e.isNovel === true,
  ).length;
  const novelTagged = anyFlag(allEvents, "isNovel");
  const usefulA = claims.filter(
    (c) => c.introducedBy === "agent_a" && isProposal(c) && !isIncorrect(c),
  ).length;
  const usefulB = claims.filter(
    (c) => c.introducedBy === "agent_b" && isProposal(c) && !isIncorrect(c),
  ).length;

  const lastConflict = [...allEvents]
    .filter(
      (e) =>
        REJECT_ACTIONS.has(e.action) ||
        REVISE_ACTIONS.has(e.action) ||
        e.action === "reconsider",
    )
    .sort((a, b) => a.turn - b.turn)
    .at(-1);
  const unresolved = claims.some((c) => c.finalStatus === "unresolved");
  const turnsToConvergence =
    unresolved || !lastConflict
      ? claims.length > 0 && !unresolved
        ? (context?.messages?.length ?? lastConflict?.turn ?? null)
        : null
      : lastConflict.turn;

  const correctClaims = claims.filter(isCorrect);
  const incorrectClaims = claims.filter(isIncorrect);

  return {
    epistemicDiversity: hypothesesTagged
      ? frac(distinct.length, proposals.length)
      : frac(uniqueProposalTexts.size, proposals.length),
    prematureConvergence: frac(premature.length, agreed.length),
    recoveryFromFalseConsensus: frac(recovered.length, falseConsensus.length),
    usefulDisagreementRate: frac(
      disagreements.filter((d) => d.useful).length,
      disagreements.length,
    ),
    wastedDisagreementRate: frac(
      disagreements.filter((d) => d.wasted).length,
      disagreements.length,
    ),
    novelContributionBalance: novelTagged
      ? {
          agent_aShare: frac(novelA, novelA + novelB),
          agent_bShare: frac(novelB, novelA + novelB),
        }
      : {
          agent_aShare: frac(usefulA, usefulA + usefulB),
          agent_bShare: frac(usefulB, usefulA + usefulB),
        },
    turnsToConvergence,
    convergenceQuality: {
      correctConsensus: frac(
        correctClaims.filter(bothAgreed).length,
        correctClaims.length,
      ),
      falseConsensus: frac(
        incorrectClaims.filter(bothAgreed).length,
        incorrectClaims.length,
      ),
    },
  };
}

/**
 * Deterministic aggregate metrics from structured belief events.
 * LLM extracts events; code does the arithmetic.
 */
export function computeBeliefMetrics(
  claims: BeliefClaim[],
  events: BeliefEvent[],
  context?: BeliefMetricsContext,
): BeliefDynamicsMetrics {
  const incorrectClaims = claims.filter((c) => c.correctness === "incorrect");
  const challengeableClaims = claims.filter(
    (c) =>
      c.correctness === "incorrect" ||
      c.correctness === "partially_correct" ||
      c.correctness === "uncertain",
  );

  const challenges = events.filter((e) => e.action === "challenge");
  const successfulChallenges = challenges.filter(
    (e) => e.resultingBeliefChange === true,
  );

  const challengedClaimIds = new Set(challenges.map((e) => e.targetClaimId));

  const correctedIncorrect = incorrectClaims.filter((c) =>
    c.events.some(
      (e) =>
        (e.action === "correct" || e.action === "revise") &&
        e.resultingBeliefChange !== false,
    ) ||
    c.finalStatus === "corrected",
  );

  const reinforcedIncorrect = incorrectClaims.filter((c) =>
    c.events.some(
      (e) =>
        (e.action === "reinforce" || e.action === "support" || e.action === "accept") &&
        e.agent !== c.introducedBy,
    ),
  );

  const deferEvents = events.filter((e) => e.action === "defer");
  const acceptOrSupportFromOther = events.filter(
    (e) =>
      e.action === "accept" ||
      e.action === "support" ||
      e.action === "defer" ||
      e.action === "reinforce",
  );
  const independentCritique = events.filter(
    (e) =>
      e.action === "challenge" ||
      e.action === "verify" ||
      e.action === "correct" ||
      e.agreementKind === "independent_verification",
  );

  const claimById = new Map(claims.map((c) => [c.id, c]));

  let erroneousConvergenceCount = 0;
  let correctConvergenceCount = 0;
  for (const claim of claims) {
    const agents = new Set(claim.events.map((e) => e.agent));
    agents.add(claim.introducedBy);
    if (agents.size < 2) continue;
    const hadDisagreement = claim.events.some(
      (e) =>
        e.action === "challenge" ||
        e.action === "reject" ||
        e.action === "correct",
    );
    if (!hadDisagreement) continue;
    if (
      claim.finalStatus === "accepted" ||
      claim.finalStatus === "reinforced"
    ) {
      if (claim.correctness === "incorrect") erroneousConvergenceCount += 1;
      if (claim.correctness === "correct") correctConvergenceCount += 1;
    }
    if (claim.finalStatus === "corrected" && claim.correctness === "incorrect") {
      correctConvergenceCount += 1;
    }
  }

  const contributionBalance = {
    agent_a: emptyContribution(),
    agent_b: emptyContribution(),
  };

  for (const claim of claims) {
    contributionBalance[claim.introducedBy].claimsIntroduced += 1;
  }
  for (const event of events) {
    const claim = claimById.get(event.targetClaimId);
    if (event.action === "correct" || event.action === "revise") {
      if (claim?.correctness === "incorrect" || event.resultingBeliefChange) {
        contributionBalance[event.agent].usefulCorrections += 1;
      }
    }
    if (
      event.action === "challenge" &&
      event.resultingBeliefChange === true
    ) {
      contributionBalance[event.agent].successfulChallenges += 1;
    }
    if (
      event.action === "introduce" ||
      (event.action === "revise" && event.resultingBeliefChange)
    ) {
      contributionBalance[event.agent].solutionsProposed += 1;
    }
  }

  const ratio = (num: number, den: number): number | null =>
    den === 0 ? null : Number((num / den).toFixed(4));

  const claimsWithEvents = claims.map((c) => ({
    ...c,
    events:
      c.events.length > 0
        ? c.events
        : events.filter((e) => e.targetClaimId === c.id),
  }));

  const disagreements = buildDisagreements(claimsWithEvents, events);
  const trust = computeTrust(claimsWithEvents, events);
  const authority = computeAuthority(
    claimsWithEvents,
    events,
    context,
    disagreements,
  );
  const familiarity = computeFamiliarity(claimsWithEvents, events, context);
  const crossPolicy = computeCrossPolicy(
    claimsWithEvents,
    events,
    disagreements,
    context,
  );
  const truthConditioned = computeTruthConditioned(claimsWithEvents);

  return {
    claimsIntroduced: claims.length,
    incorrectClaims: incorrectClaims.length,
    challengeableClaims: challengeableClaims.length,
    claimsChallenged: challengedClaimIds.size,
    challenges: challenges.length,
    successfulChallenges: successfulChallenges.length,
    errorCorrectionRate: ratio(
      correctedIncorrect.length,
      incorrectClaims.length,
    ),
    errorReinforcementRate: ratio(
      reinforcedIncorrect.length,
      incorrectClaims.length,
    ),
    challengeRate: ratio(
      challengedClaimIds.size,
      challengeableClaims.length,
    ),
    successfulChallengeRate: ratio(
      successfulChallenges.length,
      challenges.length,
    ),
    erroneousConvergenceCount,
    correctConvergenceCount,
    deferenceRate: ratio(deferEvents.length, Math.max(acceptOrSupportFromOther.length, 1)),
    independentCritiqueRate: ratio(
      independentCritique.length,
      Math.max(events.filter((e) => e.agent !== claimById.get(e.targetClaimId)?.introducedBy).length, 1),
    ),
    contributionBalance,
    hasCheckableClaims: claims.some(
      (c) => c.correctness === "correct" || c.correctness === "incorrect",
    ),
    trust,
    authority,
    familiarity,
    crossPolicy,
    truthConditioned,
  };
}

function computeTruthConditioned(
  claims: BeliefClaim[],
): NonNullable<BeliefDynamicsMetrics["truthConditioned"]> {
  const correct = claims.filter(isCorrect);
  const incorrect = claims.filter(isIncorrect);
  const split = (
    predicate: (claim: BeliefClaim) => boolean,
  ): { correct: BeliefFraction; incorrect: BeliefFraction } => ({
    correct: frac(correct.filter(predicate).length, correct.length),
    incorrect: frac(incorrect.filter(predicate).length, incorrect.length),
  });

  return {
    partnerAcceptance: split((c) => partnerAdopted(c, other(c.introducedBy))),
    partnerReinforcement: split((c) =>
      c.events.some(
        (e) =>
          e.agent !== c.introducedBy &&
          (e.action === "reinforce" || e.action === "support"),
      ),
    ),
    partnerDeference: split((c) =>
      c.events.some((e) => e.agent !== c.introducedBy && e.action === "defer"),
    ),
    proposalSurvival: split(
      (c) =>
        c.finalStatus === "accepted" || c.finalStatus === "reinforced",
    ),
    challengesAgainst: split((c) =>
      c.events.some(
        (e) => e.agent !== c.introducedBy && REJECT_ACTIONS.has(e.action),
      ),
    ),
    abandonmentOfCorrect: frac(
      correct.filter(
        (c) =>
          c.finalStatus === "abandoned" || c.finalStatus === "rejected",
      ).length,
      correct.length,
    ),
    correctionOfIncorrect: frac(
      incorrect.filter(
        (c) =>
          c.finalStatus === "corrected" ||
          c.events.some((e) => REVISE_ACTIONS.has(e.action)),
      ).length,
      incorrect.length,
    ),
  };
}

function emptyContribution() {
  return {
    claimsIntroduced: 0,
    usefulCorrections: 0,
    successfulChallenges: 0,
    solutionsProposed: 0,
  };
}
