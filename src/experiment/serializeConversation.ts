import type { AgentId } from "../agents/types";
import type { ProblemEvaluation } from "../evaluation/types";
import { resolveRunModel } from "./configAccessors";
import type { ExperimentRun, ProblemConversation } from "./types";

export type ConversationExportMessage = {
  index: number;
  sender: AgentId;
  recipient: AgentId;
  role: "assistant";
  content: string;
  timestamp?: string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    total_tokens: number;
  };
};

export type ConversationExportAgent = {
  id: AgentId;
  system_prompt: string;
};

export type ConversationExport = {
  schema_version: "1.1";
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
  agents: ConversationExportAgent[];
  messages: ConversationExportMessage[];
  result: {
    final_answer?: string;
    status: ProblemConversation["stoppedReason"];
  };
  usage: {
    conversation?: {
      input_tokens: number;
      cached_input_tokens?: number;
      output_tokens: number;
      cost_usd?: number | null;
    };
  };
  /** Per-problem evaluation when available; empty object if not yet evaluated. */
  evaluations: Record<string, unknown>;
};

function otherAgent(agentId: AgentId): AgentId {
  return agentId === "agent_a" ? "agent_b" : "agent_a";
}

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
    schema_version: "1.1",
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
      const exported: ConversationExportMessage = {
        index,
        sender: message.agentId,
        recipient: otherAgent(message.agentId),
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
        };
      }
      return exported;
    }),
    result: {
      ...(conversation.finalAnswer !== undefined
        ? { final_answer: conversation.finalAnswer }
        : {}),
      status: conversation.stoppedReason,
    },
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
    evaluations: serializeEvaluations(
      evaluation,
      run,
      conversation.problemId,
    ),
  };
}

export type RunExport = {
  schema_version: "1.1";
  run_id: string;
  title?: string;
  created_at: string;
  finished_at?: string;
  status: ExperimentRun["status"];
  error?: string;
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
    schema_version: "1.1",
    run_id: run.id,
    ...(run.title ? { title: run.title } : {}),
    created_at: run.createdAt,
    ...(run.finishedAt ? { finished_at: run.finishedAt } : {}),
    status: run.status,
    ...(run.error ? { error: run.error } : {}),
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
