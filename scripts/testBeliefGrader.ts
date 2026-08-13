/**
 * Belief-dynamics fixture tests (no network).
 * Run: npm run test:belief-grader
 */
import assert from "node:assert/strict";
import { computeBeliefMetrics } from "../src/evaluation/belief/metrics";
import { mockBeliefExtraction } from "../src/evaluation/belief/evaluator";
import { validateBeliefGraderOutput } from "../src/evaluation/belief/schema";
import { buildBeliefGraderPrompt } from "../src/evaluation/belief/prompt";
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

function claim(
  partial: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: "proposal",
    confidence: 0.5,
    evidence: "e",
    ...partial,
  };
}

function event(
  partial: Record<string, unknown>,
): Record<string, unknown> {
  return {
    evidence: "e",
    ...partial,
  };
}

function metricsFromRaw(raw: unknown) {
  const validation = validateBeliefGraderOutput(raw, { minTurns: 2 });
  assert.equal(validation.ok, true, validation.errors.join("; "));
  return {
    validation,
    metrics: computeBeliefMetrics(validation.claims, validation.events),
  };
}

function testNullVsZero() {
  const metrics = computeBeliefMetrics([], []);
  assert.equal(metrics.errorCorrectionRate, null);
  assert.equal(metrics.trust?.proposalAcceptance.overall.rate, null);
  assert.equal(metrics.trust?.proposalAcceptance.overall.denominator, 0);
  assert.equal(metrics.familiarity?.repeatedInformationRate.rate, null);
  assert.equal(metrics.crossPolicy?.usefulDisagreementRate.rate, null);
  console.log("✓ zero opportunities → null rates, not 0%");
}

function testDirectionalAcceptanceAndCalibration() {
  const { metrics } = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "answer is 7",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "correct",
        finalStatus: "accepted",
        introducedWithEvidence: true,
      }),
      claim({
        id: "C2",
        text: "answer is 9",
        introducedBy: "agent_b",
        introducedAtTurn: 2,
        correctness: "incorrect",
        finalStatus: "rejected",
        introducedWithEvidence: false,
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        hasEvidence: true,
        isNovel: true,
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "accept",
        targetClaimId: "C1",
        hasEvidence: false,
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "introduce",
        targetClaimId: "C2",
        hasEvidence: false,
      }),
      event({
        turn: 3,
        agent: "agent_a",
        action: "reject",
        targetClaimId: "C2",
      }),
    ],
  });

  assert.equal(metrics.trust?.proposalAcceptance.bToA.rate, 1);
  assert.equal(metrics.trust?.proposalAcceptance.aToB.rate, 0);
  assert.equal(metrics.trust?.correctClaimUptake.overall.rate, 1);
  assert.equal(metrics.trust?.incorrectClaimRejection.aToB.rate, 1);
  assert.equal(metrics.trust?.trustCalibration.acceptGivenCorrect.overall.rate, 1);
  assert.equal(metrics.trust?.trustCalibration.acceptGivenIncorrect.overall.rate, 0);
  assert.equal(metrics.truthConditioned?.partnerAcceptance.correct.rate, 1);
  assert.equal(metrics.truthConditioned?.partnerAcceptance.incorrect.rate, 0);
  console.log("✓ directional acceptance + trust calibration by correctness");
}

function testAuthorityInducedErrorAdoption() {
  const { metrics } = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "7",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "correct",
        finalStatus: "abandoned",
      }),
      claim({
        id: "C2",
        text: "42",
        introducedBy: "agent_b",
        introducedAtTurn: 2,
        correctness: "incorrect",
        finalStatus: "accepted",
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "challenge",
        targetClaimId: "C1",
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "introduce",
        targetClaimId: "C2",
      }),
      event({
        turn: 3,
        agent: "agent_a",
        action: "accept",
        targetClaimId: "C2",
        resultingBeliefChange: true,
      }),
      event({
        turn: 3,
        agent: "agent_a",
        action: "defer",
        targetClaimId: "C2",
      }),
    ],
  });

  assert.equal(metrics.authority?.authorityInducedErrorAdoption.aToB.rate, 1);
  assert.equal(metrics.authority?.authorityInducedErrorAdoption.bToA.rate, null);
  assert.equal(metrics.truthConditioned?.abandonmentOfCorrect.rate, 1);
  assert.ok((metrics.authority?.directionalDeference.aToB.rate ?? 0) > 0);
  console.log("✓ authority-induced error adoption A←B");
}

function testRevisionAsymmetry() {
  const { metrics } = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "x",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "incorrect",
        finalStatus: "corrected",
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "challenge",
        targetClaimId: "C1",
        resultingBeliefChange: true,
      }),
      event({
        turn: 3,
        agent: "agent_a",
        action: "revise",
        targetClaimId: "C1",
        resultingBeliefChange: true,
      }),
    ],
  });

  assert.equal(metrics.authority?.revisionAsymmetry.aToB.rate, 1);
  assert.equal(metrics.authority?.revisionAsymmetry.bToA.rate, null);
  assert.equal(metrics.authority?.challengeSuccessAsymmetry.bToA.rate, 1);
  console.log("✓ revision asymmetry P(A revises | B challenges)");
}

function testFalseConsensusAndRecovery() {
  const { metrics } = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "wrong",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "incorrect",
        finalStatus: "corrected",
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "accept",
        targetClaimId: "C1",
      }),
      event({
        turn: 3,
        agent: "agent_b",
        action: "reconsider",
        targetClaimId: "C1",
      }),
      event({
        turn: 4,
        agent: "agent_a",
        action: "correct",
        targetClaimId: "C1",
        resultingBeliefChange: true,
      }),
    ],
  });

  assert.equal(metrics.crossPolicy?.recoveryFromFalseConsensus.rate, 1);
  assert.equal(metrics.crossPolicy?.convergenceQuality.falseConsensus.rate, 1);
  assert.equal(metrics.crossPolicy?.convergenceQuality.correctConsensus.rate, null);
  console.log("✓ false consensus recovery vs correct-consensus N/A");
}

function testFamiliarityFlagsVsUntagged() {
  const untagged = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "7",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "correct",
        finalStatus: "accepted",
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "accept",
        targetClaimId: "C1",
      }),
    ],
  }).metrics;
  assert.equal(untagged.familiarity?.repeatedInformationRate.rate, null);
  assert.equal(untagged.familiarity?.redundantRederivationRate.rate, null);

  const tagged = metricsFromRaw({
    claims: [
      claim({
        id: "C1",
        text: "7",
        introducedBy: "agent_a",
        introducedAtTurn: 1,
        correctness: "correct",
        finalStatus: "accepted",
      }),
    ],
    events: [
      event({
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        isNovel: true,
      }),
      event({
        turn: 2,
        agent: "agent_b",
        action: "repeat",
        targetClaimId: "C1",
        isRepetition: true,
      }),
      event({
        turn: 3,
        agent: "agent_b",
        action: "misunderstand",
        targetClaimId: "C1",
      }),
      event({
        turn: 4,
        agent: "agent_a",
        action: "clarify",
        targetClaimId: "C1",
      }),
    ],
  }).metrics;
  assert.ok((tagged.familiarity?.repeatedInformationRate.rate ?? 0) > 0);
  assert.equal(tagged.familiarity?.misunderstandingCorrectionRate.rate, 1);
  assert.equal(tagged.familiarity?.repairCost.resolved, 1);
  assert.ok((tagged.familiarity?.repairCost.meanTurns ?? 0) > 0);
  console.log("✓ familiarity untagged → N/A; tagged misunderstanding repair");
}

function testNewActionsAccepted() {
  const validation = validateBeliefGraderOutput(
    {
      claims: [
        claim({
          id: "C1",
          text: "x",
          introducedBy: "agent_a",
          introducedAtTurn: 1,
          correctness: "uncertain",
          finalStatus: "unresolved",
        }),
      ],
      events: [
        event({
          turn: 1,
          agent: "agent_a",
          action: "introduce",
          targetClaimId: "C1",
        }),
        event({
          turn: 2,
          agent: "agent_b",
          action: "misunderstand",
          targetClaimId: "C1",
        }),
        event({
          turn: 3,
          agent: "agent_a",
          action: "repeat",
          targetClaimId: "C1",
          usesShorthand: true,
          referenceStyle: "shorthand",
          referenceResolved: false,
        }),
      ],
    },
    { minTurns: 3 },
  );
  assert.equal(validation.ok, true, validation.errors.join("; "));
  assert.ok(validation.events.some((e) => e.action === "misunderstand"));
  assert.equal(
    validation.events.find((e) => e.usesShorthand)?.referenceResolved,
    false,
  );
  console.log("✓ new event primitives parse");
}

function testPromptHidesPolicySliders() {
  const convo = conversation([
    { agentId: "agent_a", turnIndex: 1, content: "hello" },
    { agentId: "agent_b", turnIndex: 2, content: "world" },
  ]);
  const prompt = buildBeliefGraderPrompt({
    conversation: convo,
    run: {
      id: "r1",
      createdAt: "2026-01-01",
      policy: {
        trustA: 0.37,
        trustB: 0.91,
        authority: 0.14,
        familiarity: 0.62,
      },
      agentPrompts: { agentA: "A", agentB: "B" },
      config: {
        problemCategory: "proof",
        problemCount: 1,
        runModel: "mock",
        runReasoningEffort: "low",
        evaluationModel: "mock",
        evaluationReasoningEffort: "low",
        evaluationEnabled: true,
        provider: "mock",
        maxTurns: 6,
        temperature: 0,
      },
      conversations: [convo],
      status: "completed",
    },
  });
  const blob = `${prompt.system}\n${prompt.user}`;
  assert.equal(blob.includes("0.37"), false);
  assert.equal(blob.includes("0.91"), false);
  assert.equal(blob.includes("0.14"), false);
  assert.equal(blob.includes("0.62"), false);
  assert.equal(blob.includes("trustA"), false);
  assert.match(blob, /Do NOT output holistic collaboration scores/i);
  console.log("✓ extractor prompt hides slider values");
}

testCorrectionPath();
testReinforcementPath();
testSparseEventsRejected();
testClaimIdNormalization();
testNoIncorrectRejectedWhenGoldRequired();
testNullVsZero();
testDirectionalAcceptanceAndCalibration();
testAuthorityInducedErrorAdoption();
testRevisionAsymmetry();
testFalseConsensusAndRecovery();
testFamiliarityFlagsVsUntagged();
testNewActionsAccepted();
testPromptHidesPolicySliders();
console.log("All belief grader fixture tests passed.");
