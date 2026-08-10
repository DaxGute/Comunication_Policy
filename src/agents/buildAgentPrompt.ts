import { compileCommunicationPolicy } from "../communication/compilePolicy";
import type { CommunicationPolicy } from "../communication/types";
import type { ProblemCategory } from "../problems/types";
import type { AgentDefinition, AgentId, AgentPromptPair } from "./types";

function agentLabel(id: AgentId): string {
  return id === "agent_a" ? "Agent A" : "Agent B";
}

function otherLabel(id: AgentId): string {
  return id === "agent_a" ? "Agent B" : "Agent A";
}

function collaborationGoal(category?: ProblemCategory): string {
  switch (category) {
    case "moral_philosophical":
      return "You will alternate turns discussing the dilemma until you reach a joint stance or the interaction ends. There is no single objectively correct answer.";
    case "proof":
      return "You will alternate turns co-authoring a rigorous joint proof until you lock in a final write-up or the interaction ends.";
    case "crossword":
      return "You will alternate turns solving the crossword until you reach a solution or the interaction ends.";
    default:
      return "You will alternate turns discussing the problem until you reach a solution or the interaction ends.";
  }
}

function interactionGuidelines(category?: ProblemCategory): string[] {
  const shared = [
    "## Interaction guidelines",
    "- Reason carefully about the shared problem.",
    "- Address the other agent directly when useful.",
  ];

  if (category === "moral_philosophical") {
    return [
      ...shared,
      "- Surface competing principles, counterarguments, and uncertainty — do not treat either side as settled by default.",
      "- Tentative moral judgments are welcome; revise them when your partner raises a stronger tension or overlooked stakeholder.",
      "- Share considerations that help your partner stress-test the stance — do not treat sub-issues as isolated.",
      "- Emitting FINAL_ANSWER ends the interaction immediately: your partner will not see that turn and cannot reply. Never ask for review, confirmation, or further discussion in the same message as FINAL_ANSWER.",
      "- Only emit FINAL_ANSWER when the joint stance is locked in and you need no further input. If you still want your partner to check or revise anything, keep discussing without FINAL_ANSWER.",
      "- When ready, follow the format requested in the problem statement and begin the locked-in stance with: FINAL_ANSWER:",
      "- Until then, continue productive collaboration within the communication policy. Do not emit FINAL_ANSWER early or as a draft.",
      "- Do not invent a gold answer or claim objective correctness. A good outcome is a clear, provisional joint stance that acknowledges remaining tensions.",
    ];
  }

  if (category === "proof") {
    return [
      ...shared,
      "- Co-author one rigorous proof: propose strategies, lemmas, and checks across turns — do not each write a separate complete proof in isolation.",
      "- Tentative lemmas and approaches are welcome; revise them when a gap, unjustified step, or counterexample appears.",
      "- Share intermediate reasoning that helps your partner stress-test or extend the argument.",
      "- Emitting FINAL_ANSWER ends the interaction immediately: your partner will not see that turn and cannot reply. Never ask for review, confirmation, or further discussion in the same message as FINAL_ANSWER.",
      "- Only emit FINAL_ANSWER when the joint proof is locked in and you need no further input. If you still want your partner to check or revise anything, keep discussing without FINAL_ANSWER.",
      "- When ready, follow the format requested in the problem statement and begin the locked-in proof with: FINAL_ANSWER:",
      "- Until then, continue productive collaboration within the communication policy. Do not emit FINAL_ANSWER early or as a draft.",
    ];
  }

  if (category === "crossword") {
    return [
      ...shared,
      "- Tentative proposals are welcome; revise them when crossings, clues, or your partner reveal a conflict.",
      "- Share information that helps your partner make progress on other parts of the puzzle — do not treat entries as isolated.",
      "- Emitting FINAL_ANSWER ends the interaction immediately: your partner will not see that turn and cannot reply. Never ask for review, confirmation, or further discussion in the same message as FINAL_ANSWER.",
      "- Only emit FINAL_ANSWER when the joint solution is locked in and you need no further input. If you still want your partner to check or revise anything, keep discussing without FINAL_ANSWER.",
      "- When ready, follow the format requested in the problem statement and begin the locked-in result with: FINAL_ANSWER:",
      "- Until then, continue productive collaboration within the communication policy. Do not emit FINAL_ANSWER early or as a draft.",
    ];
  }

  return [
    ...shared,
    "- Tentative proposals are welcome; revise them when evidence or your partner reveals a conflict.",
    "- Share information that helps your partner make progress — do not treat sub-parts as isolated.",
    "- Emitting FINAL_ANSWER ends the interaction immediately: your partner will not see that turn and cannot reply. Never ask for review, confirmation, or further discussion in the same message as FINAL_ANSWER.",
    "- Only emit FINAL_ANSWER when the joint solution is locked in and you need no further input. If you still want your partner to check or revise anything, keep discussing without FINAL_ANSWER.",
    "- When ready, follow the format requested in the problem statement and begin the locked-in result with: FINAL_ANSWER:",
    "- Until then, continue productive collaboration within the communication policy. Do not emit FINAL_ANSWER early or as a draft.",
  ];
}

/**
 * Builds the full system prompt for one agent from a communication policy.
 * Problem text is supplied at runtime separately (user/context message).
 */
export function buildAgentPrompt(
  agentId: AgentId,
  policy: CommunicationPolicy,
  category?: ProblemCategory,
): string {
  const compiled = compileCommunicationPolicy(policy);
  const policyBlock =
    agentId === "agent_a" ? compiled.agentA : compiled.agentB;

  return [
    `You are ${agentLabel(agentId)}.`,
    "",
    compiled.sharedContext,
    "",
    `The other agent is ${otherLabel(agentId)}. ${collaborationGoal(category)}`,
    "",
    "Stay a general-purpose reasoning agent. Do not invent specialized job titles, organizational roles, or asymmetric expertise unless the communication policy itself induces them.",
    "",
    policyBlock,
    "",
    ...interactionGuidelines(category),
  ].join("\n");
}

export function buildAgentDefinition(
  agentId: AgentId,
  policy: CommunicationPolicy,
  category?: ProblemCategory,
): AgentDefinition {
  return {
    id: agentId,
    label: agentLabel(agentId),
    systemPrompt: buildAgentPrompt(agentId, policy, category),
  };
}

export function buildAgentPromptPair(
  policy: CommunicationPolicy,
  category?: ProblemCategory,
): AgentPromptPair {
  return {
    agentA: buildAgentPrompt("agent_a", policy, category),
    agentB: buildAgentPrompt("agent_b", policy, category),
  };
}
