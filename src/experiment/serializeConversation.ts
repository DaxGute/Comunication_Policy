/**
 * Canonical JSON export of a conversation or full run for copy/download.
 *
 * Parsing of stored runs is parsePersisted.ts; this module only serializes out.
 */
import { otherAgentId } from "../agents/identity";
import type { AgentId } from "../agents/types";
import type { ProblemEvaluation } from "../evaluation/types";
import { resolveRunModel } from "./configAccessors";
import { deriveConversationEfficiency } from "./conversationEfficiency";
import {
  resolveTranscriptProtocol,
  type TranscriptProtocol,
} from "./transcriptProtocol";
import type { ExperimentRun, ProblemConversation } from "./types";
import type { ReasoningEvent, ReasoningIntent, ReasoningNode, ReasoningOperation } from "../reasoning/types";
import { hydrateReasoningGraph } from "../reasoning";

export type ConversationExportMessage = {
  index: number;
  sender: AgentId;
  recipient: AgentId;
  turn: number;
  role: "assistant";
  content: string;
  timestamp?: string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    total_tokens: number;
    source?: "provider" | "estimated";
  };
  model_request?: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  request_telemetry?: {
    turn_number: number;
    speaker: AgentId;
    transcript_characters_before_turn: number;
    transcript_messages_before_turn: number;
    request_characters: number;
    system_prompt_characters: number;
    problem_characters: number;
    history_characters: number;
  };
  raw_content?: string;
  reasoning_intents?: ReasoningIntent[];
  reasoning_operations?: ReasoningOperation[];
};

export type ConversationExportAgent = {
  id: AgentId;
  system_prompt: string;
};

export type ConversationExportProtocol = TranscriptProtocol;

export type ConversationExportEfficiency = {
  turn_count: number;
  final_transcript_characters: number;
  final_transcript_messages: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_conversation_tokens?: number;
  average_input_tokens_per_turn?: number;
  average_output_tokens_per_utterance?: number;
  conversation_cost_usd?: number | null;
  usage_source?: "provider" | "estimated" | "mixed";
};

export type ConversationExport = {
  schema_version: "1.4";
  run_id: string;
  conversation_id: string;
  problem: {
    id: string;
    title: string;
    problem_set: string;
    prompt: string;
  };
  configuration: {
    run_model: string;
    run_reasoning_effort: string;
    evaluation_model: string;
    evaluation_reasoning_effort: string;
    /** @deprecated Prefer run_model; kept for older analysis scripts. */
    model: string;
    provider: "mock" | "openai";
    temperature: number;
    max_turns: number;
    communication_policy: {
      trustA: number;
      trustB: number;
      authority: number;
      familiarity: number;
    };
  };
  transcript_protocol: ConversationExportProtocol;
  agents: ConversationExportAgent[];
  messages: ConversationExportMessage[];
  result: {
    final_answer?: string;
    supporting_node_ids?: string[];
    supporting_node_errors?: string[];
    status: ProblemConversation["stoppedReason"];
  };
  reasoning?: {
    nodes: ReasoningNode[];
    events: ReasoningEvent[];
  };
  usage: {
    conversation?: {
      input_tokens: number;
      cached_input_tokens?: number;
      output_tokens: number;
      cost_usd?: number | null;
    };
  };
  efficiency: ConversationExportEfficiency;
  /** Per-problem evaluation when available; empty object if not yet evaluated. */
  evaluations: Record<string, unknown>;
};

function serializeEvaluations(
  evaluation: ProblemEvaluation | undefined,
  run: ExperimentRun,
  problemId: string,
): Record<string, unknown> {
  const multi = (run.multiAgentEvaluations ?? []).filter(
    (e) => e.problemId === problemId,
  );
  const out: Record<string, unknown> = {};
  if (evaluation) {
    out.problem = {
      problem_id: evaluation.problemId,
      problem_title: evaluation.problemTitle,
      turns: evaluation.turns,
      ...(evaluation.finalAnswer !== undefined
        ? { final_answer: evaluation.finalAnswer }
        : {}),
      ...(evaluation.score !== undefined ? { score: evaluation.score } : {}),
      ...(evaluation.label !== undefined ? { label: evaluation.label } : {}),
      ...(evaluation.notes !== undefined ? { notes: evaluation.notes } : {}),
      ...(evaluation.details !== undefined
        ? { details: evaluation.details }
        : {}),
    };
  }
  if (multi.length > 0) {
    out.multi_agent = multi.map((e) => ({
      id: e.id,
      evaluator_model: e.evaluatorModel,
      reasoning_effort: e.reasoningEffort,
      created_at: e.createdAt,
      finished_at: e.finishedAt,
      status: e.status,
      usage: e.usage,
      cost_usd: e.costUsd,
      metrics: {
        marble: e.marble?.normalized,
        belief_dynamics: e.beliefDynamics?.normalized.metrics,
      },
    }));
  }
  return out;
}

/**
 * Canonical machine-parseable export of one finished problem conversation.
 * Keeps experiment analysis independent of React/store shapes.
 */
export function serializeConversation(
  conversation: ProblemConversation,
  run: ExperimentRun,
): ConversationExport {
  const evaluation = run.evaluation?.problems.find(
    (problem) => problem.problemId === conversation.problemId,
  );
  const runModel = resolveRunModel(run.config);

  return {
    schema_version: "1.4",
    run_id: run.id,
    conversation_id: conversation.problemId,
    problem: {
      id: conversation.problemId,
      title: conversation.problemTitle,
      problem_set: run.config.problemCategory,
      prompt: conversation.problemText,
    },
    configuration: {
      run_model: runModel,
      run_reasoning_effort: run.config.runReasoningEffort,
      evaluation_model: run.config.evaluationModel,
      evaluation_reasoning_effort: run.config.evaluationReasoningEffort,
      model: runModel,
      provider: run.config.provider,
      temperature: run.config.temperature,
      max_turns: run.config.maxTurns,
      communication_policy: {
        trustA: run.policy.trustA,
        trustB: run.policy.trustB,
        authority: run.policy.authority,
        familiarity: run.policy.familiarity,
      },
    },
    transcript_protocol: resolveTranscriptProtocol(run.transcriptProtocol),
    agents: [
      {
        id: "agent_a",
        system_prompt: run.agentPrompts.agentA,
      },
      {
        id: "agent_b",
        system_prompt: run.agentPrompts.agentB,
      },
    ],
    messages: conversation.messages.map((message, index) => {
      const sender = message.sender ?? message.agentId;
      const exported: ConversationExportMessage = {
        index,
        sender,
        recipient: message.recipient ?? otherAgentId(sender),
        turn: message.turnIndex,
        role: message.role,
        content: message.content,
      };
      if (message.timestamp) {
        exported.timestamp = message.timestamp;
      }
      if (message.usage) {
        exported.usage = {
          input_tokens: message.usage.inputTokens ?? message.usage.promptTokens,
          cached_input_tokens: message.usage.cachedInputTokens,
          output_tokens:
            message.usage.outputTokens ?? message.usage.completionTokens,
          total_tokens: message.usage.totalTokens,
          ...(message.usage.source ? { source: message.usage.source } : {}),
        };
      }
      if (message.modelRequest && message.modelRequest.length > 0) {
        exported.model_request = message.modelRequest;
      }
      if (message.requestTelemetry) {
        const t = message.requestTelemetry;
        exported.request_telemetry = {
          turn_number: t.turnNumber,
          speaker: t.speaker,
          transcript_characters_before_turn: t.transcriptCharactersBeforeTurn,
          transcript_messages_before_turn: t.transcriptMessagesBeforeTurn,
          request_characters: t.requestCharacters,
          system_prompt_characters: t.systemPromptCharacters,
          problem_characters: t.problemCharacters,
          history_characters: t.historyCharacters,
        };
      }
      if (message.rawContent) {
        exported.raw_content = message.rawContent;
      }
      if (message.reasoningIntents && message.reasoningIntents.length > 0) {
        exported.reasoning_intents = message.reasoningIntents;
      }
      if (message.reasoningOperations && message.reasoningOperations.length > 0) {
        exported.reasoning_operations = message.reasoningOperations;
      }
      return exported;
    }),
    result: {
      ...(conversation.finalAnswer !== undefined
        ? { final_answer: conversation.finalAnswer }
        : {}),
      ...(conversation.finalAnswerSupport?.supportingNodeIds?.length
        ? {
            supporting_node_ids:
              conversation.finalAnswerSupport.supportingNodeIds,
          }
        : {}),
      ...(conversation.finalAnswerSupport?.errors?.length
        ? {
            supporting_node_errors: conversation.finalAnswerSupport.errors,
          }
        : {}),
      status: conversation.stoppedReason,
    },
    ...(Array.isArray(conversation.reasoningNodes) ||
    Array.isArray(conversation.reasoningEvents)
      ? {
          reasoning: (() => {
            const graph = hydrateReasoningGraph({
              reasoningNodes: conversation.reasoningNodes,
              reasoningEvents: conversation.reasoningEvents,
            });
            return {
              nodes: graph.nodes,
              events: graph.events,
            };
          })(),
        }
      : {}),
    usage: {
      ...(conversation.conversationUsage
        ? {
            conversation: {
              input_tokens: conversation.conversationUsage.inputTokens,
              cached_input_tokens:
                conversation.conversationUsage.cachedInputTokens,
              output_tokens: conversation.conversationUsage.outputTokens,
              cost_usd: conversation.conversationCostUsd,
            },
          }
        : {}),
    },
    efficiency: (() => {
      const stats = deriveConversationEfficiency(conversation);
      return {
        turn_count: stats.turnCount,
        final_transcript_characters: stats.finalTranscriptCharacters,
        final_transcript_messages: stats.finalTranscriptMessages,
        ...(stats.totalInputTokens !== undefined
          ? { total_input_tokens: stats.totalInputTokens }
          : {}),
        ...(stats.totalOutputTokens !== undefined
          ? { total_output_tokens: stats.totalOutputTokens }
          : {}),
        ...(stats.totalConversationTokens !== undefined
          ? { total_conversation_tokens: stats.totalConversationTokens }
          : {}),
        ...(stats.averageInputTokensPerTurn !== undefined
          ? { average_input_tokens_per_turn: stats.averageInputTokensPerTurn }
          : {}),
        ...(stats.averageOutputTokensPerUtterance !== undefined
          ? {
              average_output_tokens_per_utterance:
                stats.averageOutputTokensPerUtterance,
            }
          : {}),
        ...(stats.conversationCostUsd !== undefined
          ? { conversation_cost_usd: stats.conversationCostUsd }
          : {}),
        ...(stats.usageSource ? { usage_source: stats.usageSource } : {}),
      };
    })(),
    evaluations: serializeEvaluations(
      evaluation,
      run,
      conversation.problemId,
    ),
  };
}

export type RunExport = {
  schema_version: "1.4";
  run_id: string;
  title?: string;
  created_at: string;
  finished_at?: string;
  status: ExperimentRun["status"];
  error?: string;
  transcript_protocol: ConversationExportProtocol;
  usage: {
    conversation?: {
      input_tokens: number;
      cached_input_tokens?: number;
      output_tokens: number;
      cost_usd?: number | null;
    };
    evaluation?: {
      input_tokens: number;
      cached_input_tokens?: number;
      output_tokens: number;
      cost_usd?: number | null;
    };
    total_cost_usd?: number | null;
  };
  conversations: ConversationExport[];
};

/**
 * Canonical machine-parseable export of an entire experiment run.
 * Conversations reuse {@link serializeConversation} so per-problem analysis
 * scripts keep working on nested entries.
 */
export function serializeRun(run: ExperimentRun): RunExport {
  return {
    schema_version: "1.4",
    run_id: run.id,
    ...(run.title ? { title: run.title } : {}),
    created_at: run.createdAt,
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
    transcript_protocol: resolveTranscriptProtocol(run.transcriptProtocol),
    usage: {
      ...(run.conversationUsage
        ? {
            conversation: {
              input_tokens: run.conversationUsage.inputTokens,
              cached_input_tokens: run.conversationUsage.cachedInputTokens,
              output_tokens: run.conversationUsage.outputTokens,
              cost_usd: run.conversationCostUsd,
            },
          }
        : {}),
      ...(run.evaluationUsage
        ? {
            evaluation: {
              input_tokens: run.evaluationUsage.inputTokens,
              cached_input_tokens: run.evaluationUsage.cachedInputTokens,
              output_tokens: run.evaluationUsage.outputTokens,
              cost_usd: run.evaluationCostUsd,
            },
          }
        : {}),
      ...(run.totalCostUsd !== undefined
        ? { total_cost_usd: run.totalCostUsd }
        : {}),
    },
    conversations: run.conversations.map((conversation) =>
      serializeConversation(conversation, run),
    ),
  };
}
