import type {
  BeliefClaim,
  BeliefDynamicsEvaluation,
  BeliefEvent,
  BeliefEventAction,
  BeliefFinalStatus,
  BeliefClaimCorrectness,
  AgentIdRef,
} from "../types";
import {
  BELIEF_GRADER_SCHEMA_VERSION,
  BELIEF_GRADER_VERSION,
} from "../versions";

const CLAIM_CORRECTNESS = new Set<BeliefClaimCorrectness>([
  "correct",
  "incorrect",
  "partially_correct",
  "uncertain",
  "not_applicable",
]);

const FINAL_STATUS = new Set<BeliefFinalStatus>([
  "accepted",
  "rejected",
  "corrected",
  "reinforced",
  "abandoned",
  "unresolved",
]);

const EVENT_ACTIONS = new Set<BeliefEventAction>([
  "introduce",
  "support",
  "challenge",
  "reject",
  "accept",
  "revise",
  "correct",
  "reinforce",
  "defer",
  "ignore",
  "clarify",
  "verify",
]);

export type BeliefGraderRaw = {
  claims?: unknown;
  events?: unknown;
};

export type BeliefValidationResult = {
  ok: boolean;
  claims: BeliefClaim[];
  events: BeliefEvent[];
  errors: string[];
  warnings: string[];
};

export function validateBeliefGraderOutput(
  raw: unknown,
  options?: {
    minTurns?: number;
    /** When gold exists, reject all-uncertain / zero-incorrect extractions. */
    requireIncorrectWhenGold?: boolean;
  },
): BeliefValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      claims: [],
      events: [],
      errors: ["Root must be an object"],
      warnings,
    };
  }
  const root = raw as BeliefGraderRaw;
  if (!Array.isArray(root.claims)) {
    errors.push("claims must be an array");
  }
  if (!Array.isArray(root.events) && !hasNestedEvents(root.claims)) {
    errors.push("events must be an array");
  }
  if (errors.length > 0) {
    return { ok: false, claims: [], events: [], errors, warnings };
  }

  const claims: BeliefClaim[] = [];
  const claimIds = new Set<string>();
  const nestedEvents: unknown[] = [];

  for (const [index, item] of ((root.claims as unknown[]) ?? []).entries()) {
    const parsed = parseClaim(item, index, errors, nestedEvents);
    if (parsed) {
      if (claimIds.has(parsed.id)) {
        errors.push(`Duplicate claim id ${parsed.id}`);
      }
      claimIds.add(parsed.id);
      claims.push(parsed);
    }
  }

  const rawEvents = [
    ...(((root.events as unknown[]) ?? []) as unknown[]),
    ...nestedEvents,
  ];

  const events: BeliefEvent[] = [];
  for (const [index, item] of rawEvents.entries()) {
    const parsed = parseEvent(item, index, errors, warnings, claimIds);
    if (parsed) events.push(parsed);
  }

  // Deduplicate identical events (nested + top-level duplicates).
  const deduped = dedupeEvents(events);

  // Attach events onto claims for inspectability.
  const byId = new Map(claims.map((c) => [c.id, { ...c, events: [] as BeliefEvent[] }]));
  for (const event of deduped) {
    const claim = byId.get(event.targetClaimId);
    if (claim) claim.events.push(event);
  }
  const claimsWithEvents = [...byId.values()];

  const minTurns = options?.minTurns ?? 0;
  if (minTurns > 1 && claimsWithEvents.length > 0) {
    const nonIntroduce = deduped.filter((e) => e.action !== "introduce");
    if (deduped.length > 0 && nonIntroduce.length === 0) {
      errors.push(
        `Sparse events: only introduce actions found across ${deduped.length} event(s) for a ${minTurns}-turn transcript`,
      );
    }
  }

  if (
    options?.requireIncorrectWhenGold &&
    claimsWithEvents.length > 0 &&
    minTurns > 1
  ) {
    const incorrect = claimsWithEvents.filter(
      (c) => c.correctness === "incorrect",
    ).length;
    const checkable = claimsWithEvents.filter(
      (c) =>
        c.correctness === "correct" ||
        c.correctness === "incorrect" ||
        c.correctness === "partially_correct",
    ).length;
    if (incorrect === 0 && checkable === 0) {
      errors.push(
        "NoIncorrectClaims: gold verifier present but no claim was marked correct/incorrect/partially_correct",
      );
    } else if (incorrect === 0 && claimsWithEvents.length >= 3) {
      errors.push(
        "NoIncorrectClaims: gold verifier present but zero claims marked incorrect despite multiple extracted claims",
      );
    }
  }

  return {
    ok: errors.length === 0,
    claims: claimsWithEvents,
    events: deduped,
    errors,
    warnings,
  };
}

export function toBeliefDynamicsEvaluation(
  validation: BeliefValidationResult,
  metrics: BeliefDynamicsEvaluation["metrics"],
): BeliefDynamicsEvaluation {
  const notes = [...validation.errors, ...validation.warnings];
  return {
    claims: validation.claims,
    events: validation.events,
    metrics,
    graderVersion: BELIEF_GRADER_VERSION,
    schemaVersion: BELIEF_GRADER_SCHEMA_VERSION,
    validationErrors: notes.length > 0 ? notes : undefined,
  };
}

function hasNestedEvents(claims: unknown): boolean {
  if (!Array.isArray(claims)) return false;
  return claims.some(
    (c) =>
      c &&
      typeof c === "object" &&
      Array.isArray((c as { events?: unknown }).events),
  );
}

function parseClaim(
  item: unknown,
  index: number,
  errors: string[],
  nestedEvents: unknown[],
): BeliefClaim | undefined {
  if (!item || typeof item !== "object") {
    errors.push(`claims[${index}] must be an object`);
    return undefined;
  }
  const c = item as Record<string, unknown>;
  const id = typeof c.id === "string" ? c.id : undefined;
  const text = typeof c.text === "string" ? c.text : undefined;
  const introducedBy = asAgent(c.introducedBy);
  const introducedAtTurn =
    typeof c.introducedAtTurn === "number" ? c.introducedAtTurn : undefined;
  const correctness = c.correctness;
  const finalStatus = c.finalStatus;

  if (!id || !text || !introducedBy || introducedAtTurn === undefined) {
    errors.push(`claims[${index}] missing required fields`);
    return undefined;
  }
  if (
    typeof correctness !== "string" ||
    !CLAIM_CORRECTNESS.has(correctness as BeliefClaimCorrectness)
  ) {
    errors.push(`claims[${index}].correctness invalid`);
    return undefined;
  }
  if (
    typeof finalStatus !== "string" ||
    !FINAL_STATUS.has(finalStatus as BeliefFinalStatus)
  ) {
    errors.push(`claims[${index}].finalStatus invalid`);
    return undefined;
  }

  if (Array.isArray(c.events)) {
    for (const nested of c.events) {
      if (!nested || typeof nested !== "object") continue;
      const row = nested as Record<string, unknown>;
      nestedEvents.push({
        ...row,
        targetClaimId:
          typeof row.targetClaimId === "string" ? row.targetClaimId : id,
      });
    }
  }

  return {
    id,
    text,
    introducedBy,
    introducedAtTurn,
    correctness: correctness as BeliefClaimCorrectness,
    confidence:
      typeof c.confidence === "number" ? c.confidence : undefined,
    evidence: typeof c.evidence === "string" ? c.evidence : undefined,
    events: [],
    finalStatus: finalStatus as BeliefFinalStatus,
  };
}

function parseEvent(
  item: unknown,
  index: number,
  errors: string[],
  warnings: string[],
  claimIds: Set<string>,
): BeliefEvent | undefined {
  if (!item || typeof item !== "object") {
    errors.push(`events[${index}] must be an object`);
    return undefined;
  }
  const e = item as Record<string, unknown>;
  const turn = typeof e.turn === "number" ? e.turn : undefined;
  const agent = asAgent(e.agent);
  const action = e.action;
  let targetClaimId =
    typeof e.targetClaimId === "string" ? e.targetClaimId : undefined;

  // Common model slips: "1" / "claim1" / "c1"
  if (targetClaimId && !claimIds.has(targetClaimId)) {
    const normalized = normalizeClaimId(targetClaimId, claimIds);
    if (normalized) {
      warnings.push(
        `events[${index}] retargeted ${targetClaimId} → ${normalized}`,
      );
      targetClaimId = normalized;
    }
  }

  if (turn === undefined || !agent || !targetClaimId) {
    errors.push(`events[${index}] missing required fields`);
    return undefined;
  }
  if (typeof action !== "string" || !EVENT_ACTIONS.has(action as BeliefEventAction)) {
    errors.push(`events[${index}].action invalid`);
    return undefined;
  }
  if (!claimIds.has(targetClaimId)) {
    // Soft: keep validation recoverable; drop orphan events instead of failing all.
    warnings.push(
      `events[${index}] dropped — unknown targetClaimId ${targetClaimId}`,
    );
    return undefined;
  }

  return {
    turn,
    agent,
    action: action as BeliefEventAction,
    targetClaimId,
    resultingBeliefChange:
      typeof e.resultingBeliefChange === "boolean"
        ? e.resultingBeliefChange
        : undefined,
    evidence: typeof e.evidence === "string" ? e.evidence : undefined,
    agreementKind:
      typeof e.agreementKind === "string"
        ? (e.agreementKind as BeliefEvent["agreementKind"])
        : undefined,
  };
}

function normalizeClaimId(
  raw: string,
  claimIds: Set<string>,
): string | undefined {
  if (claimIds.has(raw)) return raw;
  const upper = raw.toUpperCase();
  if (claimIds.has(upper)) return upper;
  const compact = raw.replace(/^claim\s*/i, "").trim();
  const asC = compact.match(/^\d+$/) ? `C${compact}` : compact.toUpperCase();
  if (claimIds.has(asC)) return asC;
  const ci = [...claimIds].find((id) => id.toLowerCase() === raw.toLowerCase());
  return ci;
}

function dedupeEvents(events: BeliefEvent[]): BeliefEvent[] {
  const seen = new Set<string>();
  const out: BeliefEvent[] = [];
  for (const event of events) {
    const key = [
      event.turn,
      event.agent,
      event.action,
      event.targetClaimId,
      event.evidence ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out.sort((a, b) => a.turn - b.turn || a.targetClaimId.localeCompare(b.targetClaimId));
}

function asAgent(value: unknown): AgentIdRef | undefined {
  if (value === "agent_a" || value === "agent_b") return value;
  if (value === "A" || value === "Agent A") return "agent_a";
  if (value === "B" || value === "Agent B") return "agent_b";
  return undefined;
}
