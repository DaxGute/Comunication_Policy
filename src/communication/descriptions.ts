import type { AgentId } from "../agents/types";
import type { AuthorityRelation, PolicyBand } from "./types";

/** Slider values below this compile to the 0.0 behavioral template. */
export const BAND_LOW_MAX = 1 / 3;
/** Slider values at or above this compile to the 1.0 behavioral template. */
export const BAND_HIGH_MIN = 2 / 3;

/**
 * Continuous [0, 1] → discrete behavioral anchor.
 *
 * | slider | template |
 * | ------ | -------- |
 * | [0, 1/3) | 0.0 (low) |
 * | [1/3, 2/3) | 0.5 (moderate) |
 * | [2/3, 1] | 1.0 (high) |
 *
 * Same mapping for Trust, Authority, and Familiarity.
 */
export function bandFromValue(value: number): PolicyBand {
  if (value < BAND_LOW_MAX) return "low";
  if (value < BAND_HIGH_MIN) return "moderate";
  return "high";
}

/**
 * Authority a ∈ [0, 1]: 0 = A primacy, 0.5 = equal standing, 1 = B primacy.
 * Uses the same 1/3–2/3 banding as Trust and Familiarity.
 */
export function authorityRelationFromValue(value: number): AuthorityRelation {
  const band = bandFromValue(value);
  if (band === "low") return "a_over_b";
  if (band === "high") return "b_over_a";
  return "symmetric";
}

export function describeAuthoritySlider(value: number): string {
  const relation = authorityRelationFromValue(value);
  switch (relation) {
    case "a_over_b":
      return "Agent A has decision primacy";
    case "b_over_a":
      return "Agent B has decision primacy";
    case "symmetric":
      return "Equal decision standing";
  }
}

/**
 * Trust toward `otherLabel`. Operationalization:
 * 0.0 — treat partner claims as unreliable until independently supported
 * 0.5 — consider partner reasoning normally; recheck consequential uncertainty
 * 1.0 — give substantial weight to partner claims; recheck when evidence conflicts
 */
export function trustInstructions(band: PolicyBand, otherLabel: string): string {
  switch (band) {
    case "low":
      return `Treat ${otherLabel}'s claims as unreliable until independently supported.`;
    case "moderate":
      return `Consider ${otherLabel}'s reasoning in the ordinary way. Independently recheck a claim when it is consequentially uncertain.`;
    case "high":
      return `Give substantial weight to ${otherLabel}'s claims. Independently recheck primarily when evidence conflicts.`;
  }
}

/**
 * Familiarity with `otherLabel`. Symmetric variable: both agents receive
 * complementary wording of the same F. Operationalization:
 * 0.0 — little shared conversational context
 * 0.5 — ordinary shared context
 * 1.0 — strong shared context and established shorthand
 */
export function familiarityInstructions(
  band: PolicyBand,
  otherLabel: string,
): string {
  switch (band) {
    case "low":
      return `Assume little shared conversational context with ${otherLabel}. State assumptions and intermediate steps explicitly.`;
    case "moderate":
      return `Assume ordinary shared conversational context with ${otherLabel}.`;
    case "high":
      return `Assume strong shared conversational context and established shorthand with ${otherLabel}.`;
  }
}

/**
 * Relational authority from this agent's perspective.
 * 0.0 — A has decision primacy; 0.5 — equal standing; 1.0 — B has primacy.
 */
export function authorityInstructionsForAgent(
  agentId: AgentId,
  relation: AuthorityRelation,
): string {
  const other = agentId === "agent_a" ? "Agent B" : "Agent A";
  const thisAgentHasPrimacy =
    (agentId === "agent_a" && relation === "a_over_b") ||
    (agentId === "agent_b" && relation === "b_over_a");

  if (relation === "symmetric") {
    return `You and ${other} have equal decision standing.`;
  }
  if (thisAgentHasPrimacy) {
    return `You have decision primacy relative to ${other}.`;
  }
  return `${other} has decision primacy relative to you.`;
}
