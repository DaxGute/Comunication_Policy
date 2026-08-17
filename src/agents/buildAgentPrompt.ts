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
    "Only use FINAL_ANSWER when you believe the shared solution is complete and you need no further reply. Do not ask for review in the same message as FINAL_ANSWER.",
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
    "You and the other agent jointly maintain a structured proposal/claim graph in parallel with the conversation. The graph is the machine-readable record of what you are reasoning about; the message is the natural-language record of what you said.",
    "Each turn, return a single JSON object and nothing else:",
    '{"message":"<your natural-language utterance>","reasoningIntents":[]}',
    "Write `message` as ordinary collaborative dialogue. Put FINAL_ANSWER: inside `message` when you are terminating.",
    "Use `reasoningIntents` to record substantive claims, evidence, objections, revisions, and explicit agreement or disagreement. Do not add intents for filler such as \"Good point.\" unless that move changes an existing idea (for example, agreeing with P4).",
    "Actions: create, support, challenge, accept, reject, revise, pass.",
    'create: {"action":"create","nodeType":"issue|proposal|claim|evidence|challenge","text":"...","parents":[],"dependencies":[],"localId":"optional"}',
    'support / challenge / accept / reject / pass: {"action":"accept","targetId":"P4","reason":"..."}',
    'revise: {"action":"revise","targetId":"P4","text":"...","reason":"..."}',
    "Cite existing ids from CURRENT REASONING STATE when responding to an idea rather than restating it. To attach a later intent to a node created earlier in this same turn, set `localId` on the create and reuse that token in `targetId`, `parents`, or `dependencies`.",
    'When terminating, include "finalAnswer": {"text":"...","supportingNodeIds":["P4"]}.',
    "The application assigns ids and enforces graph consistency and legal state transitions.",
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
