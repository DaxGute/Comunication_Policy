/**
 * Runs one problem: builds agent prompts, then delegates to the interaction loop.
 *
 * Does not own model scheduling or post-hoc multi-agent evaluation.
 */
import {
  agentDefinitionFromPrompt,
  buildAgentPromptPair,
} from "../agents/buildAgentPrompt";
import type { AgentPromptPair } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { deriveConversationEfficiency } from "../experiment/conversationEfficiency";
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
  /**
   * Snapshotted prompts for this run. When omitted, compiled from `policy`.
   * Prefer passing the run snapshot so A/B prompts cannot drift from metadata.
   */
  agentPrompts?: AgentPromptPair;
  signal?: AbortSignal;
  callbacks?: InteractionLoopCallbacks;
}): Promise<ProblemConversation> {
  const { problem, policy, config, client, signal, callbacks } = args;

  const prompts = args.agentPrompts ?? buildAgentPromptPair(policy);
  const agentA = agentDefinitionFromPrompt("agent_a", prompts.agentA);
  const agentB = agentDefinitionFromPrompt("agent_b", prompts.agentB);

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

  const conversation: ProblemConversation = {
    problemId: problem.id,
    problemTitle: problem.title,
    problemText: problem.text,
    messages: result.messages,
    finalAnswer: result.finalAnswer,
    finalAnswerSupport: result.finalAnswerSupport,
    reasoningNodes: result.reasoning.nodes,
    reasoningEvents: result.reasoning.events,
    stoppedReason: result.stoppedReason,
    error: result.error,
    conversationUsage: hasUsage ? conversationUsage : undefined,
    conversationCostUsd,
  };
  conversation.conversationEfficiency =
    deriveConversationEfficiency(conversation);
  return conversation;
}
