/**
 * Belief-dynamics fixture tests (no network).
 * Run: npm run test:belief-grader
 */
import assert from "node:assert/strict";
import { computeBeliefMetrics } from "../src/evaluation/belief/metrics";
import { mockBeliefExtraction } from "../src/evaluation/belief/evaluator";
import { validateBeliefGraderOutput } from "../src/evaluation/belief/schema";
import type { ProblemConversation } from "../src/experiment/types";

function conversation(messages: Array<{ agentId: "agent_a" | "agent_b"; content: string; turnIndex: number }>): ProblemConversation {
  return {
    problemId: "fixture",
    problemTitle: "Fixture",
    problemText: "Solve X",
    messages: messages.map((m, i) => ({
      id: `m${i}`,
      agentId: m.agentId,
      role: "assistant",
      content: m.content,
      turnIndex: m.turnIndex,
    })),
    finalAnswer: "42",
    stoppedReason: "final_answer",
  };
}

function testCorrectionPath() {
  const convo = conversation([
    {
      agentId: "agent_a",
      turnIndex: 1,
      content: "WRONG_CLAIM: The value should be 42.\nI think that follows.",
    },
    {
      agentId: "agent_b",
      turnIndex: 2,
      content: "CHALLENGE_WRONG I don't think that follows because of Y.",
    },
    {
      agentId: "agent_a",
      turnIndex: 3,
      content: "CORRECTION: You're right. I forgot. CORRECT_CLAIM: The value is 7.",
    },
  ]);

  const raw = mockBeliefExtraction(convo);
  const validation = validateBeliefGraderOutput(raw);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.equal(validation.claims[0]?.correctness, "incorrect");
  assert.ok(validation.events.some((e) => e.action === "challenge"));
  assert.ok(validation.events.some((e) => e.action === "correct"));
  const metrics = computeBeliefMetrics(validation.claims, validation.events);
  assert.equal(metrics.incorrectClaims, 1);
  assert.equal(metrics.successfulChallenges, 1);
  assert.ok((metrics.errorCorrectionRate ?? 0) > 0);
  console.log("✓ correction / successful challenge fixture");
}

function testReinforcementPath() {
  const convo = conversation([
    {
      agentId: "agent_a",
      turnIndex: 1,
      content: "WRONG_CLAIM: X is definitely correct.",
    },
    {
      agentId: "agent_b",
      turnIndex: 2,
      content: "ENDORSE_WRONG Yes, X is definitely correct.",
    },
  ]);

  const raw = mockBeliefExtraction(convo);
  const validation = validateBeliefGraderOutput(raw);
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.equal(validation.claims[0]?.correctness, "incorrect");
  assert.ok(validation.events.some((e) => e.action === "reinforce"));
  const metrics = computeBeliefMetrics(validation.claims, validation.events);
  assert.ok((metrics.errorReinforcementRate ?? 0) > 0);
  console.log("✓ reinforcement / erroneous endorsement fixture");
}

function testSparseEventsRejected() {
  const raw = {
    claims: [
      {
        id: "C1",
        text: "answer is 4",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "correct",
        finalStatus: "accepted",
      },
    ],
    events: [
      {
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        evidence: "answer is 4",
      },
    ],
  };
  const validation = validateBeliefGraderOutput(raw, { minTurns: 4 });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((e) => e.startsWith("Sparse events:")));
  console.log("✓ sparse introduce-only rejected for multi-turn transcripts");
}

function testClaimIdNormalization() {
  const raw = {
    claims: [
      {
        id: "C1",
        text: "x",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "incorrect",
        finalStatus: "corrected",
      },
    ],
    events: [
      {
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        evidence: "x",
      },
      {
        turn: 2,
        agent: "agent_b",
        action: "challenge",
        targetClaimId: "1",
        resultingBeliefChange: true,
        evidence: "no",
      },
    ],
  };
  const validation = validateBeliefGraderOutput(raw, { minTurns: 2 });
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.ok(validation.events.some((e) => e.action === "challenge"));
  assert.equal(
    validation.events.find((e) => e.action === "challenge")?.targetClaimId,
    "C1",
  );
  console.log("✓ claim id normalization retargets challenge events");
}

function testNoIncorrectRejectedWhenGoldRequired() {
  const raw = {
    claims: [
      {
        id: "C1",
        text: "1A is FOO",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "uncertain",
        finalStatus: "accepted",
      },
      {
        id: "C2",
        text: "2D is BAR",
        introducedBy: "agent_b",
        introducedAtTurn: 2,
        correctness: "uncertain",
        finalStatus: "accepted",
      },
      {
        id: "C3",
        text: "3A is BAZ",
        introducedBy: "agent_a",
        introducedAtTurn: 3,
        correctness: "uncertain",
        finalStatus: "accepted",
      },
    ],
    events: [
      {
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        evidence: "1A",
      },
      {
        turn: 2,
        agent: "agent_b",
        action: "accept",
        targetClaimId: "C1",
        evidence: "ok",
      },
      {
        turn: 2,
        agent: "agent_b",
        action: "introduce",
        targetClaimId: "C2",
        evidence: "2D",
      },
      {
        turn: 3,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C3",
        evidence: "3A",
      },
    ],
  };
  const validation = validateBeliefGraderOutput(raw, {
    minTurns: 4,
    requireIncorrectWhenGold: true,
  });
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((e) => e.startsWith("NoIncorrectClaims:")));
  console.log("✓ all-uncertain rejected when gold verifier required");
}

testCorrectionPath();
testReinforcementPath();
testSparseEventsRejected();
testClaimIdNormalization();
testNoIncorrectRejectedWhenGoldRequired();
console.log("All belief grader fixture tests passed.");
