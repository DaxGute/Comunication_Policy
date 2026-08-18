/**
 * Canonical solver-state progress: fingerprints, cycles, and local loops.
 *
 * Graph events are historical. This module asks whether live hypotheses,
 * conflicts, or settlement actually changed — the signal stall detection uses.
 * Freeze detection stays here; recovery/finalization is a compact protocol
 * response, not extra solver context dumped into the agent prompt.
 */
import type { TaskIssueLedger, TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import {
  DEFAULT_CLOSURE_STAGNANT_TURNS,
  DEFAULT_CYCLE_WINDOW_TURNS,
  DEFAULT_DEVELOPED_COVERAGE,
  DEFAULT_LOCAL_LOOP_TURNS,
  DEFAULT_STALL_FAIL_TURNS,
  DEFAULT_STALL_RECOVERY_TURNS,
  closureWarningFeedback,
  finalizationRequiredFeedback,
  localLoopFeedback,
  noStateChangeFeedback,
  stallWarningFeedback,
  STRUCTURED_REASONING_MISSING_FEEDBACK,
  type StallInterventionKind,
  type StallRecoveryPhase,
} from "./stall";
import type {
  AtomicReasoningNode,
  IssueConvergenceState,
  ReasoningEvent,
  ReasoningGraph,
  ReasoningNode,
} from "./types";

export type SolverSolutionQuality = {
  issueCount: number;
  settledCount: number;
  coveredCount: number;
  conflictCount: number;
};

export type SolverProgressCounters = {
  rawMutationCount: number;
  meaningfulStateTransitionCount: number;
  noOpMutationCount: number;
  repeatedStateCount: number;
  cycleDetectionCount: number;
  localLoopInterventions: number;
  diversificationInterventions: number;
  stallWarningCount: number;
  closureWarningCount: number;
  finalizationRequiredCount: number;
  semanticStallReason?: string;
  stallWarningTurn?: number;
  stallWarningKind?: StallInterventionKind;
  closureWarningTurn?: number;
  finalizationRequiredTurn?: number;
  recoveryTurnsBeforeFinalization?: number;
  progressResumedAfterWarning?: boolean;
  finalAnswerAfterFinalization?: boolean;
  terminatedAsProtocolStall?: boolean;
};

export type SolverProgressSnapshot = SolverProgressCounters & {
  unchangedStreak: number;
  fingerprintCount: number;
  lastFingerprint?: string;
  phase: StallRecoveryPhase;
};

export type SolverProgressState = {
  fingerprints: string[];
  unchangedStreak: number;
  localLoopStreak: number;
  localLoopIssueIds: string[];
  lastFocusIssueIds: string[];
  diversified: boolean;
  lastInterventionTurn?: number;
  lastNoStateChangeDetail?: string;
  phase: StallRecoveryPhase;
  recoveryTurnCount: number;
  lastQuality?: SolverSolutionQuality;
  qualityUnchangedStreak: number;
  stallWarningTurn?: number;
  stallWarningKind?: StallInterventionKind;
  closureWarningTurn?: number;
  finalizationRequiredTurn?: number;
  counters: SolverProgressCounters;
};

export type SolverProgressTurnInput = {
  turnIndex: number;
  maxTurns?: number;
  graph: ReasoningGraph;
  events: ReasoningEvent[];
  issueStates: IssueConvergenceState[];
  ledgers?: TaskIssueLedger[];
  fingerprint: string;
  substantive: boolean;
  structuredReasoningMissing: boolean;
  stallRecoveryTurns?: number;
  stallFailTurns?: number;
  localLoopTurns?: number;
  cycleWindowTurns?: number;
};

export type SolverProgressTurnResult = {
  state: SolverProgressState;
  protocolFeedback?: string;
  stalled: boolean;
  stallReason?: string;
  stateChanged: boolean;
  cycle: boolean;
  localLoop: boolean;
  freezeDetected: boolean;
  failureToClose: boolean;
};

function isLive(node: ReasoningNode): boolean {
  return node.status !== "rejected" && node.status !== "superseded";
}

function isResolutionClaim(node: ReasoningNode): node is AtomicReasoningNode {
  return node.type === "claim" || node.type === "proposal";
}

function identityOrText(node: AtomicReasoningNode): string {
  const identity =
    typeof node.metadata?.candidateIdentity === "string"
      ? node.metadata.candidateIdentity
      : undefined;
  if (identity) return identity;
  return `${node.subjectId ?? ""}:${node.type}:${node.text.trim().toLowerCase()}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function genericSolverStateFingerprint(
  graph: ReasoningGraph,
  issueStates: IssueConvergenceState[],
): string {
  const claims = graph.nodes.filter(isResolutionClaim);
  const payload = {
    issues: issueStates.map((state) => {
      const live = claims
        .filter((node) => node.subjectId === state.issueId && isLive(node))
        .map(identityOrText)
        .sort();
      const rejected = claims
        .filter(
          (node) =>
            node.subjectId === state.issueId &&
            (node.status === "rejected" || node.status === "superseded"),
        )
        .map(identityOrText)
        .sort();
      const conflicts = state.conflicts
        .filter((conflict) => conflict.source === "task_constraint")
        .map((conflict) => conflict.description ?? conflict.nodeIds.slice().sort().join("|"))
        .sort();
      return {
        id: state.issueId,
        settled: state.settledClaimId
          ? identityOrText(
              claims.find((node) => node.id === state.settledClaimId) ??
                ({
                  type: "claim",
                  text: state.settledClaimId,
                  subjectId: state.issueId,
                } as AtomicReasoningNode),
            )
          : null,
        live,
        rejected,
        unresolved: state.unresolved,
        conflicts,
      };
    }),
  };
  return stableStringify(payload);
}

export function solverStateFingerprint(args: {
  problem: Problem;
  adapter: TaskReasoningAdapter;
  graph: ReasoningGraph;
  issueStates: IssueConvergenceState[];
}): string {
  return (
    args.adapter.solverStateFingerprint?.(
      args.problem,
      args.graph,
      args.issueStates,
    ) ?? genericSolverStateFingerprint(args.graph, args.issueStates)
  );
}

export function solverSolutionQuality(
  issueStates: IssueConvergenceState[],
): SolverSolutionQuality {
  return {
    issueCount: issueStates.length,
    settledCount: issueStates.filter((state) => !state.unresolved).length,
    coveredCount: issueStates.filter((state) => state.liveClaimIds.length > 0)
      .length,
    conflictCount: issueStates.reduce(
      (sum, state) => sum + state.conflicts.length,
      0,
    ),
  };
}

export function solutionQualityImproved(
  previous: SolverSolutionQuality | undefined,
  next: SolverSolutionQuality,
): boolean {
  if (!previous) {
    return next.settledCount > 0 || next.coveredCount > 0;
  }
  return (
    next.settledCount > previous.settledCount ||
    next.coveredCount > previous.coveredCount ||
    next.conflictCount < previous.conflictCount
  );
}

export function solutionIsDeveloped(
  quality: SolverSolutionQuality,
  coverageThreshold = DEFAULT_DEVELOPED_COVERAGE,
): boolean {
  if (quality.issueCount <= 0) return false;
  const coverage = quality.coveredCount / quality.issueCount;
  const settlement = quality.settledCount / quality.issueCount;
  return coverage >= coverageThreshold || settlement >= 0.4;
}

export function emptySolverProgressState(): SolverProgressState {
  return {
    fingerprints: [],
    unchangedStreak: 0,
    localLoopStreak: 0,
    localLoopIssueIds: [],
    lastFocusIssueIds: [],
    diversified: false,
    phase: "normal",
    recoveryTurnCount: 0,
    qualityUnchangedStreak: 0,
    counters: {
      rawMutationCount: 0,
      meaningfulStateTransitionCount: 0,
      noOpMutationCount: 0,
      repeatedStateCount: 0,
      cycleDetectionCount: 0,
      localLoopInterventions: 0,
      diversificationInterventions: 0,
      stallWarningCount: 0,
      closureWarningCount: 0,
      finalizationRequiredCount: 0,
    },
  };
}

export function snapshotSolverProgress(
  state: SolverProgressState,
): SolverProgressSnapshot {
  return {
    ...state.counters,
    unchangedStreak: state.unchangedStreak,
    fingerprintCount: state.fingerprints.length,
    lastFingerprint: state.fingerprints[state.fingerprints.length - 1],
    phase: state.phase,
  };
}

function issueIdForEvent(
  event: ReasoningEvent,
  graph: ReasoningGraph,
): string | undefined {
  const op = event.operation;
  if (op.type === "create") {
    return op.node.subjectId;
  }
  if (op.type === "revise") {
    return op.replacement.subjectId;
  }
  const targetId =
    "targetId" in op
      ? op.targetId
      : "targetNodeId" in op
        ? op.targetNodeId
        : undefined;
  if (targetId) {
    const node = graph.nodes.find((item) => item.id === targetId);
    if (node && node.type !== "final_answer" && node.subjectId) {
      return node.subjectId;
    }
  }
  for (const item of event.diagnostics ?? []) {
    const match = item.match(/\b([a-z]+:(?:across|down):\d+)\b/i);
    if (match) return match[1]!.toLowerCase();
  }
  return undefined;
}

export function focusIssueIdsForTurn(
  events: ReasoningEvent[],
  graph: ReasoningGraph,
  turnIndex: number,
): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.turnIndex !== turnIndex) continue;
    if (event.operation.type === "protocol_failure") continue;
    if (
      event.operation.type === "final_answer" ||
      (event.operation.type === "invalid" &&
        event.stateChanged !== false &&
        !event.diagnostics?.some(
          (item) =>
            item === "no_state_change" || item.startsWith("no_state_change:"),
        ))
    ) {
      continue;
    }
    const issueId = issueIdForEvent(event, graph);
    if (issueId) ids.add(issueId);
  }
  return [...ids].sort();
}

function setEquals(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}

function isSubset(inner: string[], outer: string[]): boolean {
  if (inner.length === 0) return false;
  const set = new Set(outer);
  return inner.every((id) => set.has(id));
}

function ledgerLabel(ledgers: TaskIssueLedger[] | undefined, issueId: string): string {
  return ledgers?.find((ledger) => ledger.issueId === issueId)?.label ?? issueId;
}

function untouchedLabels(
  issueStates: IssueConvergenceState[],
  ledgers: TaskIssueLedger[] | undefined,
): string[] {
  if (ledgers && ledgers.length > 0) {
    return ledgers
      .filter((ledger) => ledger.untouched)
      .map((ledger) => ledger.label);
  }
  return issueStates
    .filter((state) => state.unresolved && state.liveClaimIds.length === 0)
    .map((state) => state.issueId);
}

function noOpDetail(events: ReasoningEvent[], turnIndex: number): string | undefined {
  const turnEvents = events.filter((event) => event.turnIndex === turnIndex);
  const diagnostic = turnEvents
    .flatMap((event) => event.diagnostics ?? [])
    .find(
      (item) =>
        item.startsWith("no_state_change:") ||
        item.startsWith("no_state_change "),
    );
  if (diagnostic) {
    return diagnostic.replace(/^no_state_change:\s*/i, "").trim();
  }
  const error = turnEvents
    .flatMap((event) => event.errors)
    .find((item) => item.startsWith("duplicate of "));
  return error;
}

function remainingTurnsAfter(
  turnIndex: number,
  maxTurns: number | undefined,
): number | undefined {
  if (maxTurns === undefined) return undefined;
  return Math.max(0, maxTurns - turnIndex);
}

function nearTurnBudget(turnIndex: number, maxTurns: number | undefined): boolean {
  if (maxTurns === undefined || maxTurns <= 0) return false;
  const remaining = remainingTurnsAfter(turnIndex, maxTurns) ?? 0;
  const horizon = Math.max(2, Math.min(4, Math.floor(maxTurns * 0.2)));
  return remaining <= horizon;
}

export function reduceSolverProgress(
  previous: SolverProgressState,
  input: SolverProgressTurnInput,
): SolverProgressTurnResult {
  const stallRecoveryTurns =
    input.stallRecoveryTurns ?? DEFAULT_STALL_RECOVERY_TURNS;
  const stallFailTurns = input.stallFailTurns ?? DEFAULT_STALL_FAIL_TURNS;
  const localLoopTurns = input.localLoopTurns ?? DEFAULT_LOCAL_LOOP_TURNS;
  const cycleWindowTurns =
    input.cycleWindowTurns ?? DEFAULT_CYCLE_WINDOW_TURNS;
  const freezeThreshold = Math.max(2, Math.floor(stallFailTurns / 2));

  const rawMutations = input.events.filter(
    (event) =>
      event.turnIndex === input.turnIndex &&
      event.accepted &&
      event.operation.type !== "protocol_failure",
  ).length;
  const noOps = input.events.filter(
    (event) =>
      event.turnIndex === input.turnIndex &&
      (event.stateChanged === false ||
        event.diagnostics?.some(
          (item) =>
            item === "no_state_change" || item.startsWith("no_state_change:"),
        )),
  ).length;
  const rejectedAttempts = input.events.filter(
    (event) =>
      event.turnIndex === input.turnIndex &&
      !event.accepted &&
      event.stateChanged !== false &&
      event.operation.type !== "protocol_failure",
  ).length;

  const priorFingerprints = previous.fingerprints;
  const lastFingerprint = priorFingerprints[priorFingerprints.length - 1];
  const repeatedState =
    lastFingerprint !== undefined && lastFingerprint === input.fingerprint;
  const recent = priorFingerprints.slice(-cycleWindowTurns);
  const cycle =
    !repeatedState &&
    recent.includes(input.fingerprint) &&
    priorFingerprints.length > 0;
  const stateChanged = !repeatedState && !cycle;

  const focusIssueIds = focusIssueIdsForTurn(
    input.events,
    input.graph,
    input.turnIndex,
  );
  const unresolvedFocus = focusIssueIds.filter((issueId) =>
    input.issueStates.some(
      (state) => state.issueId === issueId && state.unresolved,
    ),
  );
  const sameFocus =
    unresolvedFocus.length > 0 &&
    previous.lastFocusIssueIds.length > 0 &&
    (setEquals(unresolvedFocus, previous.lastFocusIssueIds) ||
      isSubset(
        unresolvedFocus,
        previous.localLoopIssueIds.length > 0
          ? previous.localLoopIssueIds
          : previous.lastFocusIssueIds,
      ));
  const localLoopStreak = sameFocus ? previous.localLoopStreak + 1 : 1;
  const localLoopIssueIds = sameFocus
    ? [...new Set([...previous.localLoopIssueIds, ...unresolvedFocus])].sort()
    : unresolvedFocus;
  const untouched = untouchedLabels(input.issueStates, input.ledgers);
  const localLoop =
    localLoopStreak >= localLoopTurns &&
    localLoopIssueIds.length > 0 &&
    localLoopIssueIds.length <= 2 &&
    (untouched.length > 0 ||
      input.issueStates.some((state) => state.unresolved));

  const quality = solverSolutionQuality(input.issueStates);
  const qualityImproved = solutionQualityImproved(previous.lastQuality, quality);
  const qualityUnchangedStreak = qualityImproved
    ? 0
    : previous.qualityUnchangedStreak + 1;
  const developed = solutionIsDeveloped(quality);

  const counters: SolverProgressCounters = {
    ...previous.counters,
    rawMutationCount: previous.counters.rawMutationCount + rawMutations,
    meaningfulStateTransitionCount:
      previous.counters.meaningfulStateTransitionCount + (stateChanged ? 1 : 0),
    noOpMutationCount:
      previous.counters.noOpMutationCount + noOps + rejectedAttempts,
    repeatedStateCount:
      previous.counters.repeatedStateCount + (repeatedState ? 1 : 0),
    cycleDetectionCount:
      previous.counters.cycleDetectionCount + (cycle ? 1 : 0),
  };

  const unchangedStreak = stateChanged ? 0 : previous.unchangedStreak + 1;
  const noStateChangeDetail = noOpDetail(input.events, input.turnIndex);
  const remaining = remainingTurnsAfter(input.turnIndex, input.maxTurns);
  // Last remaining turn should see FINALIZATION REQUIRED. After the last
  // turn there is no next prompt, so remaining === 0 is too late.
  const budgetTight = remaining === 1;

  const freezeDetected =
    localLoop ||
    (input.substantive && !stateChanged && unchangedStreak >= freezeThreshold) ||
    (input.substantive && !stateChanged && unchangedStreak >= stallFailTurns);

  const failureToClose =
    !freezeDetected &&
    input.maxTurns !== undefined &&
    input.turnIndex >= Math.max(6, stallFailTurns) &&
    ((nearTurnBudget(input.turnIndex, input.maxTurns) &&
      (developed || quality.coveredCount > 0)) ||
      (developed &&
        qualityUnchangedStreak >= DEFAULT_CLOSURE_STAGNANT_TURNS &&
        (stateChanged || unchangedStreak >= 2)));

  let phase = previous.phase;
  let protocolFeedback: string | undefined;
  let localLoopInterventions = previous.counters.localLoopInterventions;
  let diversificationInterventions =
    previous.counters.diversificationInterventions;
  let stallWarningCount = previous.counters.stallWarningCount;
  let closureWarningCount = previous.counters.closureWarningCount;
  let finalizationRequiredCount = previous.counters.finalizationRequiredCount;
  let diversified = previous.diversified;
  let lastInterventionTurn = previous.lastInterventionTurn;
  let recoveryTurnCount = previous.recoveryTurnCount;
  let stallWarningTurn = previous.stallWarningTurn;
  let stallWarningKind = previous.stallWarningKind;
  let closureWarningTurn = previous.closureWarningTurn;
  let finalizationRequiredTurn = previous.finalizationRequiredTurn;
  let progressResumedAfterWarning = previous.counters.progressResumedAfterWarning;
  let recoveryTurnsBeforeFinalization =
    previous.counters.recoveryTurnsBeforeFinalization;
  let stalled = false;
  let stallReason: string | undefined;

  const resumeProgress = (): void => {
    if (phase === "recovery" || phase === "finalization") {
      progressResumedAfterWarning = true;
    }
    phase = "normal";
    recoveryTurnCount = 0;
  };

  const freezeRecovered =
    phase === "recovery" || phase === "finalization"
      ? stallWarningKind === "local_loop"
        ? !localLoop || qualityImproved
        : stallWarningKind === "closure"
          ? qualityImproved
          : stateChanged
      : false;

  if (freezeRecovered) {
    resumeProgress();
  }

  const enterRecovery = (kind: StallInterventionKind, feedback: string): void => {
    phase = "recovery";
    recoveryTurnCount = 0;
    stallWarningKind = kind;
    if (stallWarningTurn === undefined) stallWarningTurn = input.turnIndex;
    lastInterventionTurn = input.turnIndex;
    if (kind === "local_loop") {
      localLoopInterventions += 1;
      if (untouched.length > 0) diversificationInterventions += 1;
      diversified = true;
    } else if (kind === "closure") {
      closureWarningCount += 1;
      if (closureWarningTurn === undefined) closureWarningTurn = input.turnIndex;
    }
    if (kind !== "closure") {
      stallWarningCount += 1;
    }
    protocolFeedback = budgetTight ? finalizationRequiredFeedback() : feedback;
    if (budgetTight) {
      phase = "finalization";
      finalizationRequiredTurn = input.turnIndex;
      finalizationRequiredCount += 1;
      recoveryTurnsBeforeFinalization = 0;
    }
  };

  const enterFinalization = (): void => {
    phase = "finalization";
    finalizationRequiredTurn = input.turnIndex;
    finalizationRequiredCount += 1;
    recoveryTurnsBeforeFinalization = recoveryTurnCount;
    lastInterventionTurn = input.turnIndex;
    protocolFeedback = finalizationRequiredFeedback();
  };

  if (phase === "normal") {
    if (freezeDetected && !freezeRecovered) {
      const kind: StallInterventionKind = localLoop ? "local_loop" : "semantic_stall";
      enterRecovery(
        kind,
        localLoop
          ? localLoopFeedback({
              loopingLabels: localLoopIssueIds.map((id) =>
                ledgerLabel(input.ledgers, id),
              ),
            })
          : stallWarningFeedback(),
      );
      if (kind === "semantic_stall") {
        stallReason = cycle
          ? "semantic_stall_state_cycle"
          : repeatedState
            ? "semantic_stall_repeated_state"
            : localLoop
              ? "semantic_stall_local_loop"
              : "semantic_stall_no_state_change";
        counters.semanticStallReason = stallReason;
      }
    } else if (failureToClose) {
      enterRecovery("closure", closureWarningFeedback());
    } else if (input.structuredReasoningMissing && unchangedStreak === 1) {
      protocolFeedback = STRUCTURED_REASONING_MISSING_FEEDBACK;
    } else if (
      noStateChangeDetail &&
      (previous.lastNoStateChangeDetail !== noStateChangeDetail ||
        previous.unchangedStreak === 0)
    ) {
      protocolFeedback = noStateChangeFeedback(noStateChangeDetail);
    }
  } else if (phase === "recovery") {
    recoveryTurnCount += 1;
    const recoveryExpired = recoveryTurnCount >= stallRecoveryTurns;
    const failExpired = unchangedStreak >= stallFailTurns && !stateChanged;
    if (recoveryExpired || failExpired || budgetTight) {
      enterFinalization();
    }
  } else if (phase === "finalization") {
    if (
      previous.finalizationRequiredTurn !== undefined &&
      input.turnIndex > previous.finalizationRequiredTurn
    ) {
      stalled = true;
      stallReason =
        previous.stallWarningKind === "closure"
          ? "finalization_ignored_after_closure"
          : previous.stallWarningKind === "local_loop"
            ? "finalization_ignored_after_local_loop"
            : "finalization_ignored_after_stall";
      counters.semanticStallReason = stallReason;
    }
  }

  counters.localLoopInterventions = localLoopInterventions;
  counters.diversificationInterventions = diversificationInterventions;
  counters.stallWarningCount = stallWarningCount;
  counters.closureWarningCount = closureWarningCount;
  counters.finalizationRequiredCount = finalizationRequiredCount;
  counters.stallWarningTurn = stallWarningTurn;
  counters.stallWarningKind = stallWarningKind;
  counters.closureWarningTurn = closureWarningTurn;
  counters.finalizationRequiredTurn = finalizationRequiredTurn;
  counters.recoveryTurnsBeforeFinalization = recoveryTurnsBeforeFinalization;
  counters.progressResumedAfterWarning = progressResumedAfterWarning;
  if (stalled) {
    counters.terminatedAsProtocolStall = true;
  }

  return {
    state: {
      fingerprints: [...priorFingerprints, input.fingerprint],
      unchangedStreak,
      localLoopStreak: unresolvedFocus.length > 0 ? localLoopStreak : 0,
      localLoopIssueIds,
      lastFocusIssueIds: unresolvedFocus,
      diversified,
      lastInterventionTurn,
      lastNoStateChangeDetail: noStateChangeDetail,
      phase,
      recoveryTurnCount,
      lastQuality: quality,
      qualityUnchangedStreak,
      stallWarningTurn,
      stallWarningKind,
      closureWarningTurn,
      finalizationRequiredTurn,
      counters,
    },
    protocolFeedback,
    stalled,
    stallReason,
    stateChanged,
    cycle,
    localLoop,
    freezeDetected,
    failureToClose,
  };
}
