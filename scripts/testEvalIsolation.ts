/**
 * Orchestrator failure isolation: MARBLE failure must not block interaction success.
 * Run: npm run test:eval-isolation
 */
import assert from "node:assert/strict";
import { runMultiAgentEvaluation } from "../src/evaluation/orchestrator";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import type { ExperimentRun, ProblemConversation } from "../src/experiment/types";

const conversation: ProblemConversation = {
  problemId: "iso1",
  problemTitle: "Isolation",
  problemText: "Task",
  messages: [
    {
      id: "1",
      agentId: "agent_a",
      role: "assistant",
      content: "WRONG_CLAIM: 99 is the answer.",
      turnIndex: 1,
    },
    {
      id: "2",
      agentId: "agent_b",
      role: "assistant",
      content: "CHALLENGE_WRONG I don't think that follows. CORRECT_CLAIM: 1",
      turnIndex: 2,
    },
    {
      id: "3",
      agentId: "agent_a",
      role: "assistant",
      content: "CORRECTION: You're right. I forgot. FINAL_ANSWER: 1",
      turnIndex: 3,
    },
  ],
  finalAnswer: "1",
  stoppedReason: "final_answer",
};

const run: ExperimentRun = {
  id: "run-iso",
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  policy: { trustA: 0.5, trustB: 0.5, authority: 0.5, familiarity: 0.5 },
  agentPrompts: { agentA: "A", agentB: "B" },
  config: normalizeRunConfig(
    {
      problemCategory: "hidden_profile",
      problemCount: 1,
      runModel: "mock-deterministic",
      maxTurns: 6,
      temperature: 0,
    },
    { ...DEFAULT_RUN_CONFIG, runModel: "mock-deterministic", provider: "mock" },
  ),
  conversations: [conversation],
  evaluation: {
    summary: { score: 1 },
    problems: [
      {
        problemId: "iso1",
        problemTitle: "Isolation",
        turns: 3,
        score: 1,
        label: "correct",
      },
    ],
  },
  status: "completed",
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: "Forced MARBLE failure for isolation test",
    }),
    { status: 502, headers: { "Content-Type": "application/json" } },
  )) as typeof fetch;

try {
  const result = await runMultiAgentEvaluation({
    run,
    conversation,
    evaluatorModel: "mock-deterministic",
  });

  assert.equal(result.componentStatus.marble, "failed");
  assert.equal(result.componentStatus.interaction, "completed");
  assert.equal(result.componentStatus.belief, "skipped");
  assert.equal(result.marble, undefined);
  assert.ok(result.interaction);
  assert.ok(
    result.errors.some((e) => e.component === "marble" && e.retryable),
  );
  // Transcript untouched
  assert.equal(conversation.messages.length, 3);
  assert.equal(conversation.finalAnswer, "1");
  console.log("✓ MARBLE failure isolated; interaction still complete");
} finally {
  globalThis.fetch = originalFetch;
}
