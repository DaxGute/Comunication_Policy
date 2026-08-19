/**
 * Optional single moral-reasoning judge.
 *
 * Does not ask which answer is morally correct and never receives
 * communication-policy treatment values.
 */
import { calculateModelCost } from "../../models/cost";
import type { ReasoningEffort } from "../../models/modelRegistry";
import type { ProblemConversation } from "../../experiment/types";
import type { ModelClient } from "../../runtime/modelClient";
import { isMockModel } from "../../runtime/models";
import type { EvaluationCost } from "../types";
import type { MoralGraphView } from "./graphView";
import type { MoralEvalEvent, MoralJudgeScores } from "./types";
import { MORAL_JUDGE_VERSION } from "../versions";

export type MoralJudgeResult = {
  scores?: MoralJudgeScores;
  cost: EvaluationCost;
  raw?: unknown;
};

function extractJsonObject(text: string): unknown | undefined {
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

function clamp01(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(4));
}

function parseJudgeScores(raw: unknown): MoralJudgeScores | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const contradictions = Array.isArray(o.unresolvedContradictions)
    ? o.unresolvedContradictions.filter((item): item is string => typeof item === "string")
    : [];
  return {
    reasoningCoherence: clamp01(o.reasoningCoherence),
    premiseConclusionConsistency: clamp01(o.premiseConclusionConsistency),
    counterargumentEngagement: clamp01(o.counterargumentEngagement),
    synthesisQuality: clamp01(o.synthesisQuality),
    finalPositionSupport: clamp01(o.finalPositionSupport),
    unresolvedContradictions: contradictions,
    notes: typeof o.notes === "string" ? o.notes : "",
  };
}

export function buildMoralJudgePrompt(options: {
  conversation: ProblemConversation;
  view: MoralGraphView;
  events: MoralEvalEvent[];
}): { system: string; user: string } {
  const transcript = options.conversation.messages
    .map((m) => {
      const who = m.agentId === "agent_a" ? "Agent A" : "Agent B";
      return `TURN ${m.turnIndex} | ${who}\n${m.content}`;
    })
    .join("\n\n");
  const ideas = options.view.ideas
    .filter((idea) => idea.originatingAgent !== "system")
    .slice(0, 40)
    .map((idea) => {
      return `- ${idea.id} [${idea.kind}] by ${idea.originatingAgent} t${idea.firstTurn} status=${idea.status} final=${idea.inFinalPosition} parents=${idea.parentIds.join(",") || "none"} :: ${idea.text.slice(0, 180)}`;
    })
    .join("\n");
  const eventSummary = options.events
    .slice(0, 60)
    .map((event) => {
      return `- t${event.turn} ${event.actor} ${event.type}${event.ideaId ? ` ${event.ideaId}` : ""}`;
    })
    .join("\n");

  const system = [
    "You are evaluating the reasoning process of a two-agent moral/philosophical conversation.",
    "Score the quality of reasoning, not which moral conclusion is correct.",
    "Do NOT decide which answer is morally right.",
    "Do NOT infer or mention communication-policy parameters, trust, authority, or familiarity sliders.",
    "Respond with ONLY valid JSON matching the required schema.",
    `Judge version ${MORAL_JUDGE_VERSION}.`,
  ].join(" ");

  const user = `PROBLEM
Title: ${options.conversation.problemTitle}
Text:
${options.conversation.problemText}

FINAL ANSWER
${options.conversation.finalAnswer ?? "(none)"}

IDEA / AXIOM GRAPH
${ideas || "(empty)"}

STRUCTURED EVENTS
${eventSummary || "(none)"}

TRANSCRIPT
${transcript || "(empty)"}

OUTPUT SCHEMA (JSON only):
{
  "reasoningCoherence": 0-1,
  "premiseConclusionConsistency": 0-1,
  "counterargumentEngagement": 0-1,
  "synthesisQuality": 0-1,
  "finalPositionSupport": 0-1,
  "unresolvedContradictions": ["..."],
  "notes": "short process notes, no moral verdict"
}`;

  return { system, user };
}

export async function evaluateMoralJudge(options: {
  conversation: ProblemConversation;
  view: MoralGraphView;
  events: MoralEvalEvent[];
  evaluatorModel: string;
  reasoningEffort?: ReasoningEffort;
  client: ModelClient;
  signal?: AbortSignal;
}): Promise<MoralJudgeResult> {
  const started = Date.now();
  if (isMockModel(options.evaluatorModel)) {
    return {
      scores: undefined,
      cost: {
        model: options.evaluatorModel,
        provider: "mock",
        evaluator: "moral_dynamics",
        latencyMs: Date.now() - started,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  }

  const { system, user } = buildMoralJudgePrompt({
    conversation: options.conversation,
    view: options.view,
    events: options.events,
  });
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
  const parsed = extractJsonObject(response.content);
  const scores = parseJudgeScores(parsed);
  const usage = {
    inputTokens: response.usage?.inputTokens ?? response.usage?.promptTokens ?? 0,
    cachedInputTokens: response.usage?.cachedInputTokens,
    outputTokens: response.usage?.outputTokens ?? response.usage?.completionTokens ?? 0,
  };
  return {
    scores,
    raw: { modelOutput: response.content, parsed },
    cost: {
      model: options.evaluatorModel,
      provider: "openai",
      evaluator: "moral_dynamics",
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
