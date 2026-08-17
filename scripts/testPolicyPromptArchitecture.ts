/**
 * Prompt/policy architecture invariants for the two-agent communication-policy experiment.
 *
 * Run: npm run test:policy-prompts
 */
import assert from "node:assert/strict";
import {
  buildAgentPrompt,
  buildAgentPromptPair,
  splitAgentPromptLayers,
} from "../src/agents/buildAgentPrompt";
import { compileCommunicationPolicy } from "../src/communication/compilePolicy";
import { createCommunicationPolicy } from "../src/communication/policy";
import type { CommunicationPolicy } from "../src/communication/types";
import { renderModelRequest } from "../src/runtime/renderModelRequest";
import type { AgentUtterance } from "../src/runtime/transcript";
import { emptyReasoningGraph } from "../src/reasoning";

function policy(partial: Partial<CommunicationPolicy>): CommunicationPolicy {
  return createCommunicationPolicy({
    trustA: 0.5,
    trustB: 0.5,
    authority: 0.5,
    familiarity: 0.5,
    ...partial,
  });
}

function assertNoNumericLeak(text: string, label: string): void {
  assert.doesNotMatch(
    text,
    /trustA|trustB|A-weight|B-weight|trustA→B|Current policy parameters/i,
    `${label} leaked numeric policy metadata`,
  );
  assert.doesNotMatch(
    text,
    /\b0\.(25|50|75)\b/,
    `${label} leaked slider decimals`,
  );
}

function changedLines(a: string, b: string): string[] {
  const left = a.split("\n");
  const right = b.split("\n");
  const max = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    if (left[i] !== right[i]) {
      out.push(`${left[i] ?? ""} → ${right[i] ?? ""}`);
    }
  }
  return out;
}

const baseline = policy({});
const prompts = buildAgentPromptPair(baseline);
const layersA = splitAgentPromptLayers(prompts.agentA);

assert.match(prompts.agentA, /^IDENTITY\n/);
assert.ok(layersA.identity.includes("You are Agent A"));
assert.ok(layersA.identity.includes("The other agent is Agent B"));
assert.ok(layersA.task.includes("share the goal of solving the provided problem"));
assert.ok(layersA.protocol.includes("You alternate turns."));
assert.ok(layersA.protocol.includes("FINAL_ANSWER terminates the interaction immediately"));
assert.ok(layersA.protocol.includes("Do not ask for review in the same message as FINAL_ANSWER"));
assert.match(layersA.reasoning, /reasoningIntents/);
assert.equal(
  splitAgentPromptLayers(buildAgentPrompt("agent_a", baseline)).reasoning,
  layersA.reasoning,
);

assert.equal(
  splitAgentPromptLayers(buildAgentPrompt("agent_a", baseline)).identity,
  layersA.identity,
);

assertNoNumericLeak(prompts.agentA, "Agent A system");
assertNoNumericLeak(prompts.agentB, "Agent B system");
assert.doesNotMatch(prompts.agentA, /tentative proposals|fair hearing|argue on the merits/i);
assert.doesNotMatch(prompts.agentA, /crossword|dilemma|proof/i);

const compiledTwice = compileCommunicationPolicy(baseline);
assert.equal(
  compileCommunicationPolicy(baseline).agentA.block,
  compiledTwice.agentA.block,
);
assert.equal(
  compileCommunicationPolicy(baseline).agentB.block,
  compiledTwice.agentB.block,
);

// Directional trust: T_AB change affects only Agent A's Trust section.
const trustLowA = policy({ trustA: 0.25 });
const trustHighA = policy({ trustA: 0.75 });
const aLow = splitAgentPromptLayers(buildAgentPrompt("agent_a", trustLowA));
const aHigh = splitAgentPromptLayers(buildAgentPrompt("agent_a", trustHighA));
const bLow = buildAgentPrompt("agent_b", trustLowA);
const bHigh = buildAgentPrompt("agent_b", trustHighA);

assert.equal(aLow.identity, aHigh.identity);
assert.equal(aLow.task, aHigh.task);
assert.equal(aLow.protocol, aHigh.protocol);
assert.equal(aLow.reasoning, aHigh.reasoning);
assert.equal(aLow.authority, aHigh.authority);
assert.equal(aLow.familiarity, aHigh.familiarity);
assert.notEqual(aLow.trust, aHigh.trust);
assert.equal(bLow, bHigh, "Agent B must be unchanged when only T_AB changes");
assert.match(aLow.trust, /unreliable until independently supported/);
assert.match(aHigh.trust, /substantial weight/);

const trustDiff = changedLines(
  buildAgentPrompt("agent_a", trustLowA),
  buildAgentPrompt("agent_a", trustHighA),
);
assert.equal(trustDiff.length, 1, `expected a single Trust line change, got:\n${trustDiff.join("\n")}`);

// T_BA change affects only Agent B's Trust section.
const trustLowB = policy({ trustB: 0.25 });
const trustHighB = policy({ trustB: 0.75 });
assert.equal(
  buildAgentPrompt("agent_a", trustLowB),
  buildAgentPrompt("agent_a", trustHighB),
  "Agent A must be unchanged when only T_BA changes",
);
const bTrustLow = splitAgentPromptLayers(buildAgentPrompt("agent_b", trustLowB));
const bTrustHigh = splitAgentPromptLayers(buildAgentPrompt("agent_b", trustHighB));
assert.equal(bTrustLow.authority, bTrustHigh.authority);
assert.equal(bTrustLow.familiarity, bTrustHigh.familiarity);
assert.notEqual(bTrustLow.trust, bTrustHigh.trust);

// Authority is relational: both agents' Authority section changes; Trust/Familiarity do not.
const authA = policy({ authority: 0.25 });
const authB = policy({ authority: 0.75 });
const aAuthLow = splitAgentPromptLayers(buildAgentPrompt("agent_a", authA));
const aAuthHigh = splitAgentPromptLayers(buildAgentPrompt("agent_a", authB));
const bAuthLow = splitAgentPromptLayers(buildAgentPrompt("agent_b", authA));
const bAuthHigh = splitAgentPromptLayers(buildAgentPrompt("agent_b", authB));
assert.equal(aAuthLow.trust, aAuthHigh.trust);
assert.equal(aAuthLow.familiarity, aAuthHigh.familiarity);
assert.equal(aAuthLow.identity, aAuthHigh.identity);
assert.notEqual(aAuthLow.authority, aAuthHigh.authority);
assert.notEqual(bAuthLow.authority, bAuthHigh.authority);
assert.match(aAuthLow.authority, /You have decision primacy/);
assert.match(aAuthHigh.authority, /Agent B has decision primacy/);
assert.match(bAuthLow.authority, /Agent A has decision primacy/);
assert.match(bAuthHigh.authority, /You have decision primacy/);

// Familiarity is symmetric: both agents change only Familiarity.
const famLow = policy({ familiarity: 0.25 });
const famHigh = policy({ familiarity: 0.75 });
const aFamLow = splitAgentPromptLayers(buildAgentPrompt("agent_a", famLow));
const aFamHigh = splitAgentPromptLayers(buildAgentPrompt("agent_a", famHigh));
const bFamLow = splitAgentPromptLayers(buildAgentPrompt("agent_b", famLow));
const bFamHigh = splitAgentPromptLayers(buildAgentPrompt("agent_b", famHigh));
assert.equal(aFamLow.trust, aFamHigh.trust);
assert.equal(aFamLow.authority, aFamHigh.authority);
assert.notEqual(aFamLow.familiarity, aFamHigh.familiarity);
assert.equal(bFamLow.trust, bFamHigh.trust);
assert.notEqual(bFamLow.familiarity, bFamHigh.familiarity);
assert.match(aFamLow.familiarity, /little shared conversational context/);
assert.match(aFamHigh.familiarity, /established shorthand/);

// Transcript adapter: structured utterances → provider messages.
const utterances: AgentUtterance[] = [
  {
    id: "u1",
    sender: "agent_a",
    recipient: "agent_b",
    turn: 1,
    content: "Candidate for 1-across: ACE",
  },
];
const turn1 = renderModelRequest({
  speaker: "agent_a",
  systemPrompt: prompts.agentA,
  problemText: "CROSSWORD\n1. clue",
  utterances: [],
  turn: 1,
  maxTurns: 8,
  reasoningGraph: emptyReasoningGraph(),
});
assert.equal(turn1.length, 4);
assert.equal(turn1[0]?.role, "system");
assert.equal(turn1[0]?.content, prompts.agentA);
assert.equal(turn1[1]?.role, "user");
assert.equal(turn1[1]?.content, "Shared problem:\nCROSSWORD\n1. clue");
assert.doesNotMatch(turn1[1]?.content ?? "", /Collaborate under/);
assert.equal(turn1[2]?.role, "user");
assert.match(turn1[2]?.content ?? "", /CURRENT REASONING STATE/);
assert.equal(turn1[3]?.role, "user");
assert.match(turn1[3]?.content ?? "", /Respond as Agent A/);
assert.match(turn1[3]?.content ?? "", /reasoningIntents/);

const turn2 = renderModelRequest({
  speaker: "agent_b",
  systemPrompt: prompts.agentB,
  problemText: "CROSSWORD\n1. clue",
  utterances,
  turn: 2,
  maxTurns: 8,
  reasoningGraph: emptyReasoningGraph(),
});
assert.equal(turn2.length, 5);
assert.equal(turn2[0]?.content, prompts.agentB);
assert.equal(turn2[2]?.role, "assistant");
assert.equal(turn2[2]?.content, "[Agent A]: Candidate for 1-across: ACE");
assert.match(turn2[4]?.content ?? "", /Respond as Agent B/);

const turn2Again = renderModelRequest({
  speaker: "agent_b",
  systemPrompt: prompts.agentB,
  problemText: "CROSSWORD\n1. clue",
  utterances,
  turn: 2,
  maxTurns: 8,
  reasoningGraph: emptyReasoningGraph(),
});
assert.deepEqual(turn2, turn2Again);

console.log("ok — policy prompt architecture: five layers, directional trust isolation, invariant reasoning protocol, no numeric leak, deterministic renderer");
