import { agentLabel } from "../agents/identity";
import type { AgentId, AgentPromptPair } from "../agents/types";
import type {
  ConversationMessage,
  ExperimentRun,
  ProblemConversation,
  TranscriptRequestTelemetry,
} from "../experiment/types";
import {
  emptyReasoningGraph,
  snapshotBeforeTurn,
  snapshotThroughTurn,
  type ReasoningGraph,
} from "../reasoning";
import { formatReasoningState, reasoningStateUserMessage } from "../reasoning/renderState";
import type { ModelMessage } from "./modelClient";
import { formatUtteranceForProvider, utteranceFromMessage, type AgentUtterance } from "./transcript";
import { resolveTranscriptProtocol } from "../experiment/transcriptProtocol";

export type RenderModelRequestArgs = {
  speaker: AgentId;
  systemPrompt: string;
  problemText: string;
  utterances: AgentUtterance[];
  turn: number;
  maxTurns: number;
  reasoningGraph?: ReasoningGraph;
  protocolFeedback?: string;
  /** Moral runs: reasoning vs finalization phase. */
  moralPhase?: "reasoning" | "finalization";
  /** Include readyToFinalize in the turn cue (moral). */
  readyToFinalizeHint?: boolean;
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
  options?: {
    moralPhase?: "reasoning" | "finalization";
    readyToFinalizeHint?: boolean;
  },
): string {
  const lines = [
    `It is your turn (turn ${turn} of at most ${maxTurns}). Respond as ${agentLabel(speaker)}.`,
  ];
  if (options?.moralPhase === "finalization") {
    lines.push(
      'Return a JSON object with keys "message", "mutations", and optionally "finalBasis" and "readyToFinalize".',
      "FINALIZATION PHASE: this is the first point at which you should produce a comprehensive treatment of the entire dilemma.",
      "Synthesize FINAL_ANSWER from CURRENT SHARED REASONING STATE.",
      "Use SET only for a new consideration; use REVISE only with fromVersionId equal to Current version (for example pv-3).",
      'Cite basis and finalBasis as version ids only (for example "pv-3").',
    );
  } else if (options?.readyToFinalizeHint) {
    lines.push(
      'Return a JSON object with keys "message", "mutations", and "readyToFinalize" as specified in REASONING PROTOCOL. Optional focusSubjectIds is inspection metadata only.',
      "REASONING PHASE: make a small, targeted contribution. Do not synthesize the whole dilemma this turn.",
      "Usually focus on one or a small number of considerations. Keep the message concise — typically one short paragraph.",
      "Empty mutations are valid when this message does not add persistent reasoning.",
      "Use SET only to create a new consideration. Use REVISE only for an existing consideration with fromVersionId equal to Current version.",
      'Cite basis as version ids only (for example "pv-3").',
      "Set readyToFinalize: true only when important considerations are sufficiently developed and no specific unresolved issue is reasonably likely to improve with another exchange.",
      "If your partner's most recent turn introduced or materially revised persistent reasoning, evaluate the consequences of that change before broadening or judging readiness — readiness should normally be false until then.",
      "Do not emit FINAL_ANSWER until the controller has entered FINALIZATION PHASE after mutual readiness on a stable graph.",
    );
  } else {
    lines.push(
      'Return a JSON object with keys "message" and "mutations" as specified in REASONING PROTOCOL.',
      "Empty mutations are valid only when this message does not add persistent reasoning.",
      "If you qualify, narrow, or strengthen an existing proposition, REVISE it with fromVersionId equal to Current version.",
      "If you are ready to FINAL_ANSWER, construct it from CURRENT SHARED REASONING STATE, commit any missing persistent propositions in this same JSON object, and optionally include finalBasis citing only the active propositions that materially contributed.",
    );
  }
  return lines.join(" ");
}

export function previousPartnerUtterance(
  utterances: AgentUtterance[],
  speaker: AgentId,
  turn: number,
): AgentUtterance | undefined {
  const prior = utterances
    .filter((u) => u.turn < turn)
    .sort((a, b) => a.turn - b.turn);
  const last = prior[prior.length - 1];
  if (!last || last.sender === speaker) return undefined;
  return last;
}

export function partnerMessageUserMessage(utterance: AgentUtterance): string {
  return [
    "MOST RECENT PARTNER MESSAGE",
    "",
    `${agentLabel(utterance.sender)}:`,
    `"${utterance.content}"`,
  ].join("\n");
}

/**
 * Persisted prior utterances. Not included in the model request except for
 * the immediately previous partner message.
 */
export function priorUtterancesForTurn(
  utterances: AgentUtterance[],
  turn: number,
): AgentUtterance[] {
  return utterances
    .filter((u) => u.turn < turn)
    .sort((a, b) => a.turn - b.turn);
}

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
  reasoningGraph?: ReasoningGraph;
  serializedGraph?: string;
  previousUtterance?: AgentUtterance;
}): TranscriptRequestTelemetry {
  const prior = priorUtterancesForTurn(args.utterances, args.turn);
  const system = args.messages.find((m) => m.role === "system");
  const problem = args.messages.find(
    (m) => m.role === "user" && m.content.startsWith("Shared problem:"),
  );
  const graph = args.reasoningGraph;
  const active = graph?.versions.filter((version) => version.status === "active") ?? [];
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
    historyCharacters: args.previousUtterance
      ? args.previousUtterance.content.length
      : 0,
    graphSubjectCount: graph?.subjects.length ?? 0,
    graphActiveValueCount: active.length,
    graphHistoryVersionCount: graph?.versions.length ?? 0,
    graphSerializedChars: args.serializedGraph?.length ?? 0,
    previousUtteranceChars: args.previousUtterance?.content.length ?? 0,
    historicalTranscriptCharsIncluded: 0,
  };
}

/**
 * Agent-turn input: task, policy (in system), canonical graph, previous
 * partner utterance. The full transcript is not sent to the model.
 */
export function renderModelRequest(
  args: RenderModelRequestArgs,
): ModelMessage[] {
  const { speaker, systemPrompt, problemText, utterances, turn, maxTurns } =
    args;
  const partner = previousPartnerUtterance(utterances, speaker, turn);
  const includeReasoning = args.reasoningGraph !== undefined;
  const reasoningGraph = args.reasoningGraph ?? emptyReasoningGraph();

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: sharedProblemUserMessage(problemText) },
    ...(includeReasoning
      ? [
          {
            role: "user" as const,
            content: reasoningStateUserMessage(reasoningGraph),
          },
        ]
      : []),
    ...(partner
      ? [
          {
            role: "user" as const,
            content: partnerMessageUserMessage(partner),
          },
        ]
      : []),
    ...(args.protocolFeedback
      ? [{ role: "user" as const, content: args.protocolFeedback }]
      : []),
    {
      role: "user",
      content: turnCueUserMessage(speaker, turn, maxTurns, {
        moralPhase: args.moralPhase,
        readyToFinalizeHint: args.readyToFinalizeHint,
      }),
    },
  ];
}

export function buildAgentTurnRequest(
  args: RenderModelRequestArgs,
): AgentTurnRequest {
  const messages = renderModelRequest(args);
  const partner = previousPartnerUtterance(
    args.utterances,
    args.speaker,
    args.turn,
  );
  const serializedGraph =
    args.reasoningGraph !== undefined
      ? reasoningStateUserMessage(args.reasoningGraph)
      : undefined;
  return {
    messages,
    telemetry: measureTurnRequestTelemetry({
      speaker: args.speaker,
      turn: args.turn,
      utterances: args.utterances,
      messages,
      reasoningGraph: args.reasoningGraph,
      serializedGraph,
      previousUtterance: partner,
    }),
  };
}

export function buildTurnRequestForAgent(args: {
  agentId: AgentId;
  agentPrompts: AgentPromptPair;
  problemText: string;
  utterances: AgentUtterance[];
  turn: number;
  maxTurns: number;
  reasoningGraph?: ReasoningGraph;
  protocolFeedback?: string;
  moralPhase?: "reasoning" | "finalization";
  readyToFinalizeHint?: boolean;
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
    protocolFeedback: args.protocolFeedback,
    moralPhase: args.moralPhase,
    readyToFinalizeHint: args.readyToFinalizeHint,
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

/** Exact graph memory shown to the agent before the turn, and the state after it. */
export function formatTurnMemoryForAudit(args: {
  graph: ReasoningGraph;
  conversation: ProblemConversation;
  turn: number;
}): string {
  const before = snapshotBeforeTurn(args.graph, args.turn);
  const after = snapshotThroughTurn(args.graph, args.turn);
  const message = args.conversation.messages.find(
    (item) => item.turnIndex === args.turn,
  );
  const prior = args.conversation.messages
    .filter((item) => item.turnIndex < args.turn)
    .at(-1);
  const previousToThisAgent =
    prior && message && prior.agentId !== message.agentId
      ? partnerMessageUserMessage(utteranceFromMessage(prior))
      : "(none)";
  const mutations = message?.reasoningMutations ?? [];
  const speaker = message ? agentLabel(message.agentId) : "unknown";
  const events = args.graph.events.filter(
    (event) => event.turnIndex === args.turn,
  );
  const accepted = events.filter(
    (event) => event.accepted && event.mutation.type !== "final_answer",
  );
  const rejected = events.filter((event) => !event.accepted);
  const persistedRequest = message?.modelRequest?.find((item) =>
    item.content.startsWith("CURRENT SHARED REASONING STATE"),
  );
  const memorySource = persistedRequest
    ? "MEMORY PROVIDED TO MODEL (persisted request)"
    : "MEMORY PROVIDED TO MODEL (RECONSTRUCTED WITH CURRENT SERIALIZER)";
  const memoryBody = persistedRequest
    ? persistedRequest.content
    : formatReasoningState(before);
  const persistentChange = accepted.some(
    (event) =>
      event.mutation.type === "SET" ||
      event.mutation.type === "REVISE" ||
      event.mutation.type === "REMOVE",
  );
  return [
    `Turn ${args.turn} · ${speaker}`,
    persistentChange ? "" : "NO PERSISTENT CHANGE",
    "",
    "MESSAGE",
    message?.content?.trim() ? message.content : "(none)",
    "",
    "RAW STRUCTURED OUTPUT",
    message?.rawContent?.trim() || message?.content?.trim() || "(none)",
    "",
    "PARSED MUTATIONS",
    mutations.length > 0
      ? JSON.stringify(mutations, null, 2)
      : "[]",
    "",
    "ACCEPTED MUTATIONS",
    accepted.length > 0
      ? accepted
          .map((event) =>
            `${event.mutation.type}${
              "subjectId" in event.mutation && event.mutation.subjectId
                ? ` ${event.mutation.subjectId}`
                : ""
            }${event.versionId ? ` → ${event.versionId}` : ""}`,
          )
          .join("\n")
      : "(none)",
    "",
    "REJECTED MUTATIONS",
    rejected.length > 0
      ? rejected
          .map(
            (event) =>
              `${event.mutation.type}${
                "subjectId" in event.mutation && event.mutation.subjectId
                  ? ` ${event.mutation.subjectId}`
                  : ""
              }${
                event.mutation.type === "REVISE" && event.mutation.fromVersionId
                  ? ` from ${event.mutation.fromVersionId}`
                  : ""
              } — ${event.errors.join("; ") || "rejected"}`,
          )
          .join("\n")
      : "(none)",
    "",
    memorySource,
    memoryBody,
    "",
    previousToThisAgent,
    "",
    "STATE AFTER",
    formatReasoningState(after),
  ]
    .filter((line, index, lines) => !(line === "" && lines[index - 1] === ""))
    .join("\n");
}

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
    Array.isArray(args.conversation.reasoningEvents) ||
    Array.isArray(args.conversation.reasoningSubjects);
  const reasoningGraph = hasReasoning
    ? snapshotBeforeTurn(
        {
          schemaVersion: args.conversation.reasoningSchemaVersion === 1 ? 1 : 2,
          subjects: args.conversation.reasoningSubjects ?? [],
          versions: args.conversation.reasoningVersions ?? [],
          events: args.conversation.reasoningEvents ?? [],
        },
        args.message.turnIndex,
      )
    : undefined;

  const protocol = resolveTranscriptProtocol(args.run.transcriptProtocol);
  if (protocol.version === "full-history-v1") {
    const systemPrompt =
      speaker === "agent_a"
        ? args.run.agentPrompts.agentA
        : args.run.agentPrompts.agentB;
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: sharedProblemUserMessage(args.conversation.problemText) },
      ...(reasoningGraph
        ? [{ role: "user" as const, content: reasoningStateUserMessage(reasoningGraph) }]
        : []),
      ...prior.map((utterance) => ({
        role: "assistant" as const,
        content: formatUtteranceForProvider(utterance),
      })),
      {
        role: "user",
        content: turnCueUserMessage(speaker, args.message.turnIndex, args.run.config.maxTurns),
      },
    ];
  }

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
