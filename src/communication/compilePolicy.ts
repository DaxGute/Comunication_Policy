import {
  authorityInstructionsForAgent,
  authorityRelationFromValue,
  bandFromValue,
  familiarityInstructions,
  sharedPolicyContext,
  trustInstructions,
} from "./descriptions";
import { assertValidPolicy } from "./policy";
import type {
  CommunicationPolicy,
  CompiledCommunicationPolicy,
  PolicyBand,
} from "./types";

function buildAgentPolicyBlock(
  agentId: "agent_a" | "agent_b",
  trustBand: PolicyBand,
  familiarityBand: PolicyBand,
  authorityRelation: ReturnType<typeof authorityRelationFromValue>,
): string {
  const label = agentId === "agent_a" ? "Agent A" : "Agent B";
  const other = agentId === "agent_a" ? "Agent B" : "Agent A";

  return [
    `## Interpersonal communication policy (${label})`,
    "",
    `You are interacting with ${other} under the following interpersonal constraints.`,
    "These constraints affect how you relate to the other agent — not your intelligence, expertise, or assigned task.",
    "",
    "### Trust",
    `This is your trust toward ${other} (independent of how much they trust you).`,
    trustInstructions(trustBand),
    "",
    "### Authority",
    authorityInstructionsForAgent(agentId, authorityRelation),
    "",
    "### Familiarity",
    familiarityInstructions(familiarityBand),
  ].join("\n");
}

/**
 * Single source of truth: CommunicationPolicy → natural-language instructions.
 * Trust is asymmetric: each agent receives only its own trust band.
 */
export function compileCommunicationPolicy(
  policy: CommunicationPolicy,
): CompiledCommunicationPolicy {
  assertValidPolicy(policy);

  const trustBandA = bandFromValue(policy.trustA);
  const trustBandB = bandFromValue(policy.trustB);
  const familiarityBand = bandFromValue(policy.familiarity);
  const authorityRelation = authorityRelationFromValue(policy.authority);

  return {
    policy,
    trustBandA,
    trustBandB,
    familiarityBand,
    authorityRelation,
    sharedContext: sharedPolicyContext(policy),
    agentA: buildAgentPolicyBlock(
      "agent_a",
      trustBandA,
      familiarityBand,
      authorityRelation,
    ),
    agentB: buildAgentPolicyBlock(
      "agent_b",
      trustBandB,
      familiarityBand,
      authorityRelation,
    ),
  };
}
