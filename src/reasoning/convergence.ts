import type {
  GenericReadiness,
  IssueConflict,
  IssueConvergenceState,
  ReasoningGraph,
  ReasoningIssue,
  ReasoningProgressState,
} from "./types";
import { isStateChangeMutation } from "./types";

export type DeriveConvergenceOptions = {
  conflicts?: IssueConflict[];
  currentTurn?: number;
  stallThresholdTurns?: number;
};

export function reasoningIssues(graph: ReasoningGraph): ReasoningIssue[] {
  return graph.subjects.map((subject) => ({
    id: subject.id,
    kind: subject.source === "task" ? "task_defined" : "emergent",
    label: subject.label ?? subject.id,
    prompt: subject.prompt ?? subject.description,
    metadata: subject.metadata,
  }));
}

export function deriveIssueConvergenceStates(
  graph: ReasoningGraph,
  options: DeriveConvergenceOptions = {},
): IssueConvergenceState[] {
  const conflicts = options.conflicts ?? [];
  return graph.subjects.map((subject) => {
    const active = graph.versions.find(
      (version) => version.subjectId === subject.id && version.status === "active",
    );
    const subjectConflicts = conflicts.filter(
      (conflict) => conflict.issueId === subject.id,
    );
    const lastChangedTurn = graph.versions
      .filter((version) => version.subjectId === subject.id)
      .reduce((max, version) => Math.max(max, version.turn), 0);
    return {
      issueId: subject.id,
      liveClaimIds: active ? [active.id] : [],
      settledClaimId: active?.id,
      unresolved: !active,
      contradictory: subjectConflicts.length > 0,
      reopened: false,
      lastChangedTurn: lastChangedTurn || undefined,
      conflicts: subjectConflicts,
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
    allRequiredIssuesSettled: unresolvedIssueCount === 0 && issueStates.length > 0,
    unresolvedIssueCount,
    unresolvedConflictCount,
  };
}

export function deriveReasoningProgress(
  graph: ReasoningGraph,
  issueStates: IssueConvergenceState[],
  options: { currentTurn?: number } = {},
): ReasoningProgressState {
  const currentTurn =
    options.currentTurn ??
    Math.max(0, ...graph.events.map((event) => event.turnIndex));
  const lastChange = graph.events
    .filter(
      (event) =>
        event.accepted &&
        event.stateChanged !== false &&
        isStateChangeMutation(event.mutation),
    )
    .reduce((max, event) => Math.max(max, event.turnIndex), 0);
  const settledIssueCount = issueStates.filter((state) => !state.unresolved).length;
  const liveClaimCount = issueStates.reduce(
    (sum, state) => sum + state.liveClaimIds.length,
    0,
  );
  const turnsSince = currentTurn - lastChange;
  return {
    unresolvedIssueCount: issueStates.filter((state) => state.unresolved).length,
    settledIssueCount,
    liveClaimCount,
    turnsSinceIssueResolution: turnsSince,
    turnsSinceNewEvidence: turnsSince,
    turnsSinceSemanticEdge: turnsSince,
    repeatedClaimCount: 0,
    reopenedIssueCount: 0,
    likelyStalled: turnsSince >= 3 && liveClaimCount > 0,
    reasons: [],
  };
}
