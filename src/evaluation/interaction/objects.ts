/**
 * Universal reasoning objects over the live ReasoningGraph.
 *
 * Task adapters only assign object kind + grounding; ancestry and survival
 * are graph-derived and shared.
 */
import type { ProblemCategory } from "../../problems/types";
import type { ReasoningActor, ReasoningGraph } from "../../reasoning/types";
import {
  branchingFactor,
  buildMoralGraphView,
  childIdsOf,
  createdNodeId,
  descendantsOf,
  edgesOf,
  eventChangedState,
  groundingSourceIds,
  isAgent,
  isEvaluableNode,
  isSynthesisNode,
  maxGraphDepth,
  meanGraphDepth,
  operationTargetId,
  otherAgent,
  parentIdsOf,
} from "../moral/graphView";
import { interactionAdapterFor } from "./adapters";
import type {
  InteractionAgentId,
  ReasoningObject,
  ReasoningObjectKind,
} from "./types";

export {
  branchingFactor,
  childIdsOf,
  createdNodeId,
  descendantsOf,
  edgesOf,
  eventChangedState,
  groundingSourceIds,
  isAgent,
  isEvaluableNode,
  isSynthesisNode,
  maxGraphDepth,
  meanGraphDepth,
  operationTargetId,
  otherAgent,
  parentIdsOf,
};

export type InteractionGraphView = {
  graph: ReasoningGraph;
  objects: ReasoningObject[];
  byId: Map<string, ReasoningObject>;
  originById: Map<string, ReasoningActor>;
  finalClosure: Set<string>;
  category: ProblemCategory | string;
};

export function buildInteractionView(
  graph: ReasoningGraph,
  category: ProblemCategory | string | undefined,
): InteractionGraphView {
  const adapter = interactionAdapterFor(category);
  const base = buildMoralGraphView(graph);
  const objects: ReasoningObject[] = base.ideas.map((idea) => {
    const node = graph.nodes.find((item) => item.id === idea.id);
    const kind: ReasoningObjectKind = node
      ? adapter.objectKind(node)
      : idea.kind === "axiom"
        ? "axiom"
        : "claim";
    return {
      id: idea.id,
      canonicalId: idea.canonicalId,
      kind,
      text: idea.text,
      originatingAgent: idea.originatingAgent,
      firstTurn: idea.firstTurn,
      subsequentTurns: idea.subsequentTurns,
      supportingAgents: idea.supportingAgents,
      challengingAgents: idea.challengingAgents,
      supersedes: idea.supersedes,
      supersededBy: idea.supersededBy,
      parentIds: idea.parentIds,
      childIds: idea.childIds,
      inFinalPosition: idea.inFinalPosition,
      status: idea.status,
      confidence: idea.confidence,
      unsupported: idea.unsupported,
      taskGrounding: node ? adapter.taskGrounding(node) : undefined,
    };
  });
  return {
    graph,
    objects,
    byId: new Map(objects.map((object) => [object.id, object])),
    originById: base.originById,
    finalClosure: base.finalClosure,
    category: category ?? "generic",
  };
}

export function agentObjects(
  objects: ReasoningObject[],
  agent: InteractionAgentId,
): ReasoningObject[] {
  return objects.filter((object) => object.originatingAgent === agent);
}

export function partnerOriginated(
  objects: ReasoningObject[],
  actor: InteractionAgentId,
): ReasoningObject[] {
  return agentObjects(objects, otherAgent(actor));
}
