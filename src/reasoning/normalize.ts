import type { ReasoningMove } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

const MOVE_KINDS = new Set([
  "claim",
  "evidence",
  "revise",
  "agree",
  "disagree",
  "support",
  "challenge",
]);

function asMoveKind(value: unknown): ReasoningMove["kind"] | undefined {
  if (typeof value !== "string") return undefined;
  const lower = value.toLowerCase();
  if (MOVE_KINDS.has(lower)) return lower as ReasoningMove["kind"];
  if (lower === "proposal" || lower === "propose") return "claim";
  if (lower === "accept") return "agree";
  if (lower === "reject") return "disagree";
  return undefined;
}

function subjectOf(raw: Record<string, unknown>): string | undefined {
  return asString(raw.subject) ?? asString(raw.subjectId) ?? asString(raw.subject_id);
}

function valueOf(raw: Record<string, unknown>): string | undefined {
  return (
    asString(raw.value) ??
    asString(raw.text) ??
    asString(raw.answer) ??
    asString(raw.proposal)
  );
}

function claimOf(raw: Record<string, unknown>): string | undefined {
  return (
    asString(raw.claim) ??
    asString(raw.targetId) ??
    asString(raw.target) ??
    asString(raw.targetNodeId)
  );
}

export type NormalizedMove = {
  move?: ReasoningMove;
  normalizedFromMalformedShape: boolean;
  invalid?: boolean;
  raw?: unknown;
};

/**
 * Recover obvious Nano vocabulary mistakes into semantic moves.
 * Ambiguous or empty objects stay invalid.
 */
export function normalizeReasoningMove(raw: unknown): NormalizedMove {
  if (!isRecord(raw)) return { invalid: true, raw, normalizedFromMalformedShape: false };

  const kindFromKind = asMoveKind(raw.kind);
  const createType =
    asMoveKind(raw.create) ??
    asMoveKind(raw.nodeType) ??
    asMoveKind(raw.type) ??
    asMoveKind(raw.action);
  const action = asString(raw.action)?.toLowerCase();

  let malformed = false;
  let kind = kindFromKind;
  if (!kind && createType) {
    kind = createType;
    malformed =
      raw.create !== undefined ||
      raw.nodeType !== undefined ||
      (action !== undefined && action !== kind);
  }
  if (!kind && asString(raw.proposal) && Object.keys(raw).length <= 3) {
    kind = "claim";
    malformed = true;
  }
  if (!kind && (action === "create" || action === "propose")) {
    kind = asMoveKind(raw.nodeType) ?? "claim";
    malformed = Boolean(raw.nodeType) && !kindFromKind;
  }
  if (!kind && (action === "accept" || action === "agree")) kind = "agree";
  if (!kind && (action === "reject" || action === "disagree")) kind = "disagree";
  if (!kind && action === "revise") kind = "revise";
  if (!kind && (action === "support" || action === "challenge")) {
    kind = action;
  }

  if (!kind) return { invalid: true, raw, normalizedFromMalformedShape: false };

  if (kind === "evidence") {
    const text = asString(raw.text)?.trim();
    if (!text) return { invalid: true, raw, normalizedFromMalformedShape: malformed };
    return {
      move: {
        kind: "evidence",
        text,
        source: asString(raw.source),
        subject: subjectOf(raw),
      },
      normalizedFromMalformedShape: malformed,
    };
  }

  if (kind === "claim") {
    const value = valueOf(raw)?.trim();
    if (!value) return { invalid: true, raw, normalizedFromMalformedShape: malformed };
    return {
      move: {
        kind: "claim",
        subject: subjectOf(raw),
        value,
        text: asString(raw.text),
        basis: asStringArray(raw.basis),
      },
      normalizedFromMalformedShape: malformed,
    };
  }

  if (kind === "revise") {
    const value = valueOf(raw)?.trim();
    if (!value) return { invalid: true, raw, normalizedFromMalformedShape: malformed };
    const selectorRaw = asString(raw.selector)?.toLowerCase();
    return {
      move: {
        kind: "revise",
        subject: subjectOf(raw),
        claim: claimOf(raw),
        value,
        text: asString(raw.text),
        basis: asStringArray(raw.basis),
        selector:
          selectorRaw === "previous" || selectorRaw === "current"
            ? selectorRaw
            : undefined,
      },
      normalizedFromMalformedShape: malformed,
    };
  }

  if (kind === "agree") {
    return {
      move: {
        kind: "agree",
        subject: subjectOf(raw),
        claim: claimOf(raw),
      },
      normalizedFromMalformedShape: malformed,
    };
  }

  if (kind === "disagree") {
    return {
      move: {
        kind: "disagree",
        subject: subjectOf(raw),
        claim: claimOf(raw),
        basis: asStringArray(raw.basis),
      },
      normalizedFromMalformedShape: malformed,
    };
  }

  return {
    move: {
      kind,
      source: asString(raw.source) ?? asString(raw.sourceNodeId),
      target: claimOf(raw),
      subject: subjectOf(raw),
      reason: asString(raw.reason),
    },
    normalizedFromMalformedShape: malformed,
  };
}

export function looksLikeMoveRecord(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (asMoveKind(raw.kind)) return true;
  if (raw.create !== undefined || raw.proposal !== undefined) return true;
  if (raw.nodeType !== undefined && raw.text !== undefined && raw.action === undefined) {
    return true;
  }
  const action = asString(raw.action)?.toLowerCase();
  return (
    action === "agree" ||
    action === "disagree" ||
    action === "claim" ||
    action === "evidence"
  );
}
