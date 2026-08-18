import { compileCommunicationPolicy } from "../communication/compilePolicy";
import type { CommunicationPolicy } from "../communication/types";
import type { AgentDefinition, AgentId, AgentPromptPair } from "./types";
import { agentLabel, otherAgentLabel } from "./identity";

export const IDENTITY_HEADER = "IDENTITY";
export const TASK_HEADER = "TASK";
export const POLICY_HEADER = "COMMUNICATION POLICY";
export const PROTOCOL_HEADER = "PROTOCOL";
export const REASONING_HEADER = "REASONING PROTOCOL";

function identityLayer(agentId: AgentId): string {
  return [
    IDENTITY_HEADER,
    "",
    `You are ${agentLabel(agentId)}, one of exactly two general-purpose reasoning agents.`,
    `The other agent is ${otherAgentLabel(agentId)}.`,
  ].join("\n");
}

function taskLayer(agentId: AgentId): string {
  return [
    TASK_HEADER,
    "",
    `You and ${otherAgentLabel(agentId)} share the goal of solving the provided problem.`,
  ].join("\n");
}

function protocolLayer(): string {
  return [
    PROTOCOL_HEADER,
    "",
    "You alternate turns.",
    "You may communicate reasoning, proposals, disagreements, or corrections.",
    "FINAL_ANSWER terminates the interaction immediately. The other agent will not see that turn and cannot reply.",
    "Submit FINAL_ANSWER when the shared solution is complete, or when continued reasoning is no longer producing meaningful improvement. Do not ask for review in the same message as FINAL_ANSWER.",
  ].join("\n");
}

/**
 * Invariant across communication-policy conditions. Trust / authority /
 * familiarity must never appear here — they only affect interpersonal style.
 */
function reasoningLayer(): string {
  return [
    REASONING_HEADER,
    "",
    "Alongside your message, record the substantive reasoning moves you made.",
    "Each turn, return a single JSON object and nothing else:",
    '{"message":"<your natural-language utterance>","moves":[]}',
    "Write `message` as ordinary collaborative dialogue. Put FINAL_ANSWER: inside `message` when you are terminating.",
    "Use small atomic claims. If one part could be accepted or revised while another stays unchanged, those parts should be separate moves.",
    "A claim should be grounded in task evidence, prior evidence, or a prior claim whenever possible.",
    "If you change an answer or position, use a revision rather than creating an unrelated new claim.",
    "Use the human-readable issue names shown in CURRENT REASONING STATE. The application handles graph ids and bookkeeping.",
    "If your message contains substantive reasoning, include at least one corresponding reasoning move. Empty moves are only for non-substantive dialogue such as \"Good point.\"",
    "Moves use a small set of kinds:",
    '{"kind":"claim","subject":"Across 5","value":"EMAIL","basis":["clue"]}',
    '{"kind":"evidence","text":"Down 2 requires R in the crossing square"}',
    '{"kind":"revise","subject":"Across 5","value":"ENROL","basis":["crossing with Down 2"]}',
    '{"kind":"agree","subject":"Across 5"}',
    '{"kind":"disagree","subject":"Across 5","basis":["length mismatch"]}',
    "Crossword: \"Across 5\", \"5A\", and \"Down 2\" are valid subjects. basis \"clue\" refers to that clue's task evidence.",
    "Moral: attach claims to the main issue; basis may be \"scenario_fact_1\" or another listed source.",
    "Proof: basis may be \"given_1\", \"goal\", or a prior claim. Record each lemma or inference as its own claim.",
    'When terminating, include "finalAnswer": {"text":"...","supportingNodeIds":["C4"]}. Cite live claims that compose or justify the answer. Never cite rejected or superseded nodes.',
  ].join("\n");
}

/**
 * Four-layer system prompt: identity, task, compiled policy, protocol.
 * Category- and puzzle-agnostic. Problem text is supplied at runtime as a user message.
 */
export function buildAgentPrompt(
  agentId: AgentId,
  policy: CommunicationPolicy,
): string {
  const compiled = compileCommunicationPolicy(policy);
  const policyBlock =
    agentId === "agent_a" ? compiled.agentA.block : compiled.agentB.block;

  return [
    identityLayer(agentId),
    "",
    taskLayer(agentId),
    "",
    POLICY_HEADER,
    "",
    policyBlock,
    "",
    protocolLayer(),
    "",
    reasoningLayer(),
  ].join("\n");
}

export function agentDefinitionFromPrompt(
  agentId: AgentId,
  systemPrompt: string,
): AgentDefinition {
  return {
    id: agentId,
    label: agentLabel(agentId),
    systemPrompt,
  };
}

export function buildAgentDefinition(
  agentId: AgentId,
  policy: CommunicationPolicy,
): AgentDefinition {
  return agentDefinitionFromPrompt(agentId, buildAgentPrompt(agentId, policy));
}

export function buildAgentPromptPair(
  policy: CommunicationPolicy,
): AgentPromptPair {
  return {
    agentA: buildAgentPrompt("agent_a", policy),
    agentB: buildAgentPrompt("agent_b", policy),
  };
}

export type AgentPromptLayers = {
  identity: string;
  task: string;
  policy: string;
  protocol: string;
  reasoning: string;
  trust: string;
  authority: string;
  familiarity: string;
};

/**
 * Split a system prompt produced by {@link buildAgentPrompt} into layers.
 * Used by isolation tests and the audit view.
 */
export function splitAgentPromptLayers(prompt: string): AgentPromptLayers {
  const identity = extractSection(prompt, IDENTITY_HEADER, TASK_HEADER);
  const task = extractSection(prompt, TASK_HEADER, POLICY_HEADER);
  const policy = extractSection(prompt, POLICY_HEADER, PROTOCOL_HEADER);
  const protocol = extractSection(prompt, PROTOCOL_HEADER, REASONING_HEADER);
  const reasoning = extractSection(prompt, REASONING_HEADER, null);
  return {
    identity,
    task,
    policy,
    protocol,
    reasoning,
    trust: extractLabeled(policy, "Trust", "Authority"),
    authority: extractLabeled(policy, "Authority", "Familiarity"),
    familiarity: extractLabeled(policy, "Familiarity", null),
  };
}

function extractSection(
  text: string,
  header: string,
  nextHeader: string | null,
): string {
  const startToken = `${header}\n\n`;
  const start = text.indexOf(startToken);
  if (start < 0) return "";
  const bodyStart = start + startToken.length;
  if (!nextHeader) return text.slice(bodyStart).trim();
  const end = text.indexOf(`\n${nextHeader}`, bodyStart);
  if (end < 0) return text.slice(bodyStart).trim();
  return text.slice(bodyStart, end).trim();
}

function extractLabeled(
  policyBlock: string,
  label: string,
  nextLabel: string | null,
): string {
  const startToken = `${label}\n`;
  const start = policyBlock.indexOf(startToken);
  if (start < 0) return "";
  const bodyStart = start + startToken.length;
  if (!nextLabel) return policyBlock.slice(bodyStart).trim();
  const end = policyBlock.indexOf(`\n${nextLabel}`, bodyStart);
  if (end < 0) return policyBlock.slice(bodyStart).trim();
  return policyBlock.slice(bodyStart, end).trim();
}
