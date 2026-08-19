/**
 * Opportunity/event/rate arithmetic. Empty opportunity sets yield null rates.
 */
import type {
  DirectionalOpportunity,
  OpportunityRate,
} from "./types";

export function opportunity(
  events: number,
  opportunities: number,
): OpportunityRate {
  if (opportunities <= 0) {
    return { opportunities: 0, events: 0, rate: null };
  }
  return {
    opportunities,
    events,
    rate: Number((events / opportunities).toFixed(4)),
  };
}

export function directionalOpportunity(
  aEvents: number,
  aOpps: number,
  bEvents: number,
  bOpps: number,
): DirectionalOpportunity {
  return {
    aToB: opportunity(aEvents, aOpps),
    bToA: opportunity(bEvents, bOpps),
    overall: opportunity(aEvents + bEvents, aOpps + bOpps),
  };
}

export const DENOMINATORS = {
  adoption:
    "Partner-originated reasoning objects that this agent could adopt.",
  verification:
    "Adoptions by this agent (verification = independent support/check before or at adoption).",
  challenge:
    "Partner-originated reasoning objects that this agent could challenge.",
  correction:
    "Objects that were challenged or marked unsupported.",
  disagreement:
    "Partner-originated reasoning objects (a disagreement is a challenge of one of those objects). Resolution rates then use disagreements as the opportunity set.",
  clarification:
    "Agent turns (clarification requests / questions).",
  repetition:
    "Agent turns (restated existing objects without graph mutation).",
  persuasion:
    "Cross-agent adoptions (persuasion = challenge or independent support before adoption).",
  deference:
    "Cross-agent adoptions (deference = adoption without independent evaluation).",
} as const;
