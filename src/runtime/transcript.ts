import type { AgentId } from "../agents/types";
import { agentLabel, otherAgentId } from "../agents/identity";
import type { ConversationMessage, MessageUsage } from "../experiment/types";

/**
 * Canonical inter-agent utterance. Provider chat roles are not part of this
 * representation — the model adapter renders utterances for a given API.
 */
export type AgentUtterance = {
  id: string;
  sender: AgentId;
  recipient: AgentId;
  turn: number;
  content: string;
  timestamp?: string;
  durationMs?: number;
  usage?: MessageUsage;
};

export function utteranceFromMessage(message: ConversationMessage): AgentUtterance {
  const sender = message.sender ?? message.agentId;
  return {
    id: message.id,
    sender,
    recipient: message.recipient ?? otherAgentId(sender),
    turn: message.turnIndex,
    content: message.content,
    timestamp: message.timestamp,
    durationMs: message.durationMs,
    usage: message.usage,
  };
}

export function utterancesFromMessages(
  messages: ConversationMessage[],
): AgentUtterance[] {
  return messages.map(utteranceFromMessage);
}

export function formatUtteranceForProvider(utterance: AgentUtterance): string {
  // Provider-independent speaker identity. See experiment/transcriptProtocol.ts.
  return `[${agentLabel(utterance.sender)}]: ${utterance.content}`;
}
