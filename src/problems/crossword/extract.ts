import type { ReasoningMove } from "../../reasoning/types";
import { parseCrosswordSubjectRef } from "./refs";

const FILL_ASSIGNMENT =
  /(?:^|[.\n,;]|\s+and\s+)\s*(?:(across|down)\s+(\d+)|(\d+)\s*[- ]?(across|down|[ad])|([ad])\s*(\d+))\s*(?:=|:|is)\s*([A-Za-z]{2,20})/gi;

const FILL_BARE =
  /(?:^|[.\n,;])\s*(\d+)\s*([AD])\s+([A-Z]{2,20})\b/g;

const ALTERNATIVE_LIST =
  /\b(?:could be|either|or|\/)\b.+\b(?:or|\/|,)\b/i;

/** Committed assignment only — discussion without a fill is not a graph event. */
const COMMITTED_ASSIGNMENT =
  /(?:across|down)\s+\d+\s*(?:=|:|is)\s*[A-Za-z]{2,}|\d+\s*[- ]?(?:across|down|[ad])\s*(?:=|:|is)\s*[A-Za-z]{2,}|\b[ad]\d+\s*(?:=|:)\s*[A-Za-z]{2,}/i;

function clueLabel(direction: string, number: number): string {
  return `${direction === "down" ? "Down" : "Across"} ${number}`;
}

function pushFill(
  latestBySubject: Map<string, ReasoningMove>,
  direction: string,
  number: number,
  value: string,
): void {
  const down = direction.toLowerCase() === "d" || direction.toLowerCase() === "down";
  const parsed = parseCrosswordSubjectRef(
    `${down ? "Down" : "Across"} ${number}`,
  );
  if (!parsed) return;
  const answer = value.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (answer.length < 2) return;
  const subject = clueLabel(parsed.direction, parsed.number);
  latestBySubject.set(`${parsed.direction}:${parsed.number}`, {
    kind: "claim",
    subject,
    value: answer,
    basis: ["clue"],
  });
}

/**
 * Recover simple crossword fill statements from natural language.
 * Conservative: only assignment-like patterns, never nuanced argument.
 * At most one committed fill per clue.
 */
export function extractCrosswordFillMoves(message: string): ReasoningMove[] {
  if (ALTERNATIVE_LIST.test(message) && (message.match(/\b[A-Z]{2,20}\b/g) ?? []).length >= 3) {
    return [];
  }
  const latestBySubject = new Map<string, ReasoningMove>();

  for (const match of message.matchAll(FILL_ASSIGNMENT)) {
    const namedDir = match[1];
    const namedNum = match[2];
    const compactNum = match[3];
    const compactDir = match[4];
    const prefixDir = match[5];
    const prefixNum = match[6];
    const value = match[7] ?? "";
    if (namedDir && namedNum) {
      pushFill(latestBySubject, namedDir, Number(namedNum), value);
    } else if (compactNum && compactDir) {
      pushFill(latestBySubject, compactDir, Number(compactNum), value);
    } else if (prefixDir && prefixNum) {
      pushFill(latestBySubject, prefixDir, Number(prefixNum), value);
    }
  }

  for (const match of message.matchAll(FILL_BARE)) {
    pushFill(latestBySubject, match[2]!, Number(match[1]), match[3]!);
  }

  return [...latestBySubject.values()];
}

export function crosswordMessageLooksSubstantive(message: string): boolean {
  return COMMITTED_ASSIGNMENT.test(message);
}
