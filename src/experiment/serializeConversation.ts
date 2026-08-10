import type { AgentId } from "../agents/types";
import type { ProblemEvaluation } from "../evaluation/types";
import type { ExperimentRun, ProblemConversation } from "./types";

export type ConversationExportMessage = {
  index: number;
  sender: AgentId;
  recipient: AgentId;
  role: "assistant";
  content: string;
  timestamp?: string;
};

export type ConversationExportAgent = {
  id: AgentId;
  system_prompt: string;
};

export type ConversationExport = {
  schema_version: "1.0";
  run_id: string;
  conversation_id: string;
  problem: {
    id: string;
    title: string;
    problem_set: string;
    prompt: string;
  };
  configuration: {
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
  /** Per-problem evaluation when available; empty object if not yet evaluated. */
  evaluations: Record<string, unknown>;
};

function otherAgent(agentId: AgentId): AgentId {
  return agentId === "agent_a" ? "agent_b" : "agent_a";
}

function serializeEvaluations(
  evaluation: ProblemEvaluation | undefined,
): Record<string, unknown> {
  if (!evaluation) return {};
  return {
    problem: {
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
    },
  };
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

  return {
    schema_version: "1.0",
    run_id: run.id,
    conversation_id: conversation.problemId,
    problem: {
      id: conversation.problemId,
      title: conversation.problemTitle,
      problem_set: run.config.problemCategory,
      prompt: conversation.problemText,
    },
    configuration: {
      model: run.config.model,
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
      return exported;
    }),
    result: {
      ...(conversation.finalAnswer !== undefined
        ? { final_answer: conversation.finalAnswer }
        : {}),
      status: conversation.stoppedReason,
    },
    evaluations: serializeEvaluations(evaluation),
  };
}
