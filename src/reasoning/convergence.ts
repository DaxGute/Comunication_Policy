import type { AgentId } from "../agents/types";
import {
  stancesForNode,
  type NodeStance,
} from "./graph";
import type {
  DeterministicReasoningSignal,
  GenericReadiness,
  IssueConflict,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningIssue,
  ReasoningNode,
  ReasoningProgressState,
  ReasoningStance,
} from "./types";

export type DeriveConvergenceOptions = {
  conflicts?: IssueConflict[];
  deterministicSignals?: DeterministicReasoningSignal[];
  currentTurn?: number;
  stallThresholdTurns?: number;
};

function isLive(node: ReasoningNode): boolean {
  return node.status !== "rejected" && node.status !== "superseded";
}

function isResolutionClaim(node: ReasoningNode): boolean {
  return node.type === "claim" || node.type === "proposal";
}

function latestTurn(graph: ReasoningGraph): number {
  return Math.max(
    0,
    ...graph.nodes.map((node) => node.createdAtTurn),
    ...graph.events.map((event) => event.turnIndex),
  );
}

function asStance(stance: NodeStance | undefined): ReasoningStance | undefined {
  return stance ? { ...stance } : undefined;
}

function latestAgentStances(
  graph: ReasoningGraph,
  claimIds: string[],
): IssueConvergenceState["agentStances"] {
  const latest = new Map<AgentId, NodeStance>();
  for (const claimId of claimIds) {
    for (const stance of stancesForNode(graph, claimId)) {
      const prior = latest.get(stance.actor);
      if (!prior || stance.turnIndex >= prior.turnIndex) {
        latest.set(stance.actor, stance);
      }
    }
  }
  const agentA = asStance(latest.get("agent_a"));
  const agentB = asStance(latest.get("agent_b"));
  return agentA || agentB ? { agentA, agentB } : undefined;
}

function wasJointlyAccepted(graph: ReasoningGraph, nodeId: string): boolean {
  const latest = new Map<AgentId, string>();
  for (const event of [...graph.events].sort((a, b) => a.seq - b.seq)) {
    if (!event.accepted) continue;
    const op = event.operation;
    if (
      !["accept", "reject", "pass", "support", "challenge"].includes(op.type) ||
      !("targetId" in op) ||
      op.targetId !== nodeId
    ) {
      continue;
    }
    if (op.actor !== "agent_a" && op.actor !== "agent_b") continue;
    latest.set(op.actor, op.type);
    if (
      latest.get("agent_a") === "accept" &&
      latest.get("agent_b") === "accept"
    ) {
      return true;
    }
  }
  return false;
}

export function reasoningIssues(graph: ReasoningGraph): ReasoningIssue[] {
  const taskDefined = (graph.subjects ?? []).map((subject) => ({
    id: subject.id,
    kind: "task_defined" as const,
    label: subject.label,
    prompt: subject.prompt ?? subject.description,
    metadata: subject.metadata,
  }));
  const emergent = graph.nodes
    .filter((node) => node.type === "issue" && isLive(node))
    .map((node) => ({
      id: node.id,
      kind: "emergent" as const,
      label: node.text,
      prompt: node.text,
      metadata: node.metadata,
    }));
  return [...taskDefined, ...emergent];
}

function graphConflictsForIssue(
  graph: ReasoningGraph,
  issueId: string,
  liveClaims: ReasoningNode[],
): IssueConflict[] {
  const liveIds = new Set(liveClaims.map((node) => node.id));
  const conflicts: IssueConflict[] = [];
  for (const edge of graph.edges ?? []) {
    if (edge.type !== "challenges" || !liveIds.has(edge.targetNodeId)) continue;
    const source = graph.nodes.find((node) => node.id === edge.sourceNodeId);
    if (source && !isLive(source)) continue;
    const laterAcceptance = stancesForNode(graph, edge.targetNodeId).find(
      (stance) =>
        stance.actor === edge.createdBy &&
        stance.kind === "accept" &&
        stance.turnIndex > edge.createdAtTurn,
    );
    if (laterAcceptance) continue;
    conflicts.push({
      issueId,
      nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      source: "reasoning",
      description: edge.reason,
    });
  }
  for (const claim of liveClaims) {
    for (const stance of stancesForNode(graph, claim.id)) {
      if (stance.kind !== "challenge") continue;
      conflicts.push({
        issueId,
        nodeIds: [claim.id],
        source: "reasoning",
        description: stance.reason,
      });
    }
  }
  return conflicts;
}

export function deriveIssueConvergenceStates(
  graph: ReasoningGraph,
  options: DeriveConvergenceOptions = {},
): IssueConvergenceState[] {
  return reasoningIssues(graph).map((issue) => {
    const allClaims = graph.nodes.filter(
      (node) =>
        node.type !== "final_answer" &&
        isResolutionClaim(node) &&
        node.subjectId === issue.id,
    );
    const liveClaims = allClaims.filter(isLive);
    const conflicts = [
      ...graphConflictsForIssue(graph, issue.id, liveClaims),
      ...(options.conflicts ?? []).filter((conflict) => conflict.issueId === issue.id),
    ];
    const signals = (options.deterministicSignals ?? []).filter(
      (signal) => signal.issueId === issue.id,
    );
    const settled =
      liveClaims.length === 1 &&
      liveClaims[0]!.status === "accepted" &&
      conflicts.length === 0
        ? liveClaims[0]
        : undefined;
    const previouslySettled = allClaims.some(
      (claim) => wasJointlyAccepted(graph, claim.id) && claim.id !== settled?.id,
    );
    const reopened =
      previouslySettled &&
      (conflicts.length > 0 ||
        signals.some((signal) =>
          ["evidence", "challenge", "contradiction", "revision"].includes(
            signal.kind,
          ),
        ) ||
        allClaims.some((claim) => claim.status === "superseded"));
    const relevantTurns = [
      ...allClaims.map((claim) => claim.createdAtTurn),
      ...graph.events
        .filter((event) => {
          const op = event.operation;
          if ("targetId" in op && allClaims.some((claim) => claim.id === op.targetId)) {
            return true;
          }
          return (
            op.type === "create" &&
            op.node.type !== "issue" &&
            op.node.subjectId === issue.id
          );
        })
        .map((event) => event.turnIndex),
    ];
    return {
      issueId: issue.id,
      liveClaimIds: liveClaims.map((claim) => claim.id),
      settledClaimId: settled?.id,
      unresolved: !settled,
      contradictory: conflicts.length > 0,
      reopened,
      lastChangedTurn:
        relevantTurns.length > 0 ? Math.max(...relevantTurns) : undefined,
      agentStances: latestAgentStances(
        graph,
        liveClaims.map((claim) => claim.id),
      ),
      conflicts,
      claimCompatibility: Object.fromEntries(
        liveClaims.map((claim) => [
          claim.id,
          conflicts.some(
            (conflict) =>
              conflict.source === "task_constraint" &&
              conflict.nodeIds.includes(claim.id),
          )
            ? "incompatible"
            : "unknown",
        ]),
      ),
    };
  });
}

export function deriveGenericReadiness(
  issueStates: IssueConvergenceState[],
): GenericReadiness {
  const unresolvedIssueCount = issueStates.filter((state) => state.unresolved).length;
  const unresolvedConflictCount = issueStates.reduce(
    (sum, state) => sum + state.conflicts.length,
    0,
  );
  return {
    allRequiredIssuesSettled: unresolvedIssueCount === 0,
    unresolvedIssueCount,
    unresolvedConflictCount,
  };
}

export function deriveReasoningProgress(
  graph: ReasoningGraph,
  issueStates: IssueConvergenceState[],
  options: DeriveConvergenceOptions = {},
): ReasoningProgressState {
  const currentTurn = options.currentTurn ?? latestTurn(graph);
  const resolutions = graph.nodes.filter(
    (node) => isResolutionClaim(node) && node.status === "accepted",
  );
  const resolutionIds = new Set(resolutions.map((node) => node.id));
  const resolutionTurns = graph.events
    .filter((event) => {
      const operation = event.operation;
      return (
        event.accepted &&
        operation.type === "accept" &&
        resolutionIds.has(operation.targetId)
      );
    })
    .map((event) => event.turnIndex);
  const evidence = graph.nodes.filter((node) => node.type === "evidence");
  const semanticEvents = graph.events.filter(
    (event) =>
      event.accepted &&
      ["support", "challenge", "revise"].includes(event.operation.type),
  );
  const repeatedClaimCount = graph.events.filter(
    (event) =>
      !event.accepted &&
      event.errors.some((error) => error.startsWith("duplicate of ")),
  ).length;
  const turnsSince = (turns: number[]): number =>
    turns.length > 0 ? currentTurn - Math.max(...turns) : currentTurn;
  const turnsSinceIssueResolution = turnsSince(
    resolutionTurns,
  );
  const turnsSinceNewEvidence = turnsSince(
    evidence.map((node) => node.createdAtTurn),
  );
  const turnsSinceSemanticEdge = turnsSince(
    semanticEvents.map((event) => event.turnIndex),
  );
  const threshold = options.stallThresholdTurns ?? 3;
  const reasons: string[] = [];
  if (
    issueStates.some((state) => state.unresolved) &&
    turnsSinceIssueResolution >= threshold
  ) {
    reasons.push(`no issue resolution for ${turnsSinceIssueResolution} turns`);
  }
  if (repeatedClaimCount >= 2) {
    reasons.push(`${repeatedClaimCount} repeated claims were rejected`);
  }
  if (
    issueStates.some((state) => state.unresolved) &&
    turnsSinceNewEvidence >= threshold &&
    turnsSinceSemanticEdge >= threshold
  ) {
    reasons.push("no recent evidence or semantic relationship");
  }
  return {
    unresolvedIssueCount: issueStates.filter((state) => state.unresolved).length,
    settledIssueCount: issueStates.filter((state) => !state.unresolved).length,
    liveClaimCount: issueStates.reduce(
      (sum, state) => sum + state.liveClaimIds.length,
      0,
    ),
    turnsSinceIssueResolution,
    turnsSinceNewEvidence,
    turnsSinceSemanticEdge,
    repeatedClaimCount,
    reopenedIssueCount: issueStates.filter((state) => state.reopened).length,
    likelyStalled: reasons.length > 0,
    reasons,
  };
}
