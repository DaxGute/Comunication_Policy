/**
 * Builds the full BeliefDynamicsMetrics object from extracted claims/events.
 *
 * LLM extraction is in evaluator.ts; this module only does deterministic arithmetic.
 */
import type {
  BeliefClaim,
  BeliefDynamicsMetrics,
  BeliefEvent,
  BeliefFraction,
} from "../types";
import {
  REJECT_ACTIONS,
  REVISE_ACTIONS,
  buildDisagreements,
  frac,
  isCorrect,
  isIncorrect,
  other,
  partnerAdopted,
  type BeliefMetricsContext,
} from "./metricsShared";
import {
  computeAuthority,
  computeCrossPolicy,
  computeFamiliarity,
  computeTrust,
} from "./policyMetrics";

export type { BeliefMetricsContext } from "./metricsShared";

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
