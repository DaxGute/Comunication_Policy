import {
  calculateModelCost,
  estimateExperimentCost,
  formatEstimatedCostRange,
} from "../src/models/cost";
import {
  DEFAULT_EVALUATION_MODEL_ID,
  DEFAULT_RUN_MODEL_ID,
  MODEL_REGISTRY,
} from "../src/models/modelRegistry";
import {
  formatActualUsd,
  getRunCostSummary,
  syncRunCostFields,
} from "../src/experiment/runCost";
import type { ExperimentRun } from "../src/experiment/types";
import type { MultiAgentEvaluation } from "../src/evaluation/types";
import { createCommunicationPolicy } from "../src/communication/policy";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// --- Pricing primitives ---

if (DEFAULT_RUN_MODEL_ID !== "gpt-5.6-terra") {
  throw new Error(`Expected terra default, got ${DEFAULT_RUN_MODEL_ID}`);
}
if (DEFAULT_EVALUATION_MODEL_ID !== "gpt-5.6-terra") {
  throw new Error(`Expected terra eval default, got ${DEFAULT_EVALUATION_MODEL_ID}`);
}

const usage = {
  inputTokens: 48_320,
  cachedInputTokens: 22_104,
  outputTokens: 5_183,
};
const cost = calculateModelCost("gpt-5.6-terra", usage);
if (cost === null || cost <= 0) throw new Error("expected positive cost");

// Cached tokens must not also be charged as uncached.
{
  const withCache = calculateModelCost("gpt-5.6-luna", {
    inputTokens: 1_000_000,
    cachedInputTokens: 400_000,
    outputTokens: 0,
  });
  const uncachedOnly = calculateModelCost("gpt-5.6-luna", {
    inputTokens: 600_000,
    outputTokens: 0,
  });
  const cachedOnly = calculateModelCost("gpt-5.6-luna", {
    inputTokens: 400_000,
    cachedInputTokens: 400_000,
    outputTokens: 0,
  });
  assert(withCache !== null && uncachedOnly !== null && cachedOnly !== null, "costs");
  assert(
    approxEqual(withCache, uncachedOnly + cachedOnly),
    `cached split mismatch: ${withCache} vs ${uncachedOnly}+${cachedOnly}`,
  );
  const doubleCountIfWrong = calculateModelCost("gpt-5.6-luna", {
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  assert(doubleCountIfWrong !== null, "full input");
  assert(
    withCache < doubleCountIfWrong,
    "cached pricing should be cheaper than charging all input at uncached rate",
  );
}

const est = estimateExperimentCost({
  runModel: "gpt-5.6-luna",
  evaluationModel: "gpt-5.6-sol",
  problemCount: 10,
  maxTurns: 8,
  evaluationEnabled: true,
});
const estOff = estimateExperimentCost({
  runModel: "gpt-5.6-luna",
  evaluationModel: "gpt-5.6-sol",
  problemCount: 10,
  maxTurns: 8,
  evaluationEnabled: false,
});
if (!(est.totalUsd > estOff.totalUsd)) {
  throw new Error("evaluationEnabled should increase estimate");
}

// --- Run cost summary acceptance cases ---

function makeRun(overrides: Partial<ExperimentRun> = {}): ExperimentRun {
  return {
    id: "run_test",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    policy: createCommunicationPolicy({
      trustA: 0.5,
      trustB: 0.5,
      authority: 0.5,
      familiarity: 0.5,
    }),
    agentPrompts: {
      agentA: "a",
      agentB: "b",
    },
    config: {
      ...DEFAULT_RUN_CONFIG,
      runModel: "gpt-5.6-luna",
      evaluationModel: "gpt-5.6-sol",
      problemCount: 1,
    },
    conversations: [
      {
        problemId: "p1",
        problemTitle: "P1",
        problemText: "text",
        messages: [
          {
            id: "m1",
            agentId: "agent_a",
            role: "assistant",
            content: "hi",
            turnIndex: 1,
            usage: {
              inputTokens: 1_000,
              cachedInputTokens: 200,
              outputTokens: 100,
              totalTokens: 1_100,
            },
          },
          {
            id: "m2",
            agentId: "agent_b",
            role: "assistant",
            content: "yo",
            turnIndex: 2,
            usage: {
              inputTokens: 2_000,
              outputTokens: 150,
              totalTokens: 2_150,
            },
          },
        ],
        stoppedReason: "final_answer",
      },
    ],
    status: "completed",
    ...overrides,
  };
}

function makeMae(args: {
  id: string;
  costs: MultiAgentEvaluation["costs"];
  evaluatorModel?: string;
}): MultiAgentEvaluation {
  const evaluatorModel = args.evaluatorModel ?? "gpt-5.6-sol";
  return {
    id: args.id,
    conversationId: "run_test:p1",
    problemId: "p1",
    runId: "run_test",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    evaluatorModel,
    status: "completed",
    stages: [],
    componentStatus: { marble: "completed", belief: "completed" },
    errors: [],
    costs: args.costs,
    metadata: {
      agentAModel: "gpt-5.6-luna",
      agentBModel: "gpt-5.6-luna",
      trust: 0.5,
      authority: 0.5,
      familiarity: 0.5,
      trustA: 0.5,
      trustB: 0.5,
      evaluatorModel,
      evaluationSchemaVersion: "1",
      beliefGraderVersion: "1",
      beliefGraderSchemaVersion: "1",
      problemSet: "crossword",
      problemId: "p1",
      problemTitle: "P1",
      runId: "run_test",
      conversationId: "run_test:p1",
    },
  };
}

// 1. Conversation only
{
  const run = makeRun();
  const summary = getRunCostSummary(run);
  assert(summary.hasConversationUsage, "conversation usage");
  assert(!summary.evaluationsRan, "evals not run");
  assert(summary.actualEvaluationCost === 0, "eval cost 0");
  assert(
    approxEqual(summary.actualTotalCost, summary.actualConversationCost),
    "total === conversation",
  );
  const expectedConv =
    (calculateModelCost("gpt-5.6-luna", {
      inputTokens: 1_000,
      cachedInputTokens: 200,
      outputTokens: 100,
    }) ?? 0) +
    (calculateModelCost("gpt-5.6-luna", {
      inputTokens: 2_000,
      outputTokens: 150,
    }) ?? 0);
  assert(
    approxEqual(summary.actualConversationCost, expectedConv),
    `conversation cost ${summary.actualConversationCost} != ${expectedConv}`,
  );
  syncRunCostFields(run);
  assert(run.evaluationCostUsd === null, "persisted eval null when not run");
  assert(
    approxEqual(run.totalCostUsd ?? -1, summary.actualConversationCost),
    "persisted total",
  );
}

// 2. Conversation + MARBLE
{
  const marbleCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 5_000,
      outputTokens: 800,
    }) ?? 0;
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({
        id: "mae_marble",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "marble_litellm",
            evaluator: "marble",
            inputTokens: 5_000,
            outputTokens: 800,
            estimatedCostUsd: marbleCost,
          },
        ],
      }),
    ],
  });
  const before = getRunCostSummary(makeRun()).actualTotalCost;
  const after = getRunCostSummary(run);
  assert(after.evaluationsRan, "evals ran");
  assert(
    approxEqual(after.actualEvaluationCost, marbleCost),
    "marble eval cost",
  );
  assert(
    approxEqual(after.actualTotalCost, before + marbleCost),
    "total increased by exactly marble",
  );
  assert(
    approxEqual(after.evaluationBreakdown.marble ?? 0, marbleCost),
    "marble breakdown",
  );
}

// 3. Conversation + multiple evaluators
{
  const marbleCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 5_000,
      outputTokens: 800,
    }) ?? 0;
  const beliefCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 6_000,
      cachedInputTokens: 1_000,
      outputTokens: 1_200,
    }) ?? 0;
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({
        id: "mae_both",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "marble_litellm",
            evaluator: "marble",
            inputTokens: 5_000,
            outputTokens: 800,
            estimatedCostUsd: marbleCost,
          },
          {
            model: "gpt-5.6-sol",
            provider: "openai",
            evaluator: "belief",
            inputTokens: 6_000,
            cachedInputTokens: 1_000,
            outputTokens: 1_200,
            estimatedCostUsd: beliefCost,
          },
        ],
      }),
    ],
  });
  const summary = getRunCostSummary(run);
  assert(
    approxEqual(summary.actualEvaluationCost, marbleCost + beliefCost),
    "eval sum",
  );
  assert(
    approxEqual(
      summary.actualTotalCost,
      summary.actualConversationCost + marbleCost + beliefCost,
    ),
    "total = conv + both",
  );
}

// 4. Different run/eval models priced independently
{
  const run = makeRun({
    config: {
      ...DEFAULT_RUN_CONFIG,
      runModel: "gpt-5.6-luna",
      evaluationModel: "gpt-5.6-sol",
      problemCount: 1,
    },
    multiAgentEvaluations: [
      makeMae({
        id: "mae_models",
        evaluatorModel: "gpt-5.6-sol",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "openai",
            evaluator: "belief",
            inputTokens: 10_000,
            outputTokens: 2_000,
          },
        ],
      }),
    ],
  });
  const summary = getRunCostSummary(run);
  const expectedEval =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 10_000,
      outputTokens: 2_000,
    }) ?? 0;
  const wrongModel =
    calculateModelCost("gpt-5.6-luna", {
      inputTokens: 10_000,
      outputTokens: 2_000,
    }) ?? 0;
  assert(
    approxEqual(summary.actualEvaluationCost, expectedEval),
    "eval priced with sol",
  );
  assert(
    !approxEqual(expectedEval, wrongModel),
    "sol and luna prices must differ for this usage",
  );
  assert(
    summary.evaluationRecords[0]?.usage.model === "gpt-5.6-sol",
    "record retains model",
  );
}

// 5. Cached tokens — covered above in pricing primitives

// 6. Persistence — syncRunCostFields then re-read via getRunCostSummary
{
  const marbleCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 3_000,
      outputTokens: 400,
    }) ?? 0;
  const beliefCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 4_000,
      outputTokens: 500,
    }) ?? 0;
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({
        id: "mae_persist",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "marble_litellm",
            evaluator: "marble",
            inputTokens: 3_000,
            outputTokens: 400,
            estimatedCostUsd: marbleCost,
          },
          {
            model: "gpt-5.6-sol",
            provider: "openai",
            evaluator: "belief",
            inputTokens: 4_000,
            outputTokens: 500,
            estimatedCostUsd: beliefCost,
          },
        ],
      }),
    ],
  });
  const before = getRunCostSummary(run);
  syncRunCostFields(run);
  // Simulate reload: clear cached aggregate fields, keep source records.
  const reloaded: ExperimentRun = {
    ...run,
    conversationUsage: undefined,
    conversationCostUsd: null,
    evaluationUsage: undefined,
    evaluationCostUsd: null,
    totalCostUsd: null,
    multiAgentEvaluations: structuredClone(run.multiAgentEvaluations),
    conversations: structuredClone(run.conversations),
  };
  const after = getRunCostSummary(reloaded);
  assert(
    approxEqual(after.actualConversationCost, before.actualConversationCost),
    "persisted conversation",
  );
  assert(
    approxEqual(after.actualEvaluationCost, before.actualEvaluationCost),
    "persisted evaluation",
  );
  assert(
    approxEqual(after.actualTotalCost, before.actualTotalCost),
    "persisted total",
  );
}

// 7. No double counting — repeated getRunCostSummary / sync
{
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({
        id: "mae_once",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "openai",
            evaluator: "belief",
            inputTokens: 2_000,
            outputTokens: 300,
            estimatedCostUsd:
              calculateModelCost("gpt-5.6-sol", {
                inputTokens: 2_000,
                outputTokens: 300,
              }) ?? 0,
          },
        ],
      }),
    ],
  });
  const a = getRunCostSummary(run).actualTotalCost;
  syncRunCostFields(run);
  const b = getRunCostSummary(run).actualTotalCost;
  syncRunCostFields(run);
  const c = getRunCostSummary(run).actualTotalCost;
  assert(approxEqual(a, b) && approxEqual(b, c), "no double count on re-derive");
}

// 8. Repeated evaluations accumulate
{
  const beliefCost =
    calculateModelCost("gpt-5.6-sol", {
      inputTokens: 2_000,
      outputTokens: 300,
    }) ?? 0;
  const costEntry = {
    model: "gpt-5.6-sol" as const,
    provider: "openai" as const,
    evaluator: "belief",
    inputTokens: 2_000,
    outputTokens: 300,
    estimatedCostUsd: beliefCost,
  };
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({ id: "mae_v1", costs: [costEntry] }),
      makeMae({ id: "mae_v2", costs: [costEntry] }),
    ],
  });
  const summary = getRunCostSummary(run);
  assert(
    approxEqual(summary.actualEvaluationCost, beliefCost * 2),
    "reruns accumulate spend",
  );
  assert(summary.evaluationRecords.length === 2, "two records");
}

// Incomplete MARBLE (no tokens) must not invent a cost
{
  const run = makeRun({
    multiAgentEvaluations: [
      makeMae({
        id: "mae_incomplete",
        costs: [
          {
            model: "gpt-5.6-sol",
            provider: "marble_litellm",
            evaluator: "marble",
            estimatedCostUsd: null,
          },
        ],
      }),
    ],
  });
  const summary = getRunCostSummary(run);
  assert(summary.usageIncomplete, "incomplete when marble has no tokens");
  assert(summary.actualEvaluationCost === 0, "no fabricated eval cost");
  assert(
    approxEqual(summary.actualTotalCost, summary.actualConversationCost),
    "total stays conversation-only when eval unpriced",
  );
}

assert(formatActualUsd(1.2843) === "$1.2843", "formatActualUsd");

console.log("registry:", MODEL_REGISTRY.map((m) => m.id).join(", "));
console.log("sample terra cost:", cost.toFixed(4));
console.log("estimate:", formatEstimatedCostRange(est));
console.log("cost-utils + run cost summary OK");
