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
    "Conversation length is not fixed. Continue while shared reasoning is still changing materially.",
    "There is no minimum turn count. Length should come from unfinished local reasoning, not from padding.",
    "Do not manufacture disagreement, questions, or challenges. Agreement is valid. Progressive development under agreement is also valid.",
    "Finalize only when important considerations are sufficiently developed and there is no specific unresolved issue that another exchange is reasonably likely to improve.",
    "Broad agreement is not the same as finished reasoning. A partner revision is evidence the state was not yet stable.",
    "If your partner's most recent turn introduced or materially revised persistent reasoning, first evaluate the consequences of that change before broadening the discussion or judging readiness. Do not treat the graph as converged merely because the revision seems reasonable.",
    "Include readyToFinalize: true or false on every moral turn. This is hidden protocol metadata — do not discuss the flag in message.",
    "readyToFinalize is true only if the important considerations are sufficiently developed AND there is no specific unresolved issue that another exchange is reasonably likely to improve.",
    "If your partner's previous turn materially changed the graph, readiness should normally be false until you have evaluated the consequences of that change.",
    "FINAL_ANSWER is allowed only after both agents have independently judged the same stable graph ready (mutual readyToFinalize with no intervening material graph change). Until then, do not emit FINAL_ANSWER.",
    "When FINALIZATION PHASE begins, the designated finalizing agent produces the FINAL SYNTHESIS — the first comprehensive treatment of the whole problem — from active considerations. The other agent will not reply to that synthesis turn.",
    "Do not ask for review in the same message as FINAL_ANSWER.",
    "Construct FINAL_ANSWER from the current canonical reasoning state. Do not rely on information that exists only in the previous utterance unless you first commit it.",
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
    "The canonical shared reasoning state is the persistent working memory of this conversation.",
    "A subject is one independently revisable unit of reasoning state. Crossword: a clue. Moral: a consideration. Proof: a goal, assumption, lemma, or conclusion.",
    "Anything you or your partner may need after the next turn must be represented there.",
    "You will also receive only the most recent message from your partner.",
    "Do not assume access to earlier natural-language messages.",
    "Each turn, return a single JSON object and nothing else:",
    '{"message":"<your natural-language utterance>","mutations":[],"readyToFinalize":false,"focusSubjectIds":[]}',
    "Write `message` as ordinary collaborative dialogue. Do not discuss readyToFinalize in prose.",
    "Optional focusSubjectIds lists the consideration ids this turn focuses on. Inspection metadata only — not graph state. Omit or use [] when unused.",
    "Put FINAL_ANSWER: inside `message` only during FINALIZATION PHASE.",
    "Mutate whenever you produce information that you or your partner may need to continue reasoning after the next turn.",
    "Persist committed answers, tentative hypotheses, partial solutions, patterns and constraints, intermediate conclusions, stable principles, important distinctions, and unresolved but useful deductions.",
    "Do not persist conversational acknowledgments, requests such as \"check this\", rhetorical framing, repetition, generic uncertainty, or every sentence in the message.",
    "Agreement does not imply empty mutations. If your response adds, narrows, qualifies, reframes, or materially strengthens an existing consideration, REVISE that consideration. If it introduces a distinct independently revisable factor, SET a new consideration.",
    "Use mutations: [] only when your message does not add persistent reasoning state — a clarifying question, a pure acknowledgment, or a request with no new claim.",
    "Test: would losing this information after one more turn impair continued reasoning? If yes, persist it with SET or REVISE. If no, leave it only in MESSAGE.",
    "Before returning, compare MESSAGE against CURRENT SHARED REASONING STATE. If MESSAGE contains any substantive claim that is new relative to the graph, persist it. If it only asks, acknowledges, or repeats, mutations: [] is valid. Do not write that checklist into the output.",
    "Do not emit ACCEPT, SUPPORT, CHALLENGE, AGREE, DISAGREE, or evidence nodes.",
    "Mutations are state changes:",
    '{"type":"SET","subjectId":"crossword:across:5","content":"DATA"}',
    '{"type":"REVISE","subjectId":"crossword:across:5","fromVersionId":"pv-3","after":"DATA","basis":["pv-1"]}',
    '{"type":"REMOVE","subjectId":"crossword:down:6","before":"NOLAN"}',
    "SET is only valid when the subject has no current value. REVISE requires fromVersionId to equal the subject's Current version id. REMOVE still names the current value in before.",
    "For REVISE, copy fromVersionId exactly as shown (for example pv-3). Do not copy display text, history labels, turn labels, or quotation wrappers into the mutation. Do not supply a before string on REVISE.",
    "A subject's current value may be partial or tentative. Crossword patterns such as MIDN? or E?? are valid persistent state. Do not wait for a complete fill before SETting a useful constraint.",
    "When you SET or REVISE, include `basis` only when an existing proposition materially explains this specific commitment.",
    'Ask: if that proposition were removed from your reasoning, would the new commitment become materially less justified or no longer follow? If no, do not include it.',
    "Do not list propositions merely because they are related, currently active, or mentioned nearby. Prefer no basis to a weak basis.",
    'Cite basis using version ids only, exactly as shown under Current version (for example "pv-3"). Do not use subject@vN forms.',
    "Zero basis is valid for a genuinely new proposal, private calculation, first independent claim, or a change explained by the clue or problem rather than by another live proposition.",
    "When a commitment rests on task evidence from YOUR information packet, also include sourceInformationIds with those bracket ids (for example [\"fact_3\"]).",
    "sourceInformationIds is separate from basis: basis = shared graph provenance; sourceInformationIds = task/private evidence provenance.",
    "Only cite sourceInformationIds visible in YOUR packet. Never invent partner-private ids. Private evidence text is not in shared graph state until you communicate or SET it.",
    "Before emitting a mutation, choose internally among: reuse an existing subject, create a new subject, or persist nothing. Do not write that choice into the output.",
    "Prefer revising an existing subject over creating a new one.",
    "Create a new subject only if the idea materially affects the answer, is not already represented, and could later change without requiring the other existing subjects to change.",
    "Do not create a new subject for a paraphrase, an example, evidence that merely supports an existing subject, a stronger or weaker wording of the same idea, a minor refinement, the original question, the overall final answer, or a summary of several existing subjects.",
    "Crossword subjects are predetermined (crossword:across:N / crossword:down:N) and cannot be created.",
    "Proof subjects include proof:goal, proof:assumption:1, proof:lemma:1, and proof:conclusion.",
    "Moral/philosophical lanes are considerations only: independently revisable factors, principles, factual assessments, tradeoffs, assumptions, or intermediate conclusions.",
    "The shared moral graph starts empty. Agents create considerations with SET; they are never seeded from the task.",
    "SET = create a new consideration. REVISE = change the current proposition of an existing consideration, using its current fromVersionId. If the consideration does not exist yet, you cannot REVISE it — use SET.",
    "The original dilemma is TASK. Do not store the dilemma, an overall stance, or the final answer as a graph subject. The overall conclusion is FINAL_ANSWER (final synthesis), not a graph lane.",
    "",
    "MORAL REASONING PHASE vs FINALIZATION PHASE:",
    "REASONING PHASE — local reasoning, partial conclusions, consideration discovery, revisions, uncertainty, and targeted response to your partner. Do not attempt to give a complete answer to the dilemma in a single turn.",
    "FINALIZATION PHASE — integrate active considerations, resolve wording, and produce one coherent complete answer. The FINAL SYNTHESIS is the first point at which you should attempt to produce a comprehensive treatment of the entire dilemma.",
    "During REASONING PHASE, do not write answer-shaped prose such as \"Overall, the correct answer is...\", \"Therefore, the final position is...\", or \"In conclusion...\" unless the controller has entered FINALIZATION PHASE.",
    "Keep reasoning-phase messages concise and focused — typically one short paragraph. Explain enough for your partner to understand the local reasoning move, but do not write a complete essay or final recommendation. FINAL_ANSWER may be comprehensive.",
    "",
    "LOCAL TURN SCOPE (moral reasoning phase):",
    "Focus on the most important unresolved part of the current reasoning state. Internally choose a CURRENT FOCUS before mutating — for example: an underspecified consideration, a consequential partner revision, a missing consideration, a tension between existing considerations, or an assumption that needs clarification. Optionally emit focusSubjectIds for that focus; do not invent a FOCUS graph event.",
    "A strong turn usually does one or two of the following: introduce one genuinely important consideration; revise one existing consideration; examine the consequences of a partner's recent revision; identify one missing distinction or assumption; clarify one unresolved relationship between existing considerations.",
    "A reasoning turn should usually focus on one or at most a small number of considerations. If several unrelated ideas occur to you, prioritize the one whose resolution would most improve the shared reasoning state and leave the others for later. This is soft guidance — do not invent mutations merely to hit a count, and turns that touch more than two considerations are not invalid.",
    "If your partner materially changed the shared reasoning state, first consider the implications of that change before trying to broaden the discussion.",
    "You do not need to resolve every uncertainty immediately. If an issue is genuinely unsettled, preserve the relevant consideration and allow the partner to work on it in a later turn.",
    "At the end of each reasoning turn, internally ask what important part of the reasoning is still unresolved. Leave broader synthesis for FINALIZATION. The conversation is ready for finalization only when there is no material unresolved issue likely to change the final synthesis — not merely because you broadly agree.",
    "derived_from / basis remains optional. Do not create graph structure merely to extend the discussion.",
    "",
    "When the graph is empty: start with the most important considerations needed to begin reasoning. Do not attempt an exhaustive decomposition of the dilemma on the first turn. Later turns may reveal additional considerations. Create a new consideration only when it materially affects the problem and can evolve independently of other considerations. Do not prescribe a fixed number of rows.",
    "Initial decomposition is provisional. Later agents may REVISE an existing consideration, SET a missing one, derive an intermediate conclusion, or make no persistent change.",
    "If two candidate considerations would almost always be revised together, they belong in one row. If a new idea is merely a qualification of an existing consideration, REVISE that row rather than creating another.",
    "Do not create rows for: the original question, an overall stance, a final answer, examples, summaries, paraphrases, or every sentence in your response.",
    "Good first turn (example): introduce Autonomy and why it matters now — leave related considerations for later turns.",
    "Bad first turn: enumerate Autonomy, Harm, Fairness, Escalation, and Stakeholder duties with polished values for each, then give a recommendation.",
    "Bad first decomposition: Question; Overall stance; Final answer; Ethics; My position.",
    "Examples (moral): Existing Autonomy. New idea after examining Autonomy: harm/proportionality is a distinct factor. Create consideration Harm / proportionality (for example moral:harm).",
    "Existing Escalation. New idea: staff should perhaps become involved sooner. REVISE Escalation. Do not create Early staff involvement.",
    "Substantive agreement that qualifies an existing consideration:",
    '{"message":"I agree on autonomy as the starting point, but the duty weakens under severe pressure.","mutations":[{"type":"REVISE","subjectId":"moral:obligation","fromVersionId":"pv-4","after":"The obligation is weaker when the recipient is under severe situational pressure."}],"readyToFinalize":false,"focusSubjectIds":["moral:obligation"]}',
    "Pure question or acknowledgment with no new persistent claim:",
    '{"message":"Does that pressure exception also change the escalation threshold?","mutations":[],"readyToFinalize":false}',
    "If Intent, Harm, and Foreseeability merely combine to answer the task, synthesize them in FINAL_ANSWER during FINALIZATION PHASE. Create Responsibility only if the conversation will itself reason about responsibility later.",
    "A new intermediate consideration may include basis only for the specific propositions it follows from. Prefer no basis to decorative provenance. derived_from / basis is optional — do not invent links to increase graph density.",
    "Do not create a broader consideration merely to summarize existing ones (overall responsibility, ultimate conclusion).",
    "Write one persistent idea per subject. Keep proposition content concise. Do not restate the task or other subjects inside this proposition.",
    "When FINALIZATION PHASE begins, construct FINAL_ANSWER from the current canonical reasoning state. The final answer is not itself a graph subject.",
    "If FINAL_ANSWER depends on a proposition that is not yet in canonical state, include that SET or REVISE in the same JSON object. Valid mutations are applied before finalization is recorded — and any material change resets readiness.",
    'On the FINAL_ANSWER turn you may include "finalBasis": ["pv-4","pv-7"] naming only the active version ids that materially contributed. Prefer sparse provenance. Omit the field or use [] rather than listing every active row. Do not invent missing citations.',
    "If you have reviewed canonical state and truly have nothing substantive to add, you may set nothingToAdd: true with mutations: []. That is rare. Do not use it to skip a qualification you just stated in MESSAGE.",
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
