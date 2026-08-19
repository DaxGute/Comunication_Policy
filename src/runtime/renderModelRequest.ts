import { agentLabel } from "../agents/identity";
import type { AgentId, AgentPromptPair } from "../agents/types";
import type {
  ConversationMessage,
  ExperimentRun,
  ProblemConversation,
  TranscriptRequestTelemetry,
} from "../experiment/types";
import type { TaskIssueLedger } from "../problems/adapters/types";
import {
  emptyReasoningGraph,
  snapshotBeforeTurn,
  type IssueConvergenceState,
  type ReasoningGraph,
} from "../reasoning";
import { reasoningStateUserMessage } from "../reasoning/renderState";
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
  /**
   * Current reasoning graph for this problem. Always supplied by the live
   * loop. Omit only when reconstructing a legacy request that never had one.
   */
  reasoningGraph?: ReasoningGraph;
  /** Optional adapter-enriched view (for deterministic task conflicts). */
  issueStates?: IssueConvergenceState[];
  taskLedgers?: TaskIssueLedger[];
  /** Injected when structured reasoning has stalled. */
  protocolFeedback?: string;
};

export type AgentTurnRequest = {
  messages: ModelMessage[];
  telemetry: TranscriptRequestTelemetry;
};

export function sharedProblemUserMessage(problemText: string): string {
  return `Shared problem:\n${problemText}`;
}

export function turnCueUserMessage(
  speaker: AgentId,
  turn: number,
  maxTurns: number,
): string {
  return [
    `It is your turn (turn ${turn} of at most ${maxTurns}). Respond as ${agentLabel(speaker)}.`,
    'Return a JSON object with keys "message" and "moves" as specified in REASONING PROTOCOL.',
    "Empty moves are valid when you are not committing a new idea.",
  ].join(" ");
}

/**
 * Chronological prior utterances visible at `turn`. Policy is not an input —
 * history visibility is independent of trust / authority / familiarity.
 */
export function priorUtterancesForTurn(
  utterances: AgentUtterance[],
  turn: number,
): AgentUtterance[] {
  return utterances
    .filter((u) => u.turn < turn)
    .sort((a, b) => a.turn - b.turn);
}

/**
 * Assistant-role history contents as sent to the provider (prefixed).
 * Used by symmetry / isolation tests.
 */
export function assistantHistoryContents(messages: ModelMessage[]): string[] {
  return messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.content);
}

export function measureTurnRequestTelemetry(args: {
  speaker: AgentId;
  turn: number;
  utterances: AgentUtterance[];
  messages: ModelMessage[];
}): TranscriptRequestTelemetry {
  const prior = priorUtterancesForTurn(args.utterances, args.turn);
  const system = args.messages.find((m) => m.role === "system");
  const problem = args.messages.find(
    (m) => m.role === "user" && m.content.startsWith("Shared problem:"),
  );
  const history = args.messages.filter((m) => m.role === "assistant");
  return {
    turnNumber: args.turn,
    speaker: args.speaker,
    transcriptCharactersBeforeTurn: prior.reduce(
      (sum, u) => sum + u.content.length,
      0,
    ),
    transcriptMessagesBeforeTurn: prior.length,
    requestCharacters: args.messages.reduce(
      (sum, m) => sum + m.content.length,
      0,
    ),
    systemPromptCharacters: system?.content.length ?? 0,
    problemCharacters: problem?.content.length ?? 0,
    historyCharacters: history.reduce((sum, m) => sum + m.content.length, 0),
  };
}

/**
 * Deterministic adapter: structured transcript → Chat Completions messages.
 * Canonical utterances stay sender/recipient/turn/content; this function is
 * the only place that assigns provider roles.
 *
 * Representation: every prior utterance is `role: assistant` with a textual
 * `[Agent A]:` / `[Agent B]:` prefix. See `transcriptProtocol.ts`.
 */
export function renderModelRequest(
  args: RenderModelRequestArgs,
): ModelMessage[] {
  const { speaker, systemPrompt, problemText, utterances, turn, maxTurns } =
    args;

  const prior = priorUtterancesForTurn(utterances, turn);
  const includeReasoning = args.reasoningGraph !== undefined;
  const reasoningGraph = args.reasoningGraph ?? emptyReasoningGraph();

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: sharedProblemUserMessage(problemText) },
    ...prior.map((u) => ({
      role: "assistant" as const,
      content: formatUtteranceForProvider(u),
    })),
    ...(includeReasoning
      ? [
          {
            role: "user" as const,
            content: reasoningStateUserMessage(
              reasoningGraph,
              args.issueStates,
              args.taskLedgers,
            ),
          },
        ]
      : []),
    ...(args.protocolFeedback
      ? [{ role: "user" as const, content: args.protocolFeedback }]
      : []),
    {
      role: "user",
      content: turnCueUserMessage(speaker, turn, maxTurns),
    },
  ];
}

/**
 * Canonical per-turn request builder used by the interaction loop, audit
 * reconstruction, and tests. Same inputs → same messages + telemetry.
 */
export function buildAgentTurnRequest(
  args: RenderModelRequestArgs,
): AgentTurnRequest {
  const messages = renderModelRequest(args);
  return {
    messages,
    telemetry: measureTurnRequestTelemetry({
      speaker: args.speaker,
      turn: args.turn,
      utterances: args.utterances,
      messages,
    }),
  };
}

/**
 * Resolve the speaking agent's snapshotted system prompt, then build the
 * turn request. Prevents separate A/B renderer implementations from drifting.
 */
export function buildTurnRequestForAgent(args: {
  agentId: AgentId;
  agentPrompts: AgentPromptPair;
  problemText: string;
  utterances: AgentUtterance[];
  turn: number;
  maxTurns: number;
  reasoningGraph?: ReasoningGraph;
  issueStates?: IssueConvergenceState[];
  taskLedgers?: TaskIssueLedger[];
  protocolFeedback?: string;
}): AgentTurnRequest {
  const systemPrompt =
    args.agentId === "agent_a"
      ? args.agentPrompts.agentA
      : args.agentPrompts.agentB;
  return buildAgentTurnRequest({
    speaker: args.agentId,
    systemPrompt,
    problemText: args.problemText,
    utterances: args.utterances,
    turn: args.turn,
    maxTurns: args.maxTurns,
    reasoningGraph: args.reasoningGraph,
    issueStates: args.issueStates,
    taskLedgers: args.taskLedgers,
    protocolFeedback: args.protocolFeedback,
  });
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

  const hasReasoning =
    Array.isArray(args.conversation.reasoningNodes) ||
    Array.isArray(args.conversation.reasoningEvents);
  const reasoningGraph = hasReasoning
    ? snapshotBeforeTurn(
        {
          subjects: args.conversation.reasoningSubjects,
          nodes: [],
          events: args.conversation.reasoningEvents ?? [],
        },
        args.message.turnIndex,
      )
    : undefined;

  return buildTurnRequestForAgent({
    agentId: speaker,
    agentPrompts: args.run.agentPrompts,
    problemText: args.conversation.problemText,
    utterances: prior,
    turn: args.message.turnIndex,
    maxTurns: args.run.config.maxTurns,
    reasoningGraph,
  }).messages;
}
