/**
 * Moral/philosophical dynamics evaluator.
 *
 * Uses the live idea/axiom graph already extracted during the conversation.
 * Deterministic metrics always run; a single optional judge call is appended
 * when a non-mock evaluator model is provided.
 */
import { hydrateReasoningGraph } from "../../reasoning";
import type { ProblemConversation } from "../../experiment/types";
import type { ReasoningEffort } from "../../models/modelRegistry";
import { createModelClient, type ModelClient } from "../../runtime/modelClient";
import type { EvaluationArtifact, EvaluationCost } from "../types";
import {
  MORAL_DYNAMICS_SCHEMA_VERSION,
  MORAL_DYNAMICS_VERSION,
  MORAL_JUDGE_VERSION,
} from "../versions";
import { collectMoralEvents } from "./events";
import { buildMoralGraphView } from "./graphView";
import { evaluateMoralJudge } from "./judge";
import { computeMoralMetrics } from "./metrics";
import { computeMoralTrajectories } from "./trajectories";
import type {
  MoralDynamicsEvaluation,
  MoralEvalMetadata,
  MoralMetricSource,
} from "./types";

export type MoralEvaluateResult = {
  artifact: EvaluationArtifact<MoralDynamicsEvaluation>;
  cost: EvaluationCost;
};

const PROVENANCE: Record<string, MoralMetricSource> = {
  contribution: "graph_derived",
  adoption: "graph_derived",
  disagreement: "graph_derived",
  axioms: "graph_derived",
  development: "graph_derived",
  efficiency: "deterministic",
  trust: "graph_derived",
  authority: "graph_derived",
  familiarity: "graph_derived",
  events: "graph_derived",
  trajectories: "graph_derived",
  judgeScores: "llm_judge",
};

export function computeMoralDynamics(options: {
  conversation: ProblemConversation;
}): MoralDynamicsEvaluation {
  try {
    return computeMoralDynamicsUnsafe(options);
  } catch {
    const fallback = computeMoralDynamicsUnsafe({
      conversation: {
        ...options.conversation,
        reasoningSubjects: [],
        reasoningNodes: [],
        reasoningEvents: [],
      },
    });
    fallback.metadata.graphMalformed = true;
    fallback.metadata.graphMissing = true;
    fallback.semanticAnnotations.extractionCompleteness = "missing";
    return fallback;
  }
}

function computeMoralDynamicsUnsafe(options: {
  conversation: ProblemConversation;
}): MoralDynamicsEvaluation {
  const graph = hydrateReasoningGraph({
    reasoningSubjects: options.conversation.reasoningSubjects,
    reasoningNodes: options.conversation.reasoningNodes,
    reasoningEvents: options.conversation.reasoningEvents,
  });
  const graphMissing =
    graph.nodes.length === 0 && graph.events.length === 0;
  const view = buildMoralGraphView(graph);
  const events = graphMissing
    ? []
    : collectMoralEvents(view, options.conversation.messages);
  const turns = options.conversation.messages.map((m) => m.turnIndex);
  const trajectories = graphMissing
    ? []
    : computeMoralTrajectories(graph, events, turns);
  const deterministic = computeMoralMetrics({
    view,
    events,
    messages: options.conversation.messages,
  });
  const ideaCount = view.ideas.filter((i) => i.kind === "idea").length;
  const axiomCount = view.ideas.filter((i) => i.kind === "axiom").length;
  const aIdeas = deterministic.contribution.ideaCountByAgent.agent_a;
  const bIdeas = deterministic.contribution.ideaCountByAgent.agent_b;
  const metadata: MoralEvalMetadata = {
    provenance: { ...PROVENANCE },
    graphMissing,
    graphMalformed: false,
    interrupted:
      options.conversation.stoppedReason === "cancelled" ||
      options.conversation.stoppedReason === "error",
    earlyFinalAnswer:
      options.conversation.stoppedReason === "final_answer" &&
      options.conversation.messages.length <= 2,
    shortConversation: options.conversation.messages.length <= 2,
    oneSidedContribution:
      (aIdeas === 0 && bIdeas > 0) || (bIdeas === 0 && aIdeas > 0),
    noDisagreement: deterministic.disagreement.disagreementEvents === 0,
    noAdoption:
      (deterministic.adoption.adoption.overall.denominator ?? 0) === 0 ||
      deterministic.adoption.adoption.overall.numerator === 0,
    noExplicitAxioms: axiomCount === 0,
    graderVersion: MORAL_DYNAMICS_VERSION,
    schemaVersion: MORAL_DYNAMICS_SCHEMA_VERSION,
  };
  return {
    deterministic,
    events,
    trajectories,
    semanticAnnotations: {
      source: "reasoning_graph",
      ideaCount,
      axiomCount,
      graphNodeCount: graph.nodes.length,
      graphEventCount: graph.events.length,
      extractionCompleteness: graphMissing
        ? "missing"
        : graph.events.length > 0
          ? "full"
          : "partial",
      ideas: view.ideas,
    },
    metadata,
    graderVersion: MORAL_DYNAMICS_VERSION,
    schemaVersion: MORAL_DYNAMICS_SCHEMA_VERSION,
  };
}

export async function evaluateMoralDynamics(options: {
  conversation: ProblemConversation;
  evaluatorModel: string;
  reasoningEffort?: ReasoningEffort;
  client?: ModelClient;
  signal?: AbortSignal;
  includeJudge?: boolean;
}): Promise<MoralEvaluateResult> {
  const started = Date.now();
  const normalized = computeMoralDynamics({
    conversation: options.conversation,
  });
  const includeJudge = options.includeJudge !== false;
  const client = options.client ?? createModelClient();
  let cost: EvaluationCost = {
    model: options.evaluatorModel,
    provider: "mock",
    evaluator: "moral_dynamics",
    latencyMs: Date.now() - started,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  let raw: unknown = {
    source: "reasoning_graph",
    judge: null,
  };

  if (includeJudge && options.conversation.messages.length > 0) {
    const graph = hydrateReasoningGraph({
      reasoningSubjects: options.conversation.reasoningSubjects,
      reasoningNodes: options.conversation.reasoningNodes,
      reasoningEvents: options.conversation.reasoningEvents,
    });
    const view = buildMoralGraphView(graph);
    const judged = await evaluateMoralJudge({
      conversation: options.conversation,
      view,
      events: normalized.events,
      evaluatorModel: options.evaluatorModel,
      reasoningEffort: options.reasoningEffort,
      client,
      signal: options.signal,
    });
    if (judged.scores) {
      normalized.judgeScores = judged.scores;
      normalized.metadata.judgeVersion = MORAL_JUDGE_VERSION;
    }
    cost = {
      ...judged.cost,
      latencyMs: Date.now() - started,
    };
    raw = {
      source: "reasoning_graph",
      judge: judged.raw ?? null,
    };
  }

  return {
    artifact: { normalized, raw },
    cost,
  };
}
