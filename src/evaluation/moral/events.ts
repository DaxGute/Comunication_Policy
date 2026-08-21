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

    const mutation = event.mutation;
    if (mutation.type === "SET") {
      const nodeId = event.versionId;
      const idea = nodeId ? view.byId.get(nodeId) : undefined;
      events.push({
        ...baseEvent("idea_introduced", event, event.actor),
        ideaId: nodeId,
        canonicalIdeaId: idea?.canonicalId,
        relatedIdeaIds: idea?.parentIds,
      });
      continue;
    }

    if (mutation.type === "REVISE") {
      events.push({
        ...baseEvent("idea_revised", event, event.actor),
        ideaId: event.versionId,
        relatedIdeaIds: event.previousVersionId ? [event.previousVersionId] : undefined,
        canonicalIdeaId: event.versionId
          ? view.byId.get(event.versionId)?.canonicalId
          : undefined,
        resolution: "revision",
      });
      continue;
    }

    if (mutation.type === "REMOVE") {
      events.push({
        ...baseEvent("idea_abandoned", event, event.actor),
        ideaId: event.previousVersionId,
        resolution: "rejection",
      });
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

/** Inferred usage→adoption overlay. Not part of canonical moral events. */
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
  // Canonical moral events are graph mutations plus transcript cues.
  // Declared `basis` is provenance, not adoption; do not merge usage→adopted.
  return extractMoralEvents(view, messages);
}
