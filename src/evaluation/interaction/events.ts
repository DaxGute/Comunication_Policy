/**
 * Universal interaction events from the reasoning graph + transcript cues.
 *
 * Same event types for crossword fills, proof lemmas, and moral claims.
 */
import type { ConversationMessage } from "../../experiment/types";
import type { ReasoningEvent } from "../../reasoning/types";
import {
  createdNodeId,
  eventChangedState,
  groundingSourceIds,
  isAgent,
  isEvaluableNode,
  isSynthesisNode,
  operationTargetId,
  otherAgent,
  type InteractionGraphView,
} from "./objects";
import type {
  InteractionAgentId,
  InteractionEvent,
  InteractionEventType,
} from "./types";

const CLARIFY_RE =
  /\b(clarif(?:y|ication)|what do you mean|could you (?:explain|expand)|i don'?t follow)\b/i;

let eventSeq = 0;

function nextId(): string {
  eventSeq += 1;
  return `ie_${eventSeq}`;
}

function base(
  type: InteractionEventType,
  event: ReasoningEvent,
  actor: InteractionAgentId,
  extra: Partial<InteractionEvent> = {},
): InteractionEvent {
  return {
    id: nextId(),
    type,
    turn: event.turnIndex,
    actor,
    source: "graph",
    evidenceTurns: [event.turnIndex],
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
  return (event.errors ?? []).some(
    (error) =>
      error.startsWith("duplicate of ") ||
      error.includes("already the live candidate"),
  );
}

export function collectInteractionEvents(
  view: InteractionGraphView,
  messages: ConversationMessage[],
): InteractionEvent[] {
  eventSeq = 0;
  const events: InteractionEvent[] = [];
  const adopted = new Set<string>();
  const justifiedBy = new Map<InteractionAgentId, Set<string>>([
    ["agent_a", new Set()],
    ["agent_b", new Set()],
  ]);

  const originOf = (id: string | undefined) =>
    id ? view.byId.get(id)?.originatingAgent : undefined;

  for (const event of view.graph.events) {
    if (event.turnIndex <= 0 || !isAgent(event.actor)) continue;

    if (!event.accepted) {
      if (isRepetitionEvent(event)) {
        events.push(base("repeated", event, event.actor));
      }
      continue;
    }

    if (!eventChangedState(event) || isRepetitionEvent(event)) {
      if (isRepetitionEvent(event)) {
        events.push(base("repeated", event, event.actor));
      }
      if (!eventChangedState(event)) continue;
    }

    const op = event.operation;
    if (op.type === "create") {
      if (!isEvaluableNode(op.node)) continue;
      const object = view.byId.get(op.node.id);
      events.push(
        base("introduced", event, event.actor, {
          objectId: op.node.id,
          relatedObjectIds: object?.parentIds,
        }),
      );
      const parentIds = object?.parentIds ?? groundingSourceIds(event);
      if (object && isSynthesisNode(parentIds, view.originById)) {
        events.push(
          base("synthesized", event, event.actor, {
            objectId: op.node.id,
            relatedObjectIds: parentIds,
          }),
        );
      }
      for (const parentId of parentIds) {
        const origin = originOf(parentId);
        if (!origin || origin === "system") continue;
        events.push(
          base("referenced", event, event.actor, {
            objectId: parentId,
            targetAgent: isAgent(origin) ? origin : undefined,
          }),
        );
        if (origin !== event.actor) {
          justifiedBy.get(event.actor)?.add(parentId);
        }
      }
      continue;
    }

    if (op.type === "revise") {
      events.push(
        base("revised", event, event.actor, {
          objectId: op.replacement.id,
          relatedObjectIds: [op.targetId],
        }),
      );
      events.push(
        base("superseded", event, event.actor, {
          objectId: op.targetId,
          relatedObjectIds: [op.replacement.id],
        }),
      );
      const parents = view.byId.get(op.replacement.id)?.parentIds ?? [];
      if (isSynthesisNode(parents, view.originById)) {
        events.push(
          base("synthesized", event, event.actor, {
            objectId: op.replacement.id,
            relatedObjectIds: parents,
          }),
        );
      }
      maybeConcession(events, view, event, op.targetId);
      continue;
    }

    if (op.type === "support" || op.type === "accept") {
      const targetId = operationTargetId(event);
      const object = targetId ? view.byId.get(targetId) : undefined;
      if (!object || !isAgent(object.originatingAgent)) continue;
      if (op.type === "support") {
        events.push(
          base("supported", event, event.actor, {
            objectId: targetId,
            relatedObjectIds: op.sourceNodeId ? [op.sourceNodeId] : undefined,
          }),
        );
        events.push(
          base("referenced", event, event.actor, {
            objectId: targetId,
            targetAgent: isAgent(object.originatingAgent)
              ? object.originatingAgent
              : undefined,
          }),
        );
        if (op.sourceNodeId && originOf(op.sourceNodeId) === event.actor) {
          justifiedBy.get(event.actor)?.add(targetId!);
        }
      }
      if (object.originatingAgent !== event.actor) {
        maybeAdoption(events, view, event, object.id, adopted, justifiedBy);
      }
      continue;
    }

    if (op.type === "challenge") {
      const targetId = op.targetNodeId;
      const object = view.byId.get(targetId);
      if (!object) continue;
      events.push(
        base("challenged", event, event.actor, {
          targetAgent: isAgent(object.originatingAgent)
            ? object.originatingAgent
            : undefined,
          objectId: targetId,
        }),
      );
      continue;
    }

    if (op.type === "reject") {
      const object = view.byId.get(op.targetId);
      if (!object) continue;
      events.push(
        base("rejected", event, event.actor, {
          targetAgent: isAgent(object.originatingAgent)
            ? object.originatingAgent
            : undefined,
          objectId: op.targetId,
        }),
      );
      if (isAgent(object.originatingAgent) && event.actor === object.originatingAgent) {
        events.push(
          base("withdrawn", event, event.actor, { objectId: op.targetId }),
        );
      }
      maybeConcession(events, view, event, op.targetId);
      continue;
    }

    if (op.type === "final_answer") {
      events.push(
        base("finalized", event, event.actor, {
          relatedObjectIds: op.supportingNodeIds,
        }),
      );
    }
  }

  for (const event of view.graph.events) {
    if (!event.accepted || !eventChangedState(event) || !isAgent(event.actor)) {
      continue;
    }
    const created = createdNodeId(event);
    for (const sourceId of groundingSourceIds(event)) {
      const source = view.byId.get(sourceId);
      if (!source || !isAgent(source.originatingAgent)) continue;
      if (source.originatingAgent === event.actor) continue;
      const key = `${event.actor}:${sourceId}:use`;
      if (adopted.has(key)) continue;
      adopted.add(key);
      events.push(
        base("adopted", event, event.actor, {
          targetAgent: source.originatingAgent,
          objectId: sourceId,
          relatedObjectIds: created ? [created] : undefined,
        }),
      );
    }
  }

  for (const message of messages) {
    if (!isAgent(message.agentId)) continue;
    const content = message.content ?? "";
    if (content.includes("?") || CLARIFY_RE.test(content)) {
      events.push({
        id: nextId(),
        type: "requested_clarification",
        actor: message.agentId,
        targetAgent: otherAgent(message.agentId),
        turn: message.turnIndex,
        source: "transcript",
        evidenceTurns: [message.turnIndex],
      });
    }
  }

  return events.sort((a, b) => a.turn - b.turn);
}

function maybeAdoption(
  events: InteractionEvent[],
  view: InteractionGraphView,
  event: ReasoningEvent,
  objectId: string,
  adopted: Set<string>,
  justifiedBy: Map<InteractionAgentId, Set<string>>,
): void {
  if (!isAgent(event.actor)) return;
  const object = view.byId.get(objectId);
  if (!object || !isAgent(object.originatingAgent)) return;
  if (object.originatingAgent === event.actor) return;
  const key = `${event.actor}:${objectId}`;
  if (adopted.has(key)) return;
  adopted.add(key);

  const independent =
    justifiedBy.get(event.actor)?.has(objectId) === true ||
    groundingSourceIds(event).some((sourceId) => {
      const source = view.graph.nodes.find((node) => node.id === sourceId);
      return source?.createdBy === event.actor;
    });

  events.push(
    base("adopted", event, event.actor, {
      targetAgent: object.originatingAgent,
      objectId,
    }),
  );
  events.push(
    base("accepted", event, event.actor, {
      targetAgent: object.originatingAgent,
      objectId,
    }),
  );
  if (independent) {
    events.push(
      base("independently_derived", event, event.actor, {
        targetAgent: object.originatingAgent,
        objectId,
      }),
    );
    events.push(
      base("verified", event, event.actor, {
        targetAgent: object.originatingAgent,
        objectId,
      }),
    );
  } else {
    events.push(
      base("unsupported_adoption", event, event.actor, {
        targetAgent: object.originatingAgent,
        objectId,
      }),
    );
  }
}

function maybeConcession(
  events: InteractionEvent[],
  view: InteractionGraphView,
  event: ReasoningEvent,
  targetId: string,
): void {
  if (!isAgent(event.actor)) return;
  const object = view.byId.get(targetId);
  if (!object || object.originatingAgent !== event.actor) return;
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
  events.push(
    base("conceded", event, event.actor, {
      targetAgent: otherAgent(event.actor),
      objectId: targetId,
    }),
  );
  if (event.operation.type === "revise") {
    events.push(
      base("corrected", event, event.actor, { objectId: targetId }),
    );
  }
}
