import { compileCommunicationPolicy } from "../communication/compilePolicy";
import type { CommunicationPolicy } from "../communication/types";
import type { AgentDefinition, AgentId, AgentPromptPair } from "./types";

function agentLabel(id: AgentId): string {
  return id === "agent_a" ? "Agent A" : "Agent B";
}

function otherLabel(id: AgentId): string {
  return id === "agent_a" ? "Agent B" : "Agent A";
}

/**
 * Builds the full system prompt for one agent from a communication policy.
 * Problem text is supplied at runtime separately (user/context message).
 */
export function buildAgentPrompt(
  agentId: AgentId,
  policy: CommunicationPolicy,
): string {
  const compiled = compileCommunicationPolicy(policy);
  const policyBlock =
    agentId === "agent_a" ? compiled.agentA : compiled.agentB;

  return [
    `You are ${agentLabel(agentId)}.`,
    "",
    compiled.sharedContext,
    "",
    `The other agent is ${otherLabel(agentId)}. You will alternate turns discussing the problem until you reach a solution or the interaction ends.`,
    "",
    "Stay a general-purpose reasoning agent. Do not invent specialized job titles, organizational roles, or asymmetric expertise unless the communication policy itself induces them.",
    "",
    policyBlock,
    "",
    "## Interaction guidelines",
    "- Reason carefully about the shared problem.",
    "- Address the other agent directly when useful.",
    "- Tentative proposals are welcome; revise them when crossings, clues, or your partner reveal a conflict.",
    "- Share information that helps your partner make progress on other parts of the problem — do not treat sub-parts as isolated.",
    "- Emitting FINAL_ANSWER ends the interaction immediately: your partner will not see that turn and cannot reply. Never ask for review, confirmation, or further discussion in the same message as FINAL_ANSWER.",
    "- Only emit FINAL_ANSWER when the joint solution is locked in and you need no further input. If you still want your partner to check or revise anything, keep discussing without FINAL_ANSWER.",
    "- When ready, follow the format requested in the problem statement and begin the locked-in result with: FINAL_ANSWER:",
    "- Until then, continue productive collaboration within the communication policy. Do not emit FINAL_ANSWER early or as a draft.",
  ].join("\n");
}

export function buildAgentDefinition(
  agentId: AgentId,
  policy: CommunicationPolicy,
): AgentDefinition {
  return {
    id: agentId,
    label: agentLabel(agentId),
    systemPrompt: buildAgentPrompt(agentId, policy),
  };
}

export function buildAgentPromptPair(
  policy: CommunicationPolicy,
): AgentPromptPair {
  return {
    agentA: buildAgentPrompt("agent_a", policy),
    agentB: buildAgentPrompt("agent_b", policy),
  };
}
