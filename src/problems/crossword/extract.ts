import type { ReasoningMove } from "../../reasoning/types";
import { parseCrosswordSubjectRef } from "./refs";

const FILL_ASSIGNMENT =
  /(?:^|[.\n,;]|\s+and\s+)\s*(?:(across|down)\s+(\d+)|(\d+)\s*[- ]?(across|down|[ad])|([ad])\s*(\d+))\s*(?:=|:|is)\s*([A-Za-z]{2,20})/gi;

const FILL_BARE =
  /(?:^|[.\n,;])\s*(\d+)\s*([AD])\s+([A-Z]{2,20})\b/g;

const SUBSTANTIVE_SIGNAL =
  /(?:across|down)\s+\d+\s*(?:=|:|is)\s*[A-Za-z]{2,}|\d+\s*[- ]?(?:across|down|[ad])\b|\b[ad]\d+\b|\bcannot be\b|\bmust be\b|\bcrossing requires\b|\bchange\s+\w+\s+to\s+\w+/i;

function clueLabel(direction: string, number: number): string {
  return `${direction === "down" ? "Down" : "Across"} ${number}`;
}

function pushFill(
  out: ReasoningMove[],
  seen: Set<string>,
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
  const key = `${parsed.direction}:${parsed.number}:${answer}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    kind: "claim",
    subject: clueLabel(parsed.direction, parsed.number),
    value: answer,
    basis: ["clue"],
  });
}

/**
 * Recover simple crossword fill statements from natural language.
 * Conservative: only assignment-like patterns, never nuanced argument.
 */
export function extractCrosswordFillMoves(message: string): ReasoningMove[] {
  const out: ReasoningMove[] = [];
  const seen = new Set<string>();

  for (const match of message.matchAll(FILL_ASSIGNMENT)) {
    const namedDir = match[1];
    const namedNum = match[2];
    const compactNum = match[3];
    const compactDir = match[4];
    const prefixDir = match[5];
    const prefixNum = match[6];
    const value = match[7] ?? "";
    if (namedDir && namedNum) {
      pushFill(out, seen, namedDir, Number(namedNum), value);
    } else if (compactNum && compactDir) {
      pushFill(out, seen, compactDir, Number(compactNum), value);
    } else if (prefixDir && prefixNum) {
      pushFill(out, seen, prefixDir, Number(prefixNum), value);
    }
  }

  for (const match of message.matchAll(FILL_BARE)) {
    pushFill(out, seen, match[2]!, Number(match[1]), match[3]!);
  }

  return out;
}

export function crosswordMessageLooksSubstantive(message: string): boolean {
  return SUBSTANTIVE_SIGNAL.test(message);
}
