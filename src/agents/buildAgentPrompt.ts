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
    "You and the other agent jointly maintain a structured Reasoning Graph in parallel with the conversation. The graph is the machine-readable record of what you are reasoning about; the message is the natural-language record of what you said.",
    "Each turn, return a single JSON object and nothing else:",
    '{"message":"<your natural-language utterance>","reasoningIntents":[]}',
    "Write `message` as ordinary collaborative dialogue. Put FINAL_ANSWER: inside `message` when you are terminating.",
    "ATOMICITY IS REQUIRED: If one part of a reasoning object could be accepted, rejected, challenged, revised, or supported while another part remains unchanged, those parts should normally be separate nodes.",
    "Err toward the smallest independently evaluable proposition, not broad summaries. Do not split ideas into meaningless fragments: use the smallest substantively evaluable unit.",
    "Crossword — BAD: \"Preliminary entries: 1A=HUT, 3A=MARC, 5A=SEE, 7A=TEN.\" GOOD: four separate proposals: \"1A = HUT\"; \"3A = MARC\"; \"5A = SEE\"; \"7A = TEN\".",
    "Moral reasoning — BAD: \"The action is wrong because it violates autonomy, causes harm, and undermines trust.\" GOOD: separate claims \"The action restricts informed choice\"; \"Restricting informed choice infringes autonomy\"; \"The action causes avoidable harm\"; \"The action undermines trust\"; then proposal \"These considerations count against the action\".",
    "Proof — BAD: \"f is continuous, changes sign, and therefore has a root.\" GOOD: separate claims \"f is continuous on [a,b]\"; \"f(a) < 0\"; \"f(b) > 0\"; then proposal \"There exists c in (a,b) with f(c)=0\".",
    "Node semantics: claim = the default atomic reasoning unit: one truth-apt assertion or candidate answer; issue = an emergent unresolved question not already listed under AVAILABLE ISSUES; proposal = a genuinely composite plan or construction, never a container for several independently evaluable claims; evidence = one observation, datum, computation, citation, or premise bearing on a claim. `challenge` node type exists only for old stored data—do not create it; express objections with a claim/evidence node plus a `challenge` edge.",
    "Use `reasoningIntents` to record substantive atomic claims, evidence, objections, revisions, and explicit agreement or disagreement. Do not add intents for filler such as \"Good point.\" unless that move changes an existing idea (for example, agreeing with P4).",
    "AVAILABLE ISSUES are application-owned stable subjects. Do not recreate, rename, or paraphrase them as issue nodes; attach each relevant atomic claim/proposal with the listed subjectId. Create an issue node only for a genuinely new question absent from AVAILABLE ISSUES.",
    "Actions: create, support, challenge, accept, reject, revise, pass.",
    'create: {"action":"create","nodeType":"issue|proposal|claim|evidence","text":"one atomic idea","subjectId":"required for a claim/proposal answering an AVAILABLE ISSUE; otherwise omit","dependencies":[],"localId":"optional"}',
    'support / challenge: {"action":"support","sourceNodeId":"E2","targetNodeId":"C4","reason":"optional explanation"}. sourceNodeId and targetNodeId are required for a semantic edge.',
    'accept / reject / pass: {"action":"accept","targetId":"P4","reason":"..."}',
    'revise: {"action":"revise","targetId":"P4","text":"...","reason":"..."}',
    "Typed relationships are directional and always read SOURCE relationship TARGET: sourceNodeId supports/challenges targetNodeId; a created node depends_on each id in its dependencies array; a revision creates a new node that revises its target; a claim/proposal with subjectId answers that stable issue. Sharing a subject never implies support, challenge, or revision.",
    "Do not emit `parents`; grouping is represented only by subjectId and substantive relationships use typed intents. Cite existing ids from CURRENT REASONING STATE when responding to an idea rather than restating it. To attach a later intent to a node created earlier in this same turn, set `localId` on the create and reuse that token in `sourceNodeId`, `targetNodeId`, `targetId`, `subjectId`, or `dependencies`.",
    'When terminating, include "finalAnswer": {"text":"...","supportingNodeIds":["P4"]}. Cite the live atomic leaf or synthesis nodes that materially compose or justify the answer. Do not cite every historical node, and never cite rejected or superseded nodes.',
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
