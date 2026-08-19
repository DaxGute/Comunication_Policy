/**
 * Optional single semantic-annotation pass.
 *
 * Task context is included so the model can interpret utterances, but the
 * output schema is universal. Communication-policy sliders are omitted.
 * Mock evaluators skip this call.
 */
import type { ProblemConversation } from "../../experiment/types";
import type { ProblemCategory } from "../../problems/types";
import type { ReasoningEffort } from "../../models/modelRegistry";
import type { ModelClient } from "../../runtime/modelClient";
import { isMockModel } from "../../runtime/models";
import { calculateModelCost } from "../../models/cost";
import type { EvaluationCost } from "../types";
import type { InteractionAgentId, InteractionEvent, SemanticAnnotation } from "./types";

function isAgentId(value: unknown): value is InteractionAgentId {
  return value === "agent_a" || value === "agent_b";
}

export type SemanticPassResult = {
  annotations: SemanticAnnotation[];
  cost: EvaluationCost;
  raw?: unknown;
};

function extractJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

export function buildSemanticPrompt(options: {
  conversation: ProblemConversation;
  problemType: ProblemCategory | string;
  graphEvents: InteractionEvent[];
}): { system: string; user: string } {
  const transcript = options.conversation.messages
    .map((m) => {
      const who = m.agentId === "agent_a" ? "Agent A" : "Agent B";
      return `TURN ${m.turnIndex} | ${who}\n${m.content}`;
    })
    .join("\n\n");
  const system = [
    "You annotate a two-agent problem-solving conversation for INTERACTION semantics.",
    "The task type is provided only so you can interpret domain language.",
    "Output a universal annotation schema. Do not score which answer is correct.",
    "Do not infer or mention communication-policy parameters or slider values.",
    "Respond with ONLY valid JSON.",
  ].join(" ");
  const user = `TASK TYPE: ${options.problemType}

PROBLEM
${options.conversation.problemTitle}
${options.conversation.problemText}

FINAL ANSWER
${options.conversation.finalAnswer ?? "(none)"}

GRAPH EVENTS ALREADY EXTRACTED
${options.graphEvents
  .slice(0, 80)
  .map((e) => `- t${e.turn} ${e.actor} ${e.type}${e.objectId ? ` ${e.objectId}` : ""}`)
  .join("\n") || "(none)"}

TRANSCRIPT
${transcript || "(empty)"}

OUTPUT:
{
  "annotations": [
    {
      "turn": number,
      "type": "explicit_agreement" | "reluctant_agreement" | "uncertainty" | "challenge" | "clarification" | "misunderstanding" | "correction" | "deference" | "independent_justification" | "counterargument" | "repetition" | "reference",
      "actor": "agent_a" | "agent_b",
      "targetAgent": "agent_a" | "agent_b",
      "confidence": 0-1,
      "evidence": "short quote"
    }
  ]
}`;
  return { system, user };
}

export async function runSemanticPass(options: {
  conversation: ProblemConversation;
  problemType: ProblemCategory | string;
  graphEvents: InteractionEvent[];
  evaluatorModel: string;
  reasoningEffort?: ReasoningEffort;
  client: ModelClient;
  signal?: AbortSignal;
}): Promise<SemanticPassResult> {
  const started = Date.now();
  if (isMockModel(options.evaluatorModel)) {
    return {
      annotations: [],
      cost: {
        model: options.evaluatorModel,
        provider: "mock",
        evaluator: "interaction",
        latencyMs: Date.now() - started,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  }
  const { system, user } = buildSemanticPrompt(options);
  const response = await options.client.generate({
    model: options.evaluatorModel,
    temperature: 0,
    reasoningEffort: options.reasoningEffort,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    signal: options.signal,
  });
  const parsed = extractJson(response.content);
  const annotations: SemanticAnnotation[] = [];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { annotations?: unknown }).annotations)) {
    for (const raw of (parsed as { annotations: unknown[] }).annotations) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      if (!isAgentId(item.actor) || typeof item.turn !== "number" || typeof item.type !== "string") {
        continue;
      }
      annotations.push({
        turn: item.turn,
        type: item.type,
        actor: item.actor,
        targetAgent: isAgentId(item.targetAgent) ? item.targetAgent : undefined,
        confidence: typeof item.confidence === "number" ? item.confidence : undefined,
        evidence: typeof item.evidence === "string" ? item.evidence : undefined,
      });
    }
  }
  const usage = {
    inputTokens: response.usage?.inputTokens ?? response.usage?.promptTokens ?? 0,
    cachedInputTokens: response.usage?.cachedInputTokens,
    outputTokens: response.usage?.outputTokens ?? response.usage?.completionTokens ?? 0,
  };
  return {
    annotations,
    raw: { modelOutput: response.content, parsed },
    cost: {
      model: options.evaluatorModel,
      provider: "openai",
      evaluator: "interaction",
      inputTokens: usage.inputTokens || undefined,
      cachedInputTokens: usage.cachedInputTokens,
      outputTokens: usage.outputTokens || undefined,
      totalTokens:
        usage.inputTokens + usage.outputTokens > 0
          ? usage.inputTokens + usage.outputTokens
          : response.usage?.totalTokens,
      latencyMs: Date.now() - started,
      estimatedCostUsd: calculateModelCost(options.evaluatorModel, usage),
    },
  };
}
