/**
 * Shared claim/event predicates and arithmetic for belief-dynamics metrics.
 *
 * Policy-specific aggregates (trust/authority/familiarity) live in policyMetrics.
 */
import type { ConversationMessage } from "../../experiment/types";
import type {
  AgentIdRef,
  BeliefClaim,
  BeliefDirectionalFraction,
  BeliefEvent,
  BeliefFraction,
} from "../types";

export type BeliefMetricsContext = {
  messages?: ConversationMessage[];
  finalAnswer?: string;
};

export const ACCEPT_ACTIONS = new Set([
  "accept",
  "reinforce",
  "defer",
]);
export const REJECT_ACTIONS = new Set(["reject", "challenge"]);
export const REVISE_ACTIONS = new Set(["revise", "correct"]);
export const INDEPENDENT_CHECK_ACTIONS = new Set(["verify"]);

export type Disagreement = {
  claim: BeliefClaim;
  introducer: AgentIdRef;
  challenger: AgentIdRef;
  winner: AgentIdRef | null;
  evidenceFavors: AgentIdRef | null;
  useful: boolean;
  wasted: boolean;
};

export function other(agent: AgentIdRef): AgentIdRef {
  return agent === "agent_a" ? "agent_b" : "agent_a";
}

export function frac(numerator: number, denominator: number): BeliefFraction {
  if (denominator <= 0) {
    return { numerator: 0, denominator: 0, rate: null };
  }
  return {
    numerator,
    denominator,
    rate: Number((numerator / denominator).toFixed(4)),
  };
}

export function directional(
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

export function isProposal(claim: BeliefClaim): boolean {
  if (claim.kind === "process") return false;
  if (claim.kind === "proposal") return true;
  return claim.correctness !== "not_applicable";
}

export function isCorrect(claim: BeliefClaim): boolean {
  return claim.correctness === "correct";
}

export function isIncorrect(claim: BeliefClaim): boolean {
  return claim.correctness === "incorrect";
}

export function partnerAdopted(claim: BeliefClaim, partner: AgentIdRef): boolean {
  return claim.events.some(
    (e) => e.agent === partner && ACCEPT_ACTIONS.has(e.action),
  );
}

export function partnerRejected(claim: BeliefClaim, partner: AgentIdRef): boolean {
  const rejected = claim.events.some(
    (e) => e.agent === partner && REJECT_ACTIONS.has(e.action),
  );
  if (!rejected) return false;
  return !partnerAdopted(claim, partner);
}

export function partnerVerified(claim: BeliefClaim, partner: AgentIdRef): boolean {
  return claim.events.some(
    (e) =>
      e.agent === partner &&
      (INDEPENDENT_CHECK_ACTIONS.has(e.action) ||
        e.agreementKind === "independent_verification" ||
        (e.action === "support" && e.hasEvidence === true)),
  );
}

export function firstPartnerAccept(
  claim: BeliefClaim,
  partner: AgentIdRef,
): BeliefEvent | undefined {
  return claim.events
    .filter((e) => e.agent === partner && ACCEPT_ACTIONS.has(e.action))
    .sort((a, b) => a.turn - b.turn)[0];
}

export function challengedBeforeAccept(
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

export function unsupportedAccept(
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

export function introducedWithEvidence(claim: BeliefClaim): boolean {
  if (typeof claim.introducedWithEvidence === "boolean") {
    return claim.introducedWithEvidence;
  }
  return claim.events.some(
    (e) => e.action === "introduce" && e.hasEvidence === true,
  );
}

export function claimSurvives(claim: BeliefClaim, context?: BeliefMetricsContext): boolean {
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

export function anyFlag<K extends keyof BeliefEvent>(
  events: BeliefEvent[],
  key: K,
): boolean {
  return events.some((e) => e[key] !== undefined);
}

export function flagRate(
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

export function agentTokens(
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

export function agentChars(
  messages: ConversationMessage[] | undefined,
  agent: AgentIdRef,
): number {
  if (!messages) return 0;
  return messages
    .filter((m) => m.agentId === agent)
    .reduce((sum, m) => sum + m.content.length, 0);
}

export function totalTokens(messages: ConversationMessage[] | undefined): number | null {
  const a = agentTokens(messages, "agent_a");
  const b = agentTokens(messages, "agent_b");
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function herfindahl(shareA: number | null): number | null {
  if (shareA === null) return null;
  const shareB = 1 - shareA;
  return Number((shareA * shareA + shareB * shareB).toFixed(4));
}

export function sharePair(
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

export function eventsFor(claim: BeliefClaim, all: BeliefEvent[]): BeliefEvent[] {
  if (claim.events.length > 0) return claim.events;
  return all.filter((e) => e.targetClaimId === claim.id);
}

export function buildDisagreements(
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

