import { buildAgentDefinition } from "../agents/buildAgentPrompt";
import type { CommunicationPolicy } from "../communication/types";
import type { ProblemConversation, RunConfig } from "../experiment/types";
import { calculateModelCost } from "../models/cost";
import { normalizeUsage, sumUsage } from "../models/usage";
import type { Problem } from "../problems/types";
import {
  runInteractionLoop,
  type InteractionLoopCallbacks,
} from "./interactionLoop";
import type { ModelClient } from "./modelClient";

export async function runProblem(args: {
  problem: Problem;
  policy: CommunicationPolicy;
  config: RunConfig;
  client: ModelClient;
  signal?: AbortSignal;
  callbacks?: InteractionLoopCallbacks;
}): Promise<ProblemConversation> {
  const { problem, policy, config, client, signal, callbacks } = args;

  const agentA = buildAgentDefinition("agent_a", policy);
  const agentB = buildAgentDefinition("agent_b", policy);

  const result = await runInteractionLoop({
    problem,
    agentA,
    agentB,
    policy,
    model: config.runModel,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    reasoningEffort: config.runReasoningEffort,
    client,
    signal,
    callbacks,
  });

  const conversationUsage = sumUsage(
    result.messages.map((m) => normalizeUsage(m.usage ?? { totalTokens: 0 })),
  );
  const hasUsage = result.messages.some((m) => m.usage);
  // Price each message call with the run model (preserves per-call accounting).
  let conversationCostUsd: number | null = null;
  if (hasUsage) {
    let sum = 0;
    let anyPriced = false;
    for (const message of result.messages) {
      if (!message.usage) continue;
      const usage = normalizeUsage(message.usage);
      if (!usage) continue;
      const priced = calculateModelCost(config.runModel, usage);
      if (priced === null) continue;
      sum += priced;
      anyPriced = true;
    }
    conversationCostUsd = anyPriced ? sum : null;
  }

  return {
    problemId: problem.id,
    problemTitle: problem.title,
    problemText: problem.text,
    messages: result.messages,
    finalAnswer: result.finalAnswer,
    stoppedReason: result.stoppedReason,
    error: result.error,
    conversationUsage: hasUsage ? conversationUsage : undefined,
    conversationCostUsd,
  };
}
