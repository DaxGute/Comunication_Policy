export const DEFAULT_STALL_RECOVERY_TURNS = 3;
export const DEFAULT_STALL_FAIL_TURNS = 8;
/** Consecutive turns on the same unresolved issue(s) before diversification. */
export const DEFAULT_LOCAL_LOOP_TURNS = 4;
/** Recent fingerprint window used to detect small state cycles. */
export const DEFAULT_CYCLE_WINDOW_TURNS = 6;
/** Turns the agent has after FINALIZATION REQUIRED to emit FINAL_ANSWER. */
export const DEFAULT_FINALIZATION_TURNS = 1;
/** Consecutive quality-stagnant turns before a failure-to-close warning. */
export const DEFAULT_CLOSURE_STAGNANT_TURNS = 4;
/** Share of issues with a live candidate that counts as a developed solution. */
export const DEFAULT_DEVELOPED_COVERAGE = 0.5;

export type StallInterventionKind = "local_loop" | "semantic_stall" | "closure";
export type StallRecoveryPhase = "normal" | "recovery" | "finalization";

export const NO_STATE_CHANGE_PREFIX = "no_state_change";

export const STRUCTURED_REASONING_MISSING_FEEDBACK = [
  "Your previous message contained substantive crossword reasoning but",
  "no structured reasoning move was recorded. Record the claim/evidence",
  "explicitly in this turn.",
].join("\n");

export const STRUCTURED_REASONING_STALL_FEEDBACK = [
  "STRUCTURED REASONING STALLED",
  "",
  "Your recent messages contain substantive problem-solving, but no",
  "structured reasoning updates have been accepted.",
  "",
  "On this turn, add a new claim/evidence/revision or explicitly resolve",
  "an existing issue. Use simple issue references rather than graph ids.",
].join("\n");

export function noStateChangeFeedback(detail: string): string {
  return [
    "NO_STATE_CHANGE",
    "",
    detail,
    "",
    "Provide new evidence, reject a conflicting assumption, or investigate",
    "another unresolved entry. Repeating the same candidate is not progress.",
  ].join("\n");
}

export function localLoopFeedback(args: { loopingLabels: string[] }): string {
  const looping =
    args.loopingLabels.length > 0
      ? args.loopingLabels.join(", ")
      : "the same unresolved entry";
  return [
    "LOCAL_LOOP",
    "",
    `You are repeatedly revisiting ${looping}. Either reconsider an earlier crossing assumption, investigate a different unresolved clue, or keep the best current candidate and move on.`,
  ].join("\n");
}

export function stallWarningFeedback(): string {
  return [
    "STALL WARNING",
    "",
    "The solution state has not materially improved for several turns. Reconsider an earlier assumption or investigate another unresolved clue. If no better solution can be found, submit the best internally consistent FINAL_ANSWER rather than continuing to cycle.",
  ].join("\n");
}

/** @deprecated Use stallWarningFeedback. Kept as an alias for older tests. */
export function semanticStallFeedback(): string {
  return stallWarningFeedback();
}

export function closureWarningFeedback(): string {
  return [
    "CLOSURE WARNING",
    "",
    "Resolve any remaining uncertainty you can. If further reasoning is unlikely to improve the solution, submit the best current FINAL_ANSWER.",
  ].join("\n");
}

export function finalizationRequiredFeedback(): string {
  return [
    "FINALIZATION REQUIRED",
    "",
    "Further reasoning has not improved the solution. Return the best FINAL_ANSWER supported by the current evidence, even if some entries remain uncertain.",
  ].join("\n");
}

export function eventChangedCanonicalState(event: {
  accepted: boolean;
  stateChanged?: boolean;
  diagnostics?: string[];
  operation: { type: string };
}): boolean {
  if (!event.accepted) return false;
  if (event.stateChanged === false) return false;
  if (
    event.operation.type === "invalid" ||
    event.operation.type === "protocol_failure"
  ) {
    return false;
  }
  if (
    event.diagnostics?.some(
      (item) =>
        item === NO_STATE_CHANGE_PREFIX ||
        item.startsWith(`${NO_STATE_CHANGE_PREFIX}:`) ||
        item.startsWith(`${NO_STATE_CHANGE_PREFIX} `),
    )
  ) {
    return false;
  }
  return true;
}

export function acceptedGraphMutations(
  events: {
    accepted: boolean;
    operation: { type: string };
    turnIndex: number;
  }[],
  turnIndex: number,
): number {
  return events.filter(
    (event) =>
      event.accepted &&
      event.turnIndex === turnIndex &&
      event.operation.type !== "invalid" &&
      event.operation.type !== "protocol_failure",
  ).length;
}

export function meaningfulStateMutations(
  events: {
    accepted: boolean;
    stateChanged?: boolean;
    diagnostics?: string[];
    operation: { type: string };
    turnIndex: number;
  }[],
  turnIndex: number,
): number {
  return events.filter(
    (event) =>
      event.turnIndex === turnIndex && eventChangedCanonicalState(event),
  ).length;
}
