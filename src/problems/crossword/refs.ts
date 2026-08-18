import type { CrosswordDirection } from "./types";
import type { Problem } from "../types";

export function crosswordIssueId(
  direction: CrosswordDirection,
  number: number,
): string {
  return `crossword:${direction}:${number}`;
}

export type CrosswordSubjectRef = {
  direction: CrosswordDirection;
  number: number;
};

/**
 * Parse a human crossword issue reference onto a direction+number.
 * Accepts canonical ids and unambiguous forms such as "Across 5", "5A", "A5".
 */
export function parseCrosswordSubjectRef(
  raw: string,
): CrosswordSubjectRef | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const canonical = trimmed.match(/^crossword:(across|down):(\d+)$/i);
  if (canonical) {
    return {
      direction: canonical[1]!.toLowerCase() as CrosswordDirection,
      number: Number(canonical[2]),
    };
  }

  const named =
    trimmed.match(/^(across|down)\s*[-:]?\s*(\d+)$/i) ??
    trimmed.match(/^(\d+)\s*[-:]?\s*(across|down)$/i);
  if (named) {
    const left = named[1]!;
    const right = named[2]!;
    if (/^\d+$/.test(left)) {
      return {
        direction: right.toLowerCase() as CrosswordDirection,
        number: Number(left),
      };
    }
    return {
      direction: left.toLowerCase() as CrosswordDirection,
      number: Number(right),
    };
  }

  const compact = trimmed.match(/^(\d+)\s*[-]?\s*([AD])$/i);
  if (compact) {
    return {
      direction: compact[2]!.toUpperCase() === "A" ? "across" : "down",
      number: Number(compact[1]),
    };
  }

  const prefixed = trimmed.match(/^([AD])\s*[-]?\s*(\d+)$/i);
  if (prefixed) {
    return {
      direction: prefixed[1]!.toUpperCase() === "A" ? "across" : "down",
      number: Number(prefixed[2]),
    };
  }

  return undefined;
}

export function crosswordSubjectIdFromRef(ref: CrosswordSubjectRef): string {
  return crosswordIssueId(ref.direction, ref.number);
}

export function resolveCrosswordSubject(
  problem: Problem,
  raw: string,
): { id?: string; error?: string } {
  const spec = problem.crossword;
  if (!spec) return { error: `subject references unknown issue ${raw.trim()}` };
  const parsed = parseCrosswordSubjectRef(raw);
  if (!parsed) return { error: `subject references unknown issue ${raw.trim()}` };
  const exists = spec.clues.some(
    (clue) =>
      clue.direction === parsed.direction && clue.number === parsed.number,
  );
  if (!exists) {
    return {
      error: `subject references unknown issue ${raw.trim()}`,
    };
  }
  return { id: crosswordSubjectIdFromRef(parsed) };
}
