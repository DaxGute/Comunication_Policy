import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { MarbleEvaluation, MarbleMilestone } from "../types";
import {
  MARBLE_ADAPTER_VERSION,
  MARBLE_COMMIT,
  MARBLE_VERSION,
} from "../versions";
import { MARBLE_POSTHOC_NOTES } from "./metadata";

export type MarbleAdapterInput = {
  run: ExperimentRun;
  conversation: ProblemConversation;
  evaluatorModel: string;
};

export type MarblePosthocRequest = {
  evaluatorModel: string;
  task: string;
  messages: Array<{
    agentId: string;
    turnIndex: number;
    content: string;
  }>;
  finalAnswer?: string;
  agentProfiles: string;
  agentTasks: string;
  summary: string;
  results: string;
};

/** Map our immutable conversation artifact into MARBLE evaluator inputs. */
export function toMarblePosthocRequest(
  input: MarbleAdapterInput,
): MarblePosthocRequest {
  const { run, conversation, evaluatorModel } = input;
  const messages = conversation.messages.map((m) => ({
    agentId: m.agentId,
    turnIndex: m.turnIndex,
    content: m.content,
  }));

  const communications = messages
    .map((m) => `[Turn ${m.turnIndex}] ${m.agentId}: ${m.content}`)
    .join("\n\n");

  const agentProfiles = [
    `agent_a: Two-agent collaborative solver. System prompt snapshot length=${run.agentPrompts.agentA.length}.`,
    `agent_b: Two-agent collaborative solver. System prompt snapshot length=${run.agentPrompts.agentB.length}.`,
  ].join("\n");

  // Avoid leaking trust/authority/familiarity into MARBLE prompts (evaluator leakage).
  const agentTasks =
    "Both agents share one problem and must produce a joint FINAL_ANSWER through alternating turns.";

  const results = [
    conversation.finalAnswer
      ? `FINAL_ANSWER: ${conversation.finalAnswer}`
      : "No FINAL_ANSWER recorded.",
    `stoppedReason: ${conversation.stoppedReason}`,
    communications.slice(-4000),
  ].join("\n\n");

  return {
    evaluatorModel,
    task: `${conversation.problemTitle}\n\n${conversation.problemText}`,
    messages,
    finalAnswer: conversation.finalAnswer,
    agentProfiles,
    agentTasks,
    summary: communications || "No communication occurred.",
    results,
  };
}

export function normalizeMarbleResult(
  raw: unknown,
  fallback?: Partial<MarbleEvaluation>,
): MarbleEvaluation {
  const root =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const normalized =
    root.normalized && typeof root.normalized === "object"
      ? (root.normalized as Record<string, unknown>)
      : root;

  const communicationScore = asScore(normalized.communicationScore);
  const planningScore = asScore(normalized.planningScore);
  let coordinationScore = asScore(normalized.coordinationScore);
  if (
    coordinationScore === null &&
    communicationScore !== null &&
    planningScore !== null
  ) {
    coordinationScore = (communicationScore + planningScore) / 2;
  }

  const agentKpis = asNumberRecord(normalized.agentKpis);
  const totalMilestones =
    typeof normalized.totalMilestones === "number"
      ? normalized.totalMilestones
      : Object.values(agentKpis).reduce((sum, n) => sum + n, 0);

  const milestones = asMilestones(normalized.milestones);
  const milestoneCompletion =
    totalMilestones > 0
      ? Math.min(1, milestones.length / Math.max(totalMilestones, 1))
      : null;

  return {
    communicationScore,
    planningScore,
    coordinationScore,
    totalMilestones,
    agentKpis,
    milestones,
    milestoneCompletion,
    marbleCommit:
      (typeof normalized.marbleCommit === "string"
        ? normalized.marbleCommit
        : undefined) ?? MARBLE_COMMIT,
    marbleVersion:
      (typeof normalized.marbleVersion === "string"
        ? normalized.marbleVersion
        : undefined) ?? MARBLE_VERSION,
    adapterVersion: MARBLE_ADAPTER_VERSION,
    mode: "posthoc_evaluator",
    limitations: [
      ...MARBLE_POSTHOC_NOTES,
      ...(Array.isArray(normalized.limitations)
        ? normalized.limitations.filter((x): x is string => typeof x === "string")
        : []),
      ...(fallback?.limitations ?? []),
    ],
  };
}

function asScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return value;
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return out;
}

function asMilestones(value: unknown): MarbleMilestone[] {
  if (!Array.isArray(value)) return [];
  const out: MarbleMilestone[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const milestone =
      typeof row.milestone === "string"
        ? row.milestone
        : typeof row.description === "string"
          ? row.description
          : undefined;
    if (!milestone) continue;
    const agentsRaw = row.agents ?? row.contributing_agents;
    const agents = Array.isArray(agentsRaw)
      ? agentsRaw.filter((a): a is string => typeof a === "string")
      : [];
    out.push({ milestone, agents });
  }
  return out;
}
