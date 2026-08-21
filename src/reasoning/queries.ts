/**
 * Read-only queries over a materialized reasoning graph.
 */
import { materializeGraph } from "./graph";
import { isStateChangeMutation } from "./types";
import type { PropositionVersion, ReasoningEvent, ReasoningGraph } from "./types";

/** Reconstruct the graph as it existed after `turn` (inclusive). */
export function snapshotThroughTurn(
  graph: ReasoningGraph,
  turn: number,
): ReasoningGraph {
  return materializeGraph(
    graph.events.filter((event) => event.turnIndex <= turn),
    graph.subjects.filter(
      (subject) =>
        subject.source === "task" ||
        (subject.createdAtTurn !== undefined && subject.createdAtTurn <= turn),
    ),
  );
}
export function snapshotBeforeTurn(
  graph: ReasoningGraph,
  turn: number,
): ReasoningGraph {
  return materializeGraph(
    graph.events.filter((event) => event.turnIndex < turn),
    graph.subjects.filter(
      (subject) =>
        subject.source === "task" ||
        (subject.createdAtTurn !== undefined && subject.createdAtTurn < turn),
    ),
  );
}

export function versionsCreatedInMessage(
  graph: ReasoningGraph,
  messageId: string,
): PropositionVersion[] {
  return graph.versions.filter((version) => version.sourceMessageId === messageId);
}

export function eventsForMessage(
  graph: ReasoningGraph,
  messageId: string,
): ReasoningEvent[] {
  return graph.events.filter((event) => event.messageId === messageId);
}

export function versionIdsTouchedByMessage(
  graph: ReasoningGraph,
  messageId: string,
): string[] {
  const ids = new Set<string>();
  for (const version of versionsCreatedInMessage(graph, messageId)) {
    ids.add(version.id);
  }
  for (const event of eventsForMessage(graph, messageId)) {
    if (event.versionId) ids.add(event.versionId);
    if (event.previousVersionId) ids.add(event.previousVersionId);
    for (const basisId of event.basisVersionIds ?? []) ids.add(basisId);
  }
  return [...ids];
}

/** @deprecated Use versionIdsTouchedByMessage. */
export function nodeIdsTouchedByMessage(
  graph: ReasoningGraph,
  messageId: string,
): string[] {
  return versionIdsTouchedByMessage(graph, messageId);
}

export function eventsForVersion(
  graph: ReasoningGraph,
  versionId: string,
): ReasoningEvent[] {
  return graph.events.filter(
    (event) =>
      event.versionId === versionId ||
      event.previousVersionId === versionId ||
      event.basisVersionIds?.includes(versionId),
  );
}

/** @deprecated Use eventsForVersion. */
export function eventsForNode(
  graph: ReasoningGraph,
  nodeId: string,
): ReasoningEvent[] {
  return eventsForVersion(graph, nodeId);
}

export function acceptedStateChangeEvents(events: ReasoningEvent[]): ReasoningEvent[] {
  return events.filter(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation),
  );
}
