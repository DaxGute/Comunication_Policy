/**
 * Alternating A↔B turn loop for a single problem.
 *
 * Owns turn sequencing and transcript append. Model HTTP/scheduling is the
 * ModelClient; problem selection and run-level parallelism are in runExperiment.
 */
import { otherAgentId } from "../agents/identity";
import type { AgentDefinition, AgentId } from "../agents/types";
import type { CommunicationPolicy } from "../communication/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import type { ConversationMessage } from "../experiment/types";
import { createId } from "../lib/id";
import type { ReasoningEffort } from "../models/modelRegistry";
import { taskReasoningAdapterFor } from "../problems/adapters/registry";
import type { Problem } from "../problems/types";
import {
  applyReasoningIntents,
  deriveIssueConvergenceStates,
  parseAgentTurn,
  recoverParsedTurn,
  seedGraphForProblem,
  type FinalAnswerSupport,
  type ReasoningGraph,
  type ReasoningIntent,
  type ReasoningOperation,
} from "../reasoning";
import {
  DEFAULT_STALL_FAIL_TURNS,
  DEFAULT_STALL_RECOVERY_TURNS,
  STRUCTURED_REASONING_MISSING_FEEDBACK,
  STRUCTURED_REASONING_STALL_FEEDBACK,
  acceptedGraphMutations,
} from "../reasoning/stall";
import { isAbortError, throwIfAborted } from "./abort";
import type { ModelClient } from "./modelClient";
import { buildTurnRequestForAgent } from "./renderModelRequest";
import { utteranceFromMessage } from "./transcript";

export type InteractionLoopCallbacks = {
  onMessage?: (message: ConversationMessage, graph: ReasoningGraph) => void;
  onSpeaking?: (agentId: AgentId | undefined) => void;
  onTurnProgress?: (turnIndex: number, maxTurns: number) => void;
  onReasoning?: (graph: ReasoningGraph) => void;
};

export type InteractionLoopResult = {
  messages: ConversationMessage[];
  finalAnswer?: string;
  finalAnswerSupport?: FinalAnswerSupport;
  reasoning: ReasoningGraph;
  stoppedReason:
    | "final_answer"
    | "max_turns"
    | "cancelled"
    | "error"
    | "reasoning_protocol_stalled";
  /** Set when `stoppedReason` is `error`. */
  error?: string;
};

function intentsFromTurn(intents: ReasoningIntent[]): ReasoningIntent[] | undefined {
  return intents.length > 0 ? intents : undefined;
}

function operationsFromEvents(
  operations: ReasoningOperation[],
): ConversationMessage["reasoningOperations"] {
  return operations.length > 0 ? operations : undefined;
}

/**
 * Simple alternating two-agent protocol: A → B → A → B → …
 * Natural-language transcript and reasoning graph are updated together.
 */
export async function runInteractionLoop(args: {
  problem: Problem;
  agentA: AgentDefinition;
  agentB: AgentDefinition;
  policy: CommunicationPolicy;
  model: string;
  temperature: number;
  maxTurns: number;
  stallRecoveryTurns?: number;
  stallFailTurns?: number;
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
    stallRecoveryTurns = DEFAULT_STALL_RECOVERY_TURNS,
    stallFailTurns = DEFAULT_STALL_FAIL_TURNS,
    reasoningEffort,
    client,
    signal,
    callbacks,
  } = args;

  const order: AgentId[] = ["agent_a", "agent_b"];
  const messages: ConversationMessage[] = [];
  const taskAdapter = taskReasoningAdapterFor(problem);
  let graph = seedGraphForProblem(problem, taskAdapter);
  let finalAnswerSupport: FinalAnswerSupport | undefined;
  let stallStreak = 0;
  let protocolFeedback: string | undefined;

  const stop = (
    reason: InteractionLoopResult["stoppedReason"],
    error?: string,
  ): InteractionLoopResult => {
    callbacks?.onSpeaking?.(undefined);
    return {
      messages,
      finalAnswer:
        finalAnswerSupport?.text ??
        extractFinalAnswerFromText(messages[messages.length - 1]?.content ?? ""),
      finalAnswerSupport,
      reasoning: graph,
      stoppedReason: reason,
      error,
    };
  };

  for (let turn = 1; turn <= maxTurns; turn++) {
    try {
      throwIfAborted(signal);
    } catch {
      return stop("cancelled");
    }

    const agentId = order[(turn - 1) % 2];
    callbacks?.onSpeaking?.(agentId);
    callbacks?.onTurnProgress?.(turn, maxTurns);

    const taskConflicts = taskAdapter.deriveConflicts?.(problem, graph) ?? [];
    const taskSignals =
      taskAdapter.deriveDeterministicEvidence?.(problem, graph) ?? [];
    const issueStates = deriveIssueConvergenceStates(graph, {
      conflicts: taskConflicts,
      deterministicSignals: taskSignals,
      currentTurn: turn - 1,
    });
    const taskLedgers = taskAdapter.deriveCandidateLedger?.(problem, graph);
    const { messages: requestMessages, telemetry } = buildTurnRequestForAgent({
      agentId,
      agentPrompts: {
        agentA: agentA.systemPrompt,
        agentB: agentB.systemPrompt,
      },
      problemText: problem.text,
      utterances: messages.map(utteranceFromMessage),
      turn,
      maxTurns,
      reasoningGraph: graph,
      issueStates,
      taskLedgers,
      protocolFeedback,
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
      if (isAbortError(error)) {
        return stop("cancelled");
      }
      return stop(
        "error",
        error instanceof Error ? error.message : String(error),
      );
    }

    const parsed = recoverParsedTurn(
      parseAgentTurn(response.content, agentId, turn),
      { problem, adapter: taskAdapter, graph },
    );
    const extraDiagnostics = [
      ...(parsed.normalizedFromMalformedShape
        ? ["normalizedFromMalformedShape"]
        : []),
      ...(parsed.extractedFromMessage ? ["extracted_from_message"] : []),
      ...(parsed.structuredReasoningMissing
        ? ["structured_reasoning_missing"]
        : []),
    ];
    const messageId = createId("msg");
    const applied = applyReasoningIntents(graph, parsed.intents, {
      actor: agentId,
      turnIndex: turn,
      messageId,
      protocolFailure: parsed.protocolFailure,
      finalAnswer: parsed.finalAnswerSupport,
      reopenSignals: taskSignals,
      conflicts: taskConflicts,
      candidateIdentity: (node) =>
        taskAdapter.candidateIdentity?.(problem, node),
      resolveSubjectAlias: (raw) =>
        taskAdapter.resolveSubject?.(problem, raw) ?? {},
      resolveBasis: (raw, subjectId) => {
        const resolved = taskAdapter.resolveBasis?.(problem, graph, raw, {
          subjectId,
        });
        if (!resolved) return {};
        return {
          id: resolved.id,
          relation: resolved.relation,
          error: resolved.error,
        };
      },
      autoGround: (subjectId) => {
        const node = graph.nodes.find(
          (item) =>
            item.type === "evidence" &&
            item.subjectId === subjectId &&
            (item.evidenceOrigin === "task" ||
              (Array.isArray(item.metadata?.aliases) &&
                item.metadata.aliases.includes("clue"))),
        );
        return node ? { nodeId: node.id, relation: "grounds" } : undefined;
      },
      extraDiagnostics,
    });
    graph = applied.graph;
    callbacks?.onReasoning?.(graph);

    if (applied.finalAnswerSupport) {
      finalAnswerSupport = applied.finalAnswerSupport;
    }

    const inputTokens =
      response.usage?.inputTokens ?? response.usage?.promptTokens;
    const outputTokens =
      response.usage?.outputTokens ?? response.usage?.completionTokens;

    const message: ConversationMessage = {
      id: messageId,
      agentId,
      sender: agentId,
      recipient: otherAgentId(agentId),
      role: "assistant",
      content: parsed.message,
      rawContent:
        parsed.raw !== parsed.message ? parsed.raw : undefined,
      reasoningMoves: parsed.moves.length > 0 ? parsed.moves : undefined,
      reasoningIntents: intentsFromTurn(parsed.intents),
      reasoningOperations: operationsFromEvents(
        applied.events.map((event) => event.operation),
      ),
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
            source: response.usage.source,
          }
        : undefined,
      requestTelemetry: telemetry,
      modelRequest: requestMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    messages.push(message);
    callbacks?.onMessage?.(message, graph);

    const mutationCount = acceptedGraphMutations(applied.events, turn);
    const substantive =
      parsed.moves.length > 0 ||
      parsed.extractedFromMessage ||
      parsed.structuredReasoningMissing ||
      Boolean(
        taskAdapter.messageLooksSubstantive?.(problem, parsed.message),
      );
    if (substantive && mutationCount === 0) {
      stallStreak += 1;
      protocolFeedback =
        parsed.structuredReasoningMissing && stallStreak < stallRecoveryTurns
          ? STRUCTURED_REASONING_MISSING_FEEDBACK
          : STRUCTURED_REASONING_STALL_FEEDBACK;
    } else if (mutationCount > 0) {
      stallStreak = 0;
      protocolFeedback = undefined;
    }
    if (stallStreak >= stallFailTurns) {
      return stop("reasoning_protocol_stalled");
    }

    const finalAnswer =
      parsed.finalAnswerSupport?.text ??
      extractFinalAnswerFromText(parsed.message);
    if (finalAnswer) {
      if (!finalAnswerSupport) {
        finalAnswerSupport = {
          text: finalAnswer,
          supportingNodeIds: [],
          errors: [],
        };
      } else if (!finalAnswerSupport.text) {
        finalAnswerSupport = { ...finalAnswerSupport, text: finalAnswer };
      }
      return stop("final_answer");
    }
  }

  return stop("max_turns");
}
