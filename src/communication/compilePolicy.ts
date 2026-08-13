import type { AgentId } from "../agents/types";
import {
  authorityInstructionsForAgent,
  authorityRelationFromValue,
  bandFromValue,
  familiarityInstructions,
  trustInstructions,
} from "./descriptions";
import { assertValidPolicy } from "./policy";
import type {
  CompiledAgentPolicy,
  CompiledCommunicationPolicy,
  CommunicationPolicy,
  PolicyBand,
} from "./types";

function buildAgentPolicy(
  agentId: AgentId,
  trustBand: PolicyBand,
  familiarityBand: PolicyBand,
  authorityRelation: ReturnType<typeof authorityRelationFromValue>,
): CompiledAgentPolicy {
  const other = agentId === "agent_a" ? "Agent B" : "Agent A";
  const trust = trustInstructions(trustBand, other);
  const authority = authorityInstructionsForAgent(agentId, authorityRelation);
  const familiarity = familiarityInstructions(familiarityBand, other);
  const block = [
    "Trust",
    trust,
    "",
    "Authority",
    authority,
    "",
    "Familiarity",
    familiarity,
  ].join("\n");

  return { trust, authority, familiarity, block };
}

/**
 * Deterministic CommunicationPolicy → natural-language behavioral policy.
 * Numeric slider values are not included in the compiled text.
 * Trust is directional: Agent A compiles from trustA, Agent B from trustB.
 * Familiarity is symmetric: both agents receive complementary wording of F.
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
    agentA: buildAgentPolicy(
      "agent_a",
      trustBandA,
      familiarityBand,
      authorityRelation,
    ),
    agentB: buildAgentPolicy(
      "agent_b",
      trustBandB,
      familiarityBand,
      authorityRelation,
    ),
  };
}
