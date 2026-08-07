import type {
  AuthorityRelation,
  CommunicationPolicy,
  PolicyBand,
} from "./types";
import { authorityWeightA, authorityWeightB } from "./policy";

export function bandFromValue(value: number): PolicyBand {
  if (value < 1 / 3) return "low";
  if (value < 2 / 3) return "moderate";
  return "high";
}

/**
 * Authority is directional:
 * 0.0 → A over B, 0.5 → symmetric, 1.0 → B over A
 */
export function authorityRelationFromValue(value: number): AuthorityRelation {
  if (value < 0.4) return "a_over_b";
  if (value > 0.6) return "b_over_a";
  return "symmetric";
}

export function describeAuthoritySlider(value: number): string {
  const relation = authorityRelationFromValue(value);
  switch (relation) {
    case "a_over_b":
      return "Agent A has greater decision weight";
    case "b_over_a":
      return "Agent B has greater decision weight";
    case "symmetric":
      return "Symmetric / peer-to-peer";
  }
}

export function trustInstructions(band: PolicyBand): string {
  switch (band) {
    case "low":
      return [
        "Treat claims from the other agent with healthy skepticism.",
        "Prefer independent verification before adopting their conclusions.",
        "Ask for explicit evidence or reasoning when claims are unsupported.",
        "Do not dismiss useful ideas, but require justification before relying on them.",
      ].join(" ");
    case "moderate":
      return [
        "Give the other agent a fair hearing and weigh their reasoning carefully.",
        "Accept well-supported claims without redundant re-derivation, but verify critical steps.",
        "Balance collaborative synthesis with independent judgment.",
      ].join(" ");
    case "high":
      return [
        "Default to substantial credence in the other agent's reasoning.",
        "Build on their contributions rather than restarting from scratch.",
        "Avoid redundant verification of points that appear carefully reasoned.",
        "Still retain independent judgment: high trust means collaborative synthesis, not blind agreement.",
      ].join(" ");
  }
}

export function familiarityInstructions(band: PolicyBand): string {
  switch (band) {
    case "low":
      return [
        "Communicate as collaborators who do not share much prior context.",
        "Make assumptions explicit; explain terms, constraints, and intermediate steps clearly.",
        "Prefer formal, self-contained explanations over shorthand.",
        "Ask clarifying questions when shared understanding is uncertain.",
      ].join(" ");
    case "moderate":
      return [
        "Communicate clearly while assuming a reasonable shared problem frame.",
        "Explain non-obvious steps; omit only the most obvious shared background.",
        "Use moderate compression: be concise without becoming telegraphic.",
      ].join(" ");
    case "high":
      return [
        "Communicate as long-term collaborators with high coordination expectations.",
        "Use compressed, efficient language and assume shared problem-solving conventions.",
        "Avoid redundant restatement of context the other agent likely already holds.",
        "Do not invent personal history or fake memories; familiarity here means communication style and coordination assumptions only.",
      ].join(" ");
  }
}

export function authorityInstructionsForAgent(
  agentId: "agent_a" | "agent_b",
  relation: AuthorityRelation,
): string {
  const isA = agentId === "agent_a";

  if (relation === "symmetric") {
    return [
      "Authority is peer-to-peer: neither agent has decision primacy.",
      "Argue on the merits, negotiate disagreements, and converge through joint reasoning.",
      "Surface important evidence, contradictions, and uncertainty freely.",
    ].join(" ");
  }

  const aHasAuthority = relation === "a_over_b";
  const thisAgentHasAuthority = isA ? aHasAuthority : !aHasAuthority;

  if (thisAgentHasAuthority) {
    return [
      "Your judgment carries greater decision weight in this collaboration.",
      "Lead toward a coherent final answer when the discussion must resolve.",
      "Still solicit and seriously consider the other agent's evidence and objections.",
      "Authority must not suppress useful disagreement; weigh dissent before deciding.",
    ].join(" ");
  }

  return [
    "The other agent's judgment carries greater decision weight in this collaboration.",
    "Seriously consider their decisions and framing when resolving disputes.",
    "You must still surface important evidence, contradictions, and uncertainty.",
    "Defer on resolution when appropriate, but never withhold critical information or clear errors.",
  ].join(" ");
}

export function sharedPolicyContext(policy: CommunicationPolicy): string {
  const aAuth = authorityWeightA(policy.authority);
  const bAuth = authorityWeightB(policy.authority);
  return [
    "You are one of exactly two general-purpose reasoning agents working on the same problem.",
    "There are no specialized roles, job titles, or asymmetric expertise assignments beyond the interpersonal communication policy below.",
    `Current policy parameters: trustA→B=${policy.trustA.toFixed(2)}, trustB→A=${policy.trustB.toFixed(2)}, authority=${policy.authority.toFixed(2)} (A-weight=${aAuth.toFixed(2)}, B-weight=${bAuth.toFixed(2)}; 0=A over B, 0.5=symmetric, 1=B over A), familiarity=${policy.familiarity.toFixed(2)}.`,
  ].join(" ");
}
