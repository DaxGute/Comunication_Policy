export const DEFAULT_STALL_RECOVERY_TURNS = 3;
export const DEFAULT_STALL_FAIL_TURNS = 8;

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

export function acceptedGraphMutations(events: { accepted: boolean; operation: { type: string }; turnIndex: number }[], turnIndex: number): number {
  return events.filter(
    (event) =>
      event.accepted &&
      event.turnIndex === turnIndex &&
      event.operation.type !== "invalid" &&
      event.operation.type !== "protocol_failure",
  ).length;
}
