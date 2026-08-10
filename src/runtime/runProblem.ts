import { buildAgentDefinition } from "../agents/buildAgentPrompt";
import type { CommunicationPolicy } from "../communication/types";
import type { ProblemConversation, RunConfig } from "../experiment/types";
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

  const agentA = buildAgentDefinition(
    "agent_a",
    policy,
    problem.category,
  );
  const agentB = buildAgentDefinition(
    "agent_b",
    policy,
    problem.category,
  );

  const result = await runInteractionLoop({
    problem,
    agentA,
    agentB,
    policy,
    model: config.model,
    temperature: config.temperature,
    maxTurns: config.maxTurns,
    client,
    signal,
    callbacks,
  });

  return {
    problemId: problem.id,
    problemTitle: problem.title,
    problemText: problem.text,
    messages: result.messages,
    finalAnswer: result.finalAnswer,
    stoppedReason: result.stoppedReason,
  };
}
