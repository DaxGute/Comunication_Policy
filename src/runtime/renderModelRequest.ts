import { agentLabel } from "../agents/identity";
import type { AgentId } from "../agents/types";
import type { ConversationMessage, ExperimentRun, ProblemConversation } from "../experiment/types";
import type { ModelMessage } from "./modelClient";
import {
  formatUtteranceForProvider,
  utteranceFromMessage,
  type AgentUtterance,
} from "./transcript";

export type RenderModelRequestArgs = {
  speaker: AgentId;
  systemPrompt: string;
  problemText: string;
  utterances: AgentUtterance[];
  turn: number;
  maxTurns: number;
};

export function sharedProblemUserMessage(problemText: string): string {
  return `Shared problem:\n${problemText}`;
}

export function turnCueUserMessage(
  speaker: AgentId,
  turn: number,
  maxTurns: number,
): string {
  return `It is your turn (turn ${turn} of at most ${maxTurns}). Respond as ${agentLabel(speaker)}.`;
}

/**
 * Deterministic adapter: structured transcript → Chat Completions messages.
 * Canonical utterances stay sender/recipient/turn/content; this function is
 * the only place that assigns provider roles.
 */
export function renderModelRequest(
  args: RenderModelRequestArgs,
): ModelMessage[] {
  const { speaker, systemPrompt, problemText, utterances, turn, maxTurns } =
    args;

  const prior = utterances
    .filter((u) => u.turn < turn)
    .sort((a, b) => a.turn - b.turn);

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: sharedProblemUserMessage(problemText) },
    ...prior.map((u) => ({
      role: "assistant" as const,
      content: formatUtteranceForProvider(u),
    })),
    {
      role: "user",
      content: turnCueUserMessage(speaker, turn, maxTurns),
    },
  ];
}

export function formatModelRequestForAudit(messages: ModelMessage[]): string {
  return messages
    .map((message, index) => {
      const header = `${index + 1}. ${message.role.toUpperCase()}`;
      return `${header}\n${message.content}`;
    })
    .join("\n\n");
}

/**
 * Exact payload sent for a turn when stored; otherwise reconstruct from the
 * same renderer used at runtime (historical runs).
 */
export function resolveModelRequest(args: {
  message: ConversationMessage;
  conversation: ProblemConversation;
  run: ExperimentRun;
}): ModelMessage[] {
  if (args.message.modelRequest && args.message.modelRequest.length > 0) {
    return args.message.modelRequest.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  const speaker = args.message.sender ?? args.message.agentId;
  const prior = args.conversation.messages
    .filter((m) => m.turnIndex < args.message.turnIndex)
    .map(utteranceFromMessage);

  const systemPrompt =
    speaker === "agent_a"
      ? args.run.agentPrompts.agentA
      : args.run.agentPrompts.agentB;

  return renderModelRequest({
    speaker,
    systemPrompt,
    problemText: args.conversation.problemText,
    utterances: prior,
    turn: args.message.turnIndex,
    maxTurns: args.run.config.maxTurns,
  });
}
