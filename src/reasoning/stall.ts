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
export type FreezeType =
  | "local_loop"
  | "semantic_stall_repeated_state"
  | "semantic_stall_state_cycle"
  | "semantic_stall_no_state_change";
export type ClosureWarningReason =
  | "quality_stagnant_developed"
  | "near_turn_budget";

export const NO_STATE_CHANGE_PREFIX = "no_state_change";

export const STRUCTURED_REASONING_MISSING_FEEDBACK = [
  "A prior turn looked like a committed conclusion but no graph mutation was recorded.",
  "If you now have a sufficiently justified proposition, emit SET or REVISE.",
  "If you do not, empty mutations are valid — do not guess to keep the conversation moving.",
].join("\n");

export const STRUCTURED_REASONING_STALL_FEEDBACK = [
  "STRUCTURED REASONING STALLED",
  "",
  "Recent turns have not improved the committed reasoning state.",
  "",
  "Inspect CURRENT SHARED REASONING STATE. Revise an existing subject if you have",
  "grounds to do so. If you do not yet have a justified change, say so and leave",
  "mutations empty rather than adding a weak candidate.",
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

export function localLoopFeedback(_args?: { loopingLabels?: string[] }): string {
  return [
    "LOCAL_LOOP",
    "",
    "You are repeatedly revisiting the same unresolved issue without improving the solution. Change strategy: reconsider an earlier assumption, work elsewhere, or keep the best current candidate and move on.",
  ].join("\n");
}

export function stallWarningFeedback(): string {
  return [
    "STALL WARNING",
    "",
    "The solution state has not materially improved over recent turns. Change reasoning strategy, revisit an earlier assumption, or move toward your best available final answer.",
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
    "Further reasoning has not improved the solution. Submit the best FINAL_ANSWER currently supported, even if some entries remain uncertain.",
  ].join("\n");
}

export function freezeProtocolKind(
  feedback: string | undefined,
): StallInterventionKind | "finalization" | undefined {
  if (!feedback) return undefined;
  if (feedback.startsWith("LOCAL_LOOP")) return "local_loop";
  if (feedback.startsWith("STALL WARNING")) return "semantic_stall";
  if (feedback.startsWith("CLOSURE WARNING")) return "closure";
  if (feedback.startsWith("FINALIZATION REQUIRED")) return "finalization";
  return undefined;
}

export function eventChangedCanonicalState(event: {
  accepted: boolean;
  stateChanged?: boolean;
  diagnostics?: string[];
  mutation: { type: string };
}): boolean {
  if (!event.accepted) return false;
  if (event.stateChanged === false) return false;
  if (
    event.mutation.type === "invalid" ||
    event.mutation.type === "protocol_failure" ||
    event.mutation.type === "final_answer"
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
    mutation: { type: string };
    turnIndex: number;
  }[],
  turnIndex: number,
): number {
  return events.filter(
    (event) =>
      event.accepted &&
      event.turnIndex === turnIndex &&
      (event.mutation.type === "SET" ||
        event.mutation.type === "REVISE" ||
        event.mutation.type === "REMOVE"),
  ).length;
}

export function meaningfulStateMutations(
  events: {
    accepted: boolean;
    stateChanged?: boolean;
    diagnostics?: string[];
    mutation: { type: string };
    turnIndex: number;
  }[],
  turnIndex: number,
): number {
  return events.filter(
    (event) =>
      event.turnIndex === turnIndex && eventChangedCanonicalState(event),
  ).length;
}
