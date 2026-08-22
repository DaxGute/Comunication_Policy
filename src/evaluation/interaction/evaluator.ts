/**
 * Universal interaction evaluator.
 *
 * Consumes the live reasoning graph (task-grounded by a thin adapter) and
 * produces one behavioral record for crossword, hidden profile, and moral tasks.
 */
import { hydrateReasoningGraph } from "../../reasoning";
import type { ProblemConversation } from "../../experiment/types";
import type { ProblemCategory } from "../../problems/types";
import type { ReasoningEffort } from "../../models/modelRegistry";
import { createModelClient, type ModelClient } from "../../runtime/modelClient";
import type { EvaluationArtifact, EvaluationCost, MarbleEvaluation } from "../types";
import {
  INTERACTION_EVALUATOR_VERSION,
  INTERACTION_SCHEMA_VERSION,
} from "../versions";
import { INTERACTION_ADAPTER_VERSION } from "./adapters";
import { collectInteractionEvents } from "./events";
import { computeMechanisms } from "./mechanisms";
import { buildDisagreements, computeInteractionMetrics } from "./metrics";
import { buildInteractionView } from "./objects";
import { deriveCrossSourcePatterns } from "./patterns";
import { opportunity } from "./rates";
import { runSemanticPass } from "./semantic";
import { computeInteractionTrajectory } from "./trajectory";
import type { InteractionEvaluation } from "./types";

export type InteractionEvaluateResult = {
  artifact: EvaluationArtifact<InteractionEvaluation>;
  cost: EvaluationCost;
};

function emptyEvaluation(
  conversation: ProblemConversation,
  problemType: ProblemCategory | string,
  extra: Partial<InteractionEvaluation["metadata"]>,
): InteractionEvaluation {
  const view = buildInteractionView(
    { schemaVersion: 2, subjects: [], versions: [], events: [] },
    problemType,
  );
  const events: InteractionEvaluation["events"] = [];
  const interaction = computeInteractionMetrics({
    view,
    events,
    messages: conversation.messages,
  });
  return {
    interaction,
    mechanisms: computeMechanisms({
      objects: [],
      events,
      disagreements: [],
    }),
    policyRelevantOutcomes: policyFrom(interaction, computeMechanisms({
      objects: [],
      events,
      disagreements: [],
    }), events),
    events,
    trajectory: [],
    semanticAnnotations: [],
    objects: [],
    patterns: [],
    metadata: {
      problemType,
      adapterVersion: INTERACTION_ADAPTER_VERSION,
      evaluatorVersion: INTERACTION_EVALUATOR_VERSION,
      graphMissing: true,
      graphMalformed: false,
      interrupted:
        conversation.stoppedReason === "cancelled" ||
        conversation.stoppedReason === "error",
      shortConversation: conversation.messages.length <= 2,
      provenance: {
        interaction: "graph_derived",
        efficiency: "deterministic",
      },
      ...extra,
    },
    graderVersion: INTERACTION_EVALUATOR_VERSION,
    schemaVersion: INTERACTION_SCHEMA_VERSION,
  };
}

function policyFrom(
  interaction: InteractionEvaluation["interaction"],
  mechanisms: InteractionEvaluation["mechanisms"],
  events: InteractionEvaluation["events"],
): InteractionEvaluation["policyRelevantOutcomes"] {
  const turns = interaction.efficiency.turns;
  const referenced = events.filter((event) => event.type === "referenced");
  const misunderstood = events.filter((event) => event.type === "misunderstood");
  return {
    trust: {
      adoption: interaction.adoption.adoption,
      unsupportedAdoption: interaction.adoption.unsupportedAdoption,
      verification: interaction.verification.independentVerification,
      verificationBeforeAcceptance:
        interaction.verification.verificationBeforeAcceptance,
      challengeBeforeAdoption: interaction.adoption.challengeBeforeAdoption,
      adoptionLatencyTurns: interaction.adoption.latencyTurns,
      independentConvergence: mechanisms.independentConvergence,
      claimPropagation: mechanisms.errorPropagation,
    },
    authority: {
      directionalInfluence: interaction.influence.centrality,
      directionalDeference: interaction.verification.unsupportedAcceptance,
      disagreementSurvival: interaction.influence.disagreementSurvival,
      proposalSurvival: interaction.influence.proposalSurvival,
      challengeAsymmetry: interaction.challenges.directional,
      concessionAsymmetry: interaction.influence.concessionDirection,
      finalAncestry: interaction.influence.finalAncestry,
      decisionConcentration: {
        herfindahl: interaction.influence.finalAncestry.herfindahl,
        dominantAgent: interaction.influence.finalAncestry.dominantAgent,
      },
    },
    familiarity: {
      repeatedInformation: interaction.efficiency.repetition,
      explicitReferences: opportunity(referenced.length, turns),
      establishedReuse: opportunity(
        referenced.length,
        interaction.contributions.introducedByAgent.agent_a +
          interaction.contributions.introducedByAgent.agent_b,
      ),
      clarificationRequests: interaction.efficiency.clarificationOverhead,
      misunderstanding: opportunity(misunderstood.length, turns),
      repair: interaction.corrections.corrected,
      productiveEventsPerTurn: interaction.efficiency.productiveEventsPerTurn,
      graphMutationsPerTurn: interaction.efficiency.graphMutationsPerTurn,
      turnsToSharedContext:
        interaction.adoption.latencyTurns.samples > 0
          ? interaction.adoption.latencyTurns.mean
          : null,
    },
  };
}

export function computeInteractionDynamics(options: {
  conversation: ProblemConversation;
  problemType: ProblemCategory | string;
  marble?: MarbleEvaluation;
}): InteractionEvaluation {
  try {
    const graph = hydrateReasoningGraph({
      reasoningSubjects: options.conversation.reasoningSubjects,
      reasoningVersions: options.conversation.reasoningVersions,
      reasoningEvents: options.conversation.reasoningEvents,
    });
    const graphMissing = graph.versions.length === 0 && graph.events.length === 0;
    const view = buildInteractionView(graph, options.problemType);
    const events = graphMissing
      ? []
      : collectInteractionEvents(view, options.conversation.messages);
    const disagreements = buildDisagreements(view, events);
    const interaction = computeInteractionMetrics({
      view,
      events,
      messages: options.conversation.messages,
    });
    const mechanisms = computeMechanisms({
      objects: view.objects,
      events,
      disagreements,
    });
    const record: InteractionEvaluation = {
      interaction,
      mechanisms,
      policyRelevantOutcomes: policyFrom(interaction, mechanisms, events),
      events,
      trajectory: graphMissing
        ? []
        : computeInteractionTrajectory({
            graph,
            events,
            messages: options.conversation.messages,
            category: options.problemType,
          }),
      semanticAnnotations: [],
      objects: view.objects,
      patterns: [],
      metadata: {
        problemType: options.problemType,
        adapterVersion: INTERACTION_ADAPTER_VERSION,
        evaluatorVersion: INTERACTION_EVALUATOR_VERSION,
        graphMissing,
        graphMalformed: false,
        interrupted:
          options.conversation.stoppedReason === "cancelled" ||
          options.conversation.stoppedReason === "error",
        shortConversation: options.conversation.messages.length <= 2,
        provenance: {
          interaction: "graph_derived",
          mechanisms: "graph_derived",
          policyRelevantOutcomes: "graph_derived",
          efficiency: "deterministic",
          events: "graph_derived",
          trajectory: "graph_derived",
        },
      },
      graderVersion: INTERACTION_EVALUATOR_VERSION,
      schemaVersion: INTERACTION_SCHEMA_VERSION,
    };
    record.patterns = deriveCrossSourcePatterns(record, options.marble);
    return record;
  } catch {
    return emptyEvaluation(options.conversation, options.problemType, {
      graphMalformed: true,
    });
  }
}

export async function evaluateInteraction(options: {
  conversation: ProblemConversation;
  problemType: ProblemCategory | string;
  evaluatorModel: string;
  reasoningEffort?: ReasoningEffort;
  client?: ModelClient;
  signal?: AbortSignal;
  marble?: MarbleEvaluation;
  includeSemanticPass?: boolean;
}): Promise<InteractionEvaluateResult> {
  const started = Date.now();
  const normalized = computeInteractionDynamics({
    conversation: options.conversation,
    problemType: options.problemType,
    marble: options.marble,
  });
  let cost: EvaluationCost = {
    model: options.evaluatorModel,
    provider: "mock",
    evaluator: "interaction",
    latencyMs: Date.now() - started,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
  let raw: unknown = { source: "reasoning_graph" };

  const sparse = normalized.events.length === 0;
  const include =
    options.includeSemanticPass !== false && sparse;
  if (include && options.conversation.messages.length > 0) {
    const client = options.client ?? createModelClient();
    try {
      const semantic = await runSemanticPass({
        conversation: options.conversation,
        problemType: options.problemType,
        graphEvents: normalized.events,
        evaluatorModel: options.evaluatorModel,
        reasoningEffort: options.reasoningEffort,
        client,
        signal: options.signal,
      });
      normalized.semanticAnnotations = semantic.annotations;
      normalized.metadata.provenance.semanticAnnotations = "llm_semantic";
      cost = { ...semantic.cost, latencyMs: Date.now() - started };
      raw = { source: "reasoning_graph", semantic: semantic.raw ?? null };
    } catch {
      // Semantic pass is optional; graph metrics still stand.
    }
  }

  return { artifact: { normalized, raw }, cost };
}
