import { otherAgentId } from "../agents/identity";
import type { AgentDefinition, AgentId } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import type { ConversationMessage } from "../experiment/types";
import { createId } from "../lib/id";
import type { ReasoningEffort } from "../models/modelRegistry";
import type { Problem } from "../problems/types";
import { isAbortError, throwIfAborted } from "./abort";
import type { ModelClient } from "./modelClient";
import { renderModelRequest } from "./renderModelRequest";
import { utteranceFromMessage } from "./transcript";

export type InteractionLoopCallbacks = {
  onMessage?: (message: ConversationMessage) => void;
  onSpeaking?: (agentId: AgentId | undefined) => void;
  onTurnProgress?: (turnIndex: number, maxTurns: number) => void;
};

export type InteractionLoopResult = {
  messages: ConversationMessage[];
  finalAnswer?: string;
  stoppedReason: "final_answer" | "max_turns" | "cancelled" | "error";
  /** Set when `stoppedReason` is `error`. */
  error?: string;
};

/**
 * Simple alternating two-agent protocol: A → B → A → B → …
 */
export async function runInteractionLoop(args: {
  problem: Problem;
  agentA: AgentDefinition;
  agentB: AgentDefinition;
  policy: CommunicationPolicy;
  model: string;
  temperature: number;
  maxTurns: number;
  reasoningEffort?: ReasoningEffort;
  client: ModelClient;
  signal?: AbortSignal;
  callbacks?: InteractionLoopCallbacks;
}): Promise<InteractionLoopResult> {
  const {
    problem,
    agentA,
    agentB,
    policy,
    model,
    temperature,
    maxTurns,
    reasoningEffort,
    client,
    signal,
    callbacks,
  } = args;

  const agents: Record<AgentId, AgentDefinition> = {
    agent_a: agentA,
    agent_b: agentB,
  };

  const order: AgentId[] = ["agent_a", "agent_b"];
  const messages: ConversationMessage[] = [];

  for (let turn = 1; turn <= maxTurns; turn++) {
    try {
      throwIfAborted(signal);
    } catch {
      callbacks?.onSpeaking?.(undefined);
      return {
        messages,
        finalAnswer: extractFinalAnswerFromText(
          messages[messages.length - 1]?.content ?? "",
        ),
        stoppedReason: "cancelled",
      };
    }

    const agentId = order[(turn - 1) % 2];
    const agent = agents[agentId];
    callbacks?.onSpeaking?.(agentId);
    callbacks?.onTurnProgress?.(turn, maxTurns);

    const requestMessages = renderModelRequest({
      speaker: agentId,
      systemPrompt: agent.systemPrompt,
      problemText: problem.text,
      utterances: messages.map(utteranceFromMessage),
      turn,
      maxTurns,
    });

    let response;
    try {
      response = await client.generate({
        model,
        temperature,
        reasoningEffort,
        messages: requestMessages,
        signal,
        meta: {
          agentId,
          turnIndex: turn,
          problem,
          policy,
        },
      });
    } catch (error) {
      callbacks?.onSpeaking?.(undefined);
      if (isAbortError(error)) {
        return {
          messages,
          finalAnswer: extractFinalAnswerFromText(
            messages[messages.length - 1]?.content ?? "",
          ),
          stoppedReason: "cancelled",
        };
      }
      // Keep partial transcript so a rate-limit / API failure does not erase
      // progress for this problem (or wipe the parent run via Promise.all).
      return {
        messages,
        finalAnswer: extractFinalAnswerFromText(
          messages[messages.length - 1]?.content ?? "",
        ),
        stoppedReason: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const inputTokens =
      response.usage?.inputTokens ?? response.usage?.promptTokens;
    const outputTokens =
      response.usage?.outputTokens ?? response.usage?.completionTokens;

    const message: ConversationMessage = {
      id: createId("msg"),
      agentId,
      sender: agentId,
      recipient: otherAgentId(agentId),
      role: "assistant",
      content: response.content,
      timestamp: new Date().toISOString(),
      turnIndex: turn,
      durationMs: response.durationMs,
      usage: response.usage
        ? {
            inputTokens,
            promptTokens: inputTokens,
            cachedInputTokens: response.usage.cachedInputTokens,
            outputTokens,
            completionTokens: outputTokens,
            totalTokens: response.usage.totalTokens,
          }
        : undefined,
      modelRequest: requestMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    messages.push(message);
    callbacks?.onMessage?.(message);

    const finalAnswer = extractFinalAnswerFromText(response.content);
    if (finalAnswer) {
      callbacks?.onSpeaking?.(undefined);
      return {
        messages,
        finalAnswer,
        stoppedReason: "final_answer",
      };
    }
  }

  callbacks?.onSpeaking?.(undefined);
  return {
    messages,
    finalAnswer: extractFinalAnswerFromText(
      messages[messages.length - 1]?.content ?? "",
    ),
    stoppedReason: "max_turns",
  };
}
