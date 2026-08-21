/**
 * Turn-level collaboration / reasoning-depth diagnostics.
 * Derived from the event log + transcript. Never rewrites the graph.
 */
import type { AgentId } from "../agents/types";
import { looksLikePersistenceReview } from "./persistence";
import {
  isStateChangeMutation,
  mutationSubjectId,
  type ReasoningEvent,
  type ReasoningGraph,
} from "./types";

export type CollaborationTurnMessage = {
  turnIndex: number;
  agentId: AgentId;
  content: string;
  nothingToAdd?: boolean;
  readyToFinalize?: boolean;
  materialGraphChange?: boolean;
  readinessInvalidated?: boolean;
  focusSubjectIds?: string[];
};

export type TurnScopeDiagnostics = {
  turnIndex: number;
  agentId: AgentId;
  considerationsCreated: number;
  considerationsRevised: number;
  considerationsTouched: number;
  messageChars: number;
  graphChanged: boolean;
  partnerPriorGraphChange: boolean;
  readyToFinalize?: boolean;
  focusSubjectIds?: string[];
};

export type CollaborationDiagnostics = {
  turnCount: number;
  handoffCount: number;
  aSpoke: boolean;
  bSpoke: boolean;
  persistentWritesA: number;
  persistentWritesB: number;
  acceptedSetA: number;
  acceptedSetB: number;
  acceptedReviseA: number;
  acceptedReviseB: number;
  crossAgentRevisionCount: number;
  crossAgentDerivedFromCount: number;
  turnsWithNoPersistentChangeA: number;
  turnsWithNoPersistentChangeB: number;
  materialGraphChangeTurns: number;
  aChangeTurns: number;
  bChangeTurns: number;
  graphStateTransitions: number;
  convergenceAttempts: number;
  convergenceResets: number;
  distinctConsiderationsCreatedA: number;
  distinctConsiderationsCreatedB: number;
  revisionsA: number;
  revisionsB: number;
  lastMaterialChangeTurn: number | null;
  turnsFromLastMaterialChangeToFinal: number | null;
  finalizedBeforeBSpoke: boolean;
  finalizedBeforeBPersisted: boolean;
  /** Weak legacy flag; prefer the raw depth counters above. */
  lowCollaborationDepth: boolean;
  nothingToAddDeclared: boolean;
  persistenceRepairCount: number;
  uncapturedPartnerTurnCount: number;
  /** Per-turn local scope — not a composite score. Absent on older runs. */
  turnScopes?: TurnScopeDiagnostics[];
};

export type PersistentContribution = {
  agent_a: boolean;
  agent_b: boolean;
};

function acceptedStateEvents(graph: ReasoningGraph): ReasoningEvent[] {
  return graph.events.filter(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation) &&
      (event.actor === "agent_a" || event.actor === "agent_b"),
  );
}

function eventsForTurn(graph: ReasoningGraph, turnIndex: number): ReasoningEvent[] {
  return graph.events.filter((event) => event.turnIndex === turnIndex);
}

export function hasAcceptedPersistentWrite(
  graph: ReasoningGraph,
  agentId: AgentId,
): boolean {
  return acceptedStateEvents(graph).some(
    (event) =>
      event.actor === agentId &&
      (event.mutation.type === "SET" || event.mutation.type === "REVISE"),
  );
}

/**
 * Persistent contribution: accepted SET/REVISE by the agent, a consideration
 * they created, or another agent deriving from one of their versions.
 */
export function persistentContributionByAgent(
  graph: ReasoningGraph,
): PersistentContribution {
  const wrote: PersistentContribution = {
    agent_a: hasAcceptedPersistentWrite(graph, "agent_a"),
    agent_b: hasAcceptedPersistentWrite(graph, "agent_b"),
  };
  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  for (const version of graph.versions) {
    for (const sourceId of version.derivedFromVersionIds ?? []) {
      const source = byId.get(sourceId);
      if (!source || source.agentId === version.agentId) continue;
      if (source.agentId === "agent_a") wrote.agent_a = true;
      if (source.agentId === "agent_b") wrote.agent_b = true;
    }
  }
  for (const subject of graph.subjects) {
    if (subject.source !== "agent") continue;
    if (subject.createdBy === "agent_a") wrote.agent_a = true;
    if (subject.createdBy === "agent_b") wrote.agent_b = true;
  }
  return wrote;
}

export function partnerDeclaredNothingToAdd(
  messages: CollaborationTurnMessage[],
  partnerId: AgentId,
): boolean {
  return messages.some(
    (message) => message.agentId === partnerId && message.nothingToAdd === true,
  );
}

export function turnHadAcceptedPersistentChange(
  graph: ReasoningGraph,
  turnIndex: number,
): boolean {
  return eventsForTurn(graph, turnIndex).some(
    (event) =>
      event.accepted &&
      event.stateChanged !== false &&
      isStateChangeMutation(event.mutation) &&
      (event.mutation.type === "SET" ||
        event.mutation.type === "REVISE" ||
        event.mutation.type === "REMOVE"),
  );
}

/**
 * Previous partner turn was substantive natural language with no accepted
 * persistent change. Inspector warning and one-shot finalization repair.
 */
export function isUncapturedPartnerTurn(
  graph: ReasoningGraph,
  message: CollaborationTurnMessage,
): boolean {
  if (turnHadAcceptedPersistentChange(graph, message.turnIndex)) return false;
  if (message.nothingToAdd === true) return false;
  const events = eventsForTurn(graph, message.turnIndex);
  const attempted = events.some(
    (event) =>
      !event.accepted &&
      (event.mutation.type === "SET" ||
        event.mutation.type === "REVISE" ||
        event.mutation.type === "invalid"),
  );
  const substantive = looksLikePersistenceReview(message.content);
  return attempted || substantive;
}

/**
 * Per-turn local-scope counters for moral dialogue inspection.
 * Derived only — never rewrites the graph.
 */
export function computeTurnScopes(
  graph: ReasoningGraph,
  messages: CollaborationTurnMessage[],
): TurnScopeDiagnostics[] {
  const sorted = [...messages].sort((a, b) => a.turnIndex - b.turnIndex);
  return sorted.map((message, index) => {
    const turnEvents = eventsForTurn(graph, message.turnIndex).filter(
      (event) =>
        event.accepted &&
        event.stateChanged !== false &&
        isStateChangeMutation(event.mutation),
    );
    let considerationsCreated = 0;
    let considerationsRevised = 0;
    const touched = new Set<string>();
    for (const event of turnEvents) {
      const subjectId = mutationSubjectId(event.mutation);
      if (subjectId) touched.add(subjectId);
      if (event.mutation.type === "SET") considerationsCreated += 1;
      if (event.mutation.type === "REVISE") considerationsRevised += 1;
    }
    const graphChanged =
      message.materialGraphChange === true ||
      turnEvents.some(
        (event) =>
          event.mutation.type === "SET" ||
          event.mutation.type === "REVISE" ||
          event.mutation.type === "REMOVE",
      );
    let partnerPriorGraphChange = false;
    for (let i = index - 1; i >= 0; i--) {
      const prior = sorted[i]!;
      if (prior.agentId === message.agentId) continue;
      partnerPriorGraphChange =
        prior.materialGraphChange === true ||
        turnHadAcceptedPersistentChange(graph, prior.turnIndex);
      break;
    }
    return {
      turnIndex: message.turnIndex,
      agentId: message.agentId,
      considerationsCreated,
      considerationsRevised,
      considerationsTouched: touched.size,
      messageChars: message.content.length,
      graphChanged,
      partnerPriorGraphChange,
      ...(message.readyToFinalize === true || message.readyToFinalize === false
        ? { readyToFinalize: message.readyToFinalize }
        : {}),
      ...(message.focusSubjectIds && message.focusSubjectIds.length > 0
        ? { focusSubjectIds: message.focusSubjectIds }
        : {}),
    };
  });
}

export function computeCollaborationDiagnostics(
  graph: ReasoningGraph,
  messages: CollaborationTurnMessage[],
  options?: {
    stoppedReason?: string;
    persistenceRepairCount?: number;
    convergenceAttempts?: number;
    convergenceResets?: number;
    materialGraphChangeTurns?: number[];
    lastMaterialChangeTurn?: number;
  },
): CollaborationDiagnostics {
  const accepted = acceptedStateEvents(graph);
  const byId = new Map(graph.versions.map((version) => [version.id, version]));
  let acceptedSetA = 0;
  let acceptedSetB = 0;
  let acceptedReviseA = 0;
  let acceptedReviseB = 0;
  let crossAgentRevisionCount = 0;
  let crossAgentDerivedFromCount = 0;
  for (const event of accepted) {
    if (event.mutation.type === "SET") {
      if (event.actor === "agent_a") acceptedSetA += 1;
      else acceptedSetB += 1;
    } else if (event.mutation.type === "REVISE") {
      if (event.actor === "agent_a") acceptedReviseA += 1;
      else acceptedReviseB += 1;
      const previousId = event.previousVersionId;
      const previous = previousId ? byId.get(previousId) : undefined;
      if (
        previous &&
        event.actor !== "system" &&
        previous.agentId !== event.actor
      ) {
        crossAgentRevisionCount += 1;
      }
    }
  }
  for (const version of graph.versions) {
    for (const sourceId of version.derivedFromVersionIds ?? []) {
      const source = byId.get(sourceId);
      if (source && source.agentId !== version.agentId) {
        crossAgentDerivedFromCount += 1;
      }
    }
  }

  const turnsWithWrite = new Set(
    accepted
      .filter(
        (event) =>
          event.mutation.type === "SET" ||
          event.mutation.type === "REVISE" ||
          event.mutation.type === "REMOVE",
      )
      .map((event) => event.turnIndex),
  );
  let turnsWithNoPersistentChangeA = 0;
  let turnsWithNoPersistentChangeB = 0;
  let aChangeTurns = 0;
  let bChangeTurns = 0;
  for (const message of messages) {
    const changed =
      message.materialGraphChange === true ||
      turnsWithWrite.has(message.turnIndex);
    if (changed) {
      if (message.agentId === "agent_a") aChangeTurns += 1;
      else bChangeTurns += 1;
      continue;
    }
    if (message.agentId === "agent_a") turnsWithNoPersistentChangeA += 1;
    else turnsWithNoPersistentChangeB += 1;
  }

  const sorted = [...messages].sort((a, b) => a.turnIndex - b.turnIndex);
  let handoffCount = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.agentId !== sorted[i - 1]!.agentId) handoffCount += 1;
  }

  const materialTurns =
    options?.materialGraphChangeTurns ??
    [...turnsWithWrite].sort((a, b) => a - b);
  const lastMaterialChangeTurn =
    options?.lastMaterialChangeTurn ??
    (materialTurns.length > 0 ? materialTurns[materialTurns.length - 1]! : null);
  const finalized =
    options?.stoppedReason === "final_answer" || Boolean(graph.finalAnswer);
  const turnsFromLastMaterialChangeToFinal =
    finalized && lastMaterialChangeTurn != null && messages.length > 0
      ? messages[messages.length - 1]!.turnIndex - lastMaterialChangeTurn
      : null;

  const aSpoke = messages.some((message) => message.agentId === "agent_a");
  const bSpoke = messages.some((message) => message.agentId === "agent_b");
  const contribution = persistentContributionByAgent(graph);
  const uncapturedPartnerTurnCount = messages.filter((message) =>
    isUncapturedPartnerTurn(graph, message),
  ).length;
  const createdA = graph.subjects.filter(
    (subject) => subject.source === "agent" && subject.createdBy === "agent_a",
  ).length;
  const createdB = graph.subjects.filter(
    (subject) => subject.source === "agent" && subject.createdBy === "agent_b",
  ).length;

  return {
    turnCount: messages.length,
    handoffCount,
    aSpoke,
    bSpoke,
    persistentWritesA: acceptedSetA + acceptedReviseA,
    persistentWritesB: acceptedSetB + acceptedReviseB,
    acceptedSetA,
    acceptedSetB,
    acceptedReviseA,
    acceptedReviseB,
    crossAgentRevisionCount,
    crossAgentDerivedFromCount,
    turnsWithNoPersistentChangeA,
    turnsWithNoPersistentChangeB,
    materialGraphChangeTurns: materialTurns.length,
    aChangeTurns,
    bChangeTurns,
    graphStateTransitions: materialTurns.length,
    convergenceAttempts: options?.convergenceAttempts ?? 0,
    convergenceResets: options?.convergenceResets ?? 0,
    distinctConsiderationsCreatedA: createdA,
    distinctConsiderationsCreatedB: createdB,
    revisionsA: acceptedReviseA,
    revisionsB: acceptedReviseB,
    lastMaterialChangeTurn,
    turnsFromLastMaterialChangeToFinal,
    finalizedBeforeBSpoke: finalized && !bSpoke,
    finalizedBeforeBPersisted: finalized && !contribution.agent_b,
    lowCollaborationDepth: messages.length <= 3 && !contribution.agent_b,
    nothingToAddDeclared: messages.some((message) => message.nothingToAdd === true),
    persistenceRepairCount: options?.persistenceRepairCount ?? 0,
    uncapturedPartnerTurnCount,
    turnScopes: computeTurnScopes(graph, messages),
  };
}

export function describeRejectedAttempt(event: ReasoningEvent): string {
  const subject = mutationSubjectId(event.mutation) ?? event.mutation.type;
  const from =
    event.mutation.type === "REVISE" && event.mutation.fromVersionId
      ? ` from ${event.mutation.fromVersionId}`
      : "";
  const errors =
    event.errors.length > 0 ? event.errors.join("; ") : "rejected";
  return `${event.mutation.type} ${subject}${from} — ${errors}`;
}
