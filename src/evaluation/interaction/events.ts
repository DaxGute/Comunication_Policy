/**
 * Universal interaction events from the reasoning graph + transcript cues.
 *
 * Canonical graph facts only:
 *   A introduced X, B revised X, B derived Y from A's X, A removed Z.
 * Do not translate partner REVISE into accepted/adopted, or missing basis
 * into unsupported adoption. Stronger labels belong in inferred overlays.
 */
import type { ConversationMessage } from "../../experiment/types";
import type { ReasoningEvent } from "../../reasoning/types";
import {
  createdNodeId,
  eventChangedState,
  groundingSourceIds,
  isAgent,
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

    const mutation = event.mutation;
    if (mutation.type === "SET") {
      const objectId = event.versionId;
      events.push(
        base("introduced", event, event.actor, {
          objectId,
          relatedObjectIds: groundingSourceIds(event),
        }),
      );
    } else if (mutation.type === "REVISE") {
      const replacementId = event.versionId;
      const targetId = event.previousVersionId;
      events.push(
        base("revised", event, event.actor, {
          objectId: replacementId,
          relatedObjectIds: targetId ? [targetId] : undefined,
        }),
      );
      if (targetId) {
        events.push(
          base("superseded", event, event.actor, {
            objectId: targetId,
            relatedObjectIds: replacementId ? [replacementId] : undefined,
          }),
        );
      }
    } else if (mutation.type === "REMOVE") {
      events.push(
        base("withdrawn", event, event.actor, {
          objectId: event.previousVersionId,
        }),
      );
    } else if (mutation.type === "final_answer") {
      events.push(base("finalized", event, event.actor));
    }

    const created = createdNodeId(event);
    for (const sourceId of groundingSourceIds(event)) {
      const source = view.byId.get(sourceId);
      if (!source || !isAgent(source.originatingAgent)) continue;
      events.push(
        base("referenced", event, event.actor, {
          targetAgent:
            source.originatingAgent !== event.actor
              ? source.originatingAgent
              : undefined,
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
