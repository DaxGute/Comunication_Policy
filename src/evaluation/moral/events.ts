/**
 * Evaluation events reduced from the reasoning graph + transcript cues.
 *
 * These are the durable records later metrics fold. Do not invent graph
 * events that the conversation never produced.
 */
import type { ConversationMessage } from "../../experiment/types";
import type { ReasoningEvent } from "../../reasoning/types";
import {
  createdNodeId,
  eventChangedState,
  groundingSourceIds,
  isAgent,
  isAxiomNode,
  isEvaluableNode,
  isSynthesisNode,
  operationTargetId,
  otherAgent,
  type MoralGraphView,
} from "./graphView";
import type { MoralAgentId, MoralEvalEvent } from "./types";

const CLARIFY_RE =
  /\b(clarif(?:y|ication)|what do you mean|could you (?:explain|expand)|i don'?t follow)\b/i;

export function extractMoralEvents(
  view: MoralGraphView,
  messages: ConversationMessage[],
): MoralEvalEvent[] {
  const events: MoralEvalEvent[] = [];
  const adopted = new Set<string>();
  const justifiedBy = new Map<MoralAgentId, Set<string>>();
  justifiedBy.set("agent_a", new Set());
  justifiedBy.set("agent_b", new Set());

  const originOf = (nodeId: string | undefined): MoralAgentId | "system" | undefined => {
    if (!nodeId) return undefined;
    return view.byId.get(nodeId)?.originatingAgent;
  };

  for (const event of view.graph.events) {
    if (event.turnIndex <= 0) continue;
    if (!isAgent(event.actor)) continue;

    if (!event.accepted) {
      if (isRepetitionEvent(event)) {
        events.push(baseEvent("repetition", event, event.actor));
      }
      continue;
    }

    if (!eventChangedState(event) || isRepetitionEvent(event)) {
      if (isRepetitionEvent(event)) {
        events.push(baseEvent("repetition", event, event.actor));
      }
      if (!eventChangedState(event)) continue;
    }

    const op = event.operation;
    if (op.type === "create") {
      const node = op.node;
      if (!isEvaluableNode(node)) continue;
      const idea = view.byId.get(node.id);
      const type = isAxiomNode(node) ? "axiom_introduced" : "idea_introduced";
      events.push({
        ...baseEvent(type, event, event.actor),
        ideaId: node.id,
        canonicalIdeaId: idea?.canonicalId,
        relatedIdeaIds: idea?.parentIds,
      });
      const parentIds = idea?.parentIds ?? groundingSourceIds(event);
      if (idea && isSynthesisNode(parentIds, view.originById)) {
        events.push({
          ...baseEvent("idea_synthesized", event, event.actor),
          ideaId: node.id,
          relatedIdeaIds: parentIds,
          resolution: "synthesis",
        });
      }
      recordIndependentJustification(
        event.actor,
        parentIds,
        originOf,
        justifiedBy,
      );
      continue;
    }

    if (op.type === "revise") {
      events.push({
        ...baseEvent("idea_revised", event, event.actor),
        ideaId: op.replacement.id,
        relatedIdeaIds: [op.targetId],
        canonicalIdeaId: view.byId.get(op.replacement.id)?.canonicalId,
        resolution: "revision",
      });
      const parents = view.byId.get(op.replacement.id)?.parentIds ?? [];
      if (isSynthesisNode(parents, view.originById)) {
        events.push({
          ...baseEvent("idea_synthesized", event, event.actor),
          ideaId: op.replacement.id,
          relatedIdeaIds: parents,
          resolution: "synthesis",
        });
      }
      maybeConcession(events, view, event, op.targetId);
      continue;
    }

    if (op.type === "support" || op.type === "accept") {
      const targetId = operationTargetId(event);
      const idea = targetId ? view.byId.get(targetId) : undefined;
      if (!idea || !isAgent(idea.originatingAgent)) continue;
      if (op.type === "support" && op.sourceNodeId) {
        const sourceOrigin = originOf(op.sourceNodeId);
        if (sourceOrigin === event.actor) {
          justifiedBy.get(event.actor)?.add(targetId!);
        }
      }
      if (idea.originatingAgent !== event.actor) {
        maybeAdoption(events, view, event, idea.id, adopted, justifiedBy);
      } else if (op.type === "support") {
        events.push({
          ...baseEvent("idea_strengthened", event, event.actor, {
            ideaId: idea.id,
            canonicalIdeaId: idea.canonicalId,
          }),
        });
      }
      continue;
    }

    if (op.type === "challenge") {
      const targetId = op.targetNodeId;
      const idea = view.byId.get(targetId);
      if (!idea) continue;
      const type = idea.kind === "axiom" ? "axiom_challenged" : "idea_challenged";
      const targetAgent = isAgent(idea.originatingAgent)
        ? idea.originatingAgent
        : undefined;
      events.push({
        ...baseEvent(type, event, event.actor, {
          targetAgent,
          ideaId: targetId,
          canonicalIdeaId: idea.canonicalId,
        }),
      });
      continue;
    }

    if (op.type === "reject") {
      const targetId = op.targetId;
      const idea = view.byId.get(targetId);
      if (!idea) continue;
      events.push({
        ...baseEvent(
          idea.kind === "axiom" ? "axiom_abandoned" : "idea_rejected",
          event,
          event.actor,
          {
            targetAgent: isAgent(idea.originatingAgent)
              ? idea.originatingAgent
              : undefined,
            ideaId: targetId,
            canonicalIdeaId: idea.canonicalId,
            resolution: "rejection",
          },
        ),
      });
      if (
        isAgent(idea.originatingAgent) &&
        event.actor === idea.originatingAgent
      ) {
        events.push({
          ...baseEvent("idea_abandoned", event, event.actor, {
            ideaId: targetId,
            canonicalIdeaId: idea.canonicalId,
            resolution: "rejection",
          }),
        });
      }
      maybeConcession(events, view, event, targetId);
    }
  }

  for (const message of messages) {
    if (!isAgent(message.agentId)) continue;
    const content = message.content ?? "";
    if (!content.trim()) continue;
    const asks = content.includes("?");
    const clarify = CLARIFY_RE.test(content);
    if (asks || clarify) {
      events.push({
        type: "clarification",
        turn: message.turnIndex,
        actor: message.agentId,
        targetAgent: otherAgent(message.agentId),
      });
    }
  }

  return events.sort((a, b) => a.turn - b.turn);
}

function baseEvent(
  type: MoralEvalEvent["type"],
  event: ReasoningEvent,
  actor: MoralAgentId,
  extra: Partial<MoralEvalEvent> = {},
): MoralEvalEvent {
  return {
    type,
    turn: event.turnIndex,
    actor,
    ...extra,
  };
}

function isRepetitionEvent(event: ReasoningEvent): boolean {
  if (event.stateChanged === false) return true;
  if (
    event.diagnostics?.some(
      (item) =>
        item === "no_state_change" || item.startsWith("no_state_change:"),
    )
  ) {
    return true;
  }
  const errors = event.errors ?? [];
  return errors.some(
    (error) =>
      error.startsWith("duplicate of ") ||
      error.includes("already the live candidate"),
  );
}

function recordIndependentJustification(
  actor: MoralAgentId,
  parentIds: string[],
  originOf: (id: string | undefined) => MoralAgentId | "system" | undefined,
  justifiedBy: Map<MoralAgentId, Set<string>>,
): void {
  for (const parentId of parentIds) {
    const origin = originOf(parentId);
    if (origin && origin !== actor && origin !== "system") {
      justifiedBy.get(actor)?.add(parentId);
    }
  }
}

function maybeAdoption(
  events: MoralEvalEvent[],
  view: MoralGraphView,
  event: ReasoningEvent,
  ideaId: string,
  adopted: Set<string>,
  justifiedBy: Map<MoralAgentId, Set<string>>,
): void {
  if (!isAgent(event.actor)) return;
  const idea = view.byId.get(ideaId);
  if (!idea || !isAgent(idea.originatingAgent)) return;
  if (idea.originatingAgent === event.actor) return;
  const key = `${event.actor}:${ideaId}`;
  if (adopted.has(key)) return;
  adopted.add(key);

  const independent =
    justifiedBy.get(event.actor)?.has(ideaId) === true ||
    groundingSourceIds(event).some((sourceId) => {
      const source = view.graph.nodes.find((node) => node.id === sourceId);
      return source?.createdBy === event.actor;
    });

  const type = idea.kind === "axiom" ? "axiom_adopted" : "idea_adopted";
  events.push({
    ...baseEvent(type, event, event.actor, {
      targetAgent: idea.originatingAgent,
      ideaId,
      canonicalIdeaId: idea.canonicalId,
      resolution: "acceptance",
    }),
  });

  if (independent) {
    events.push({
      ...baseEvent("independent_justification", event, event.actor, {
        targetAgent: idea.originatingAgent,
        ideaId,
        canonicalIdeaId: idea.canonicalId,
      }),
    });
  } else {
    events.push({
      ...baseEvent("unsupported_adoption", event, event.actor, {
        targetAgent: idea.originatingAgent,
        ideaId,
        canonicalIdeaId: idea.canonicalId,
      }),
    });
  }
}

function maybeConcession(
  events: MoralEvalEvent[],
  view: MoralGraphView,
  event: ReasoningEvent,
  targetId: string,
): void {
  if (!isAgent(event.actor)) return;
  const idea = view.byId.get(targetId);
  if (!idea || idea.originatingAgent !== event.actor) return;
  const challenged = view.graph.events.some(
    (prior) =>
      prior.accepted &&
      prior.turnIndex <= event.turnIndex &&
      prior.operation.type === "challenge" &&
      isAgent(prior.actor) &&
      prior.actor !== event.actor &&
      (prior.operation.targetNodeId === targetId ||
        prior.operation.targetId === targetId),
  );
  if (!challenged) return;
  events.push({
    ...baseEvent("concession", event, event.actor, {
      targetAgent: otherAgent(event.actor),
      ideaId: targetId,
      canonicalIdeaId: idea.canonicalId,
      resolution:
        event.operation.type === "revise" ? "revision" : "rejection",
    }),
  });
}

export function adoptionViaUsageEvents(view: MoralGraphView): MoralEvalEvent[] {
  const extra: MoralEvalEvent[] = [];
  const seen = new Set<string>();
  for (const event of view.graph.events) {
    if (!event.accepted || !eventChangedState(event)) continue;
    if (!isAgent(event.actor)) continue;
    const createdId = createdNodeId(event);
    const sources = groundingSourceIds(event);
    for (const sourceId of sources) {
      const source = view.byId.get(sourceId);
      if (!source || !isAgent(source.originatingAgent)) continue;
      if (source.originatingAgent === event.actor) continue;
      const key = `${event.actor}:${sourceId}:use`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = source.kind === "axiom" ? "axiom_adopted" : "idea_adopted";
      extra.push({
        type,
        turn: event.turnIndex,
        actor: event.actor,
        targetAgent: source.originatingAgent,
        ideaId: sourceId,
        relatedIdeaIds: createdId ? [createdId] : undefined,
        canonicalIdeaId: source.canonicalId,
        resolution: "acceptance",
      });
    }
  }
  return extra;
}

export function mergeMoralEvents(
  graphEvents: MoralEvalEvent[],
  usageEvents: MoralEvalEvent[],
): MoralEvalEvent[] {
  const seen = new Set<string>();
  const out: MoralEvalEvent[] = [];
  for (const event of [...graphEvents, ...usageEvents]) {
    const key = [
      event.type,
      event.turn,
      event.actor,
      event.ideaId ?? "",
      event.relatedIdeaIds?.join(",") ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out.sort((a, b) => a.turn - b.turn);
}

export function collectMoralEvents(
  view: MoralGraphView,
  messages: ConversationMessage[],
): MoralEvalEvent[] {
  return mergeMoralEvents(
    extractMoralEvents(view, messages),
    adoptionViaUsageEvents(view),
  );
}
