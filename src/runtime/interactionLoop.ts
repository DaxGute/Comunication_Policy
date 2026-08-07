import type { AgentDefinition, AgentId } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import type { ConversationMessage } from "../experiment/types";
import { createId } from "../lib/id";
import type { Problem } from "../problems/types";
import { isAbortError, throwIfAborted } from "./abort";
import type { ModelClient, ModelMessage } from "./modelClient";

export type InteractionLoopCallbacks = {
  onMessage?: (message: ConversationMessage) => void;
  onSpeaking?: (agentId: AgentId | undefined) => void;
  onTurnProgress?: (turnIndex: number, maxTurns: number) => void;
};

export type InteractionLoopResult = {
  messages: ConversationMessage[];
  finalAnswer?: string;
  stoppedReason: "final_answer" | "max_turns" | "cancelled";
};

function buildTranscriptMessages(
  messages: ConversationMessage[],
): ModelMessage[] {
  return messages.map((m) => ({
    role: "assistant" as const,
    content: `[${m.agentId === "agent_a" ? "Agent A" : "Agent B"}]: ${m.content}`,
    agentId: m.agentId,
  }));
}

/**
 * Simple alternating two-agent protocol.
 */
export async function runInteractionLoop(args: {
  problem: Problem;
  agentA: AgentDefinition;
  agentB: AgentDefinition;
  policy: CommunicationPolicy;
  model: string;
  temperature: number;
  maxTurns: number;
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

  const problemPreamble = [
    "Shared problem:",
    problem.text,
    "",
    "Collaborate under your communication policy. Alternate turns.",
  ].join("\n");

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

    const requestMessages: ModelMessage[] = [
      { role: "system", content: agent.systemPrompt },
      { role: "user", content: problemPreamble },
      ...buildTranscriptMessages(messages),
      {
        role: "user",
        content: `It is your turn (turn ${turn} of at most ${maxTurns}). Respond as ${agent.label}.`,
      },
    ];

    let response;
    try {
      response = await client.generate({
        model,
        temperature,
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
      if (isAbortError(error)) {
        callbacks?.onSpeaking?.(undefined);
        return {
          messages,
          finalAnswer: extractFinalAnswerFromText(
            messages[messages.length - 1]?.content ?? "",
          ),
          stoppedReason: "cancelled",
        };
      }
      throw error;
    }

    const message: ConversationMessage = {
      id: createId("msg"),
      agentId,
      role: "assistant",
      content: response.content,
      timestamp: new Date().toISOString(),
      turnIndex: turn,
      durationMs: response.durationMs,
      usage: response.usage
        ? {
            promptTokens: response.usage.promptTokens,
            completionTokens: response.usage.completionTokens,
            totalTokens: response.usage.totalTokens,
          }
        : undefined,
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
