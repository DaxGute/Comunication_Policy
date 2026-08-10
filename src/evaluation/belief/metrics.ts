import type {
  BeliefClaim,
  BeliefDynamicsMetrics,
  BeliefEvent,
} from "../types";

/**
 * Deterministic aggregate metrics from structured belief events.
 * LLM extracts events; code does the arithmetic.
 */
export function computeBeliefMetrics(
  claims: BeliefClaim[],
  events: BeliefEvent[],
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
      // Corrected away from an incorrect claim counts as correct convergence.
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
