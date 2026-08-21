import { activeVersion, type IssueConflict, type ReasoningGraph } from "../../reasoning/types";
import { crosswordMessageLooksSubstantive } from "../crossword/extract";
import { findCrosswordCrossings } from "../crossword/geometry";
import { crosswordIssueId, resolveCrosswordSubject } from "../crossword/refs";
import type { CrosswordClue } from "../crossword/types";
import type { Problem } from "../types";
import type { TaskReasoningAdapter } from "./types";

export { crosswordIssueId };

/**
 * Letters-only complete fill. Used for scoring and crossing conflicts.
 * Does not interpret wildcards.
 */
export function normalizeCrosswordCandidate(answer: string): string {
  return answer.replace(/[^A-Za-z]/g, "").toUpperCase();
}

/**
 * Canonical reasoning-state pattern: uppercase, `_` / `.` / `-` → `?`.
 * Complete fills are all letters. Partial constraints keep `?`.
 */
export function normalizeCrosswordPattern(content: string): string {
  return content
    .trim()
    .toUpperCase()
    .replace(/[_\-.\s]/g, "?")
    .replace(/[^A-Z?]/g, "");
}

export function isCompleteCrosswordFill(pattern: string): boolean {
  return pattern.length > 0 && /^[A-Z]+$/.test(pattern);
}

const CROSSWORD_ANSWER_FORMAT = /^[A-Z]+$/;

function crossword(problem: Problem) {
  if (!problem.crossword) {
    throw new Error(`Problem ${problem.id} has no crossword specification`);
  }
  return problem.crossword;
}

function clueLabel(clue: CrosswordClue): string {
  return `${clue.direction === "down" ? "Down" : "Across"} ${clue.number}`;
}

function clueForIssue(problem: Problem, issueId: string): CrosswordClue | undefined {
  return crossword(problem).clues.find(
    (clue) => crosswordIssueId(clue.direction, clue.number) === issueId,
  );
}

/**
 * Scorable live answer: a complete letters-only fill of the clue length.
 * Partial patterns such as MIDN? are reasoning state, not grid fills.
 */
export function completedCrosswordFill(
  graph: ReasoningGraph,
  issueId: string,
  length?: number,
): string | undefined {
  const content = activeVersion(graph, issueId)?.content;
  if (!content) return undefined;
  if (!isCompleteCrosswordFill(content)) return undefined;
  if (length !== undefined && content.length !== length) return undefined;
  return content;
}

function currentFill(graph: ReasoningGraph, issueId: string, length?: number): string | undefined {
  return completedCrosswordFill(graph, issueId, length);
}

export function validateCrosswordContent(
  problem: Problem,
  subjectId: string,
  content: string,
): { ok: boolean; reasons?: string[]; normalized?: string } {
  const clue = clueForIssue(problem, subjectId);
  if (!clue) {
    return { ok: false, reasons: [`unknown crossword entry ${subjectId}`] };
  }
  let pattern = normalizeCrosswordPattern(content);
  if (!pattern) {
    return {
      ok: false,
      reasons: [`${clueLabel(clue)} has no parseable letters or pattern`],
    };
  }
  if (pattern.includes("?") && pattern.length < clue.length) {
    pattern = pattern.padEnd(clue.length, "?");
  }
  const reasons: string[] = [];
  if (pattern.length !== clue.length) {
    reasons.push(
      `${clueLabel(clue)} ${isCompleteCrosswordFill(pattern) ? "candidate" : "pattern"} length ${pattern.length} does not equal ${clue.length}`,
    );
  }
  if (isCompleteCrosswordFill(pattern) && !CROSSWORD_ANSWER_FORMAT.test(pattern)) {
    reasons.push(`${clueLabel(clue)} candidate must be letters-only crossword fill`);
  }
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, normalized: pattern };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function crosswordSolverStateFingerprint(
  problem: Problem,
  graph: ReasoningGraph,
): string {
  const spec = crossword(problem);
  const fills: Record<string, string | null> = {};
  for (const clue of spec.clues) {
    const id = crosswordIssueId(clue.direction, clue.number);
    fills[id] = activeVersion(graph, id)?.content ?? null;
  }
  const conflicts = deriveCrosswordConflicts(problem, graph)
    .map((conflict) => conflict.description ?? "")
    .sort();
  return stableStringify({ fills, conflicts });
}

export function deriveCrosswordConflicts(
  problem: Problem,
  graph: ReasoningGraph,
): IssueConflict[] {
  const spec = crossword(problem);
  const conflicts: IssueConflict[] = [];
  for (const crossing of findCrosswordCrossings(spec.clues)) {
    const acrossIssueId = crosswordIssueId("across", crossing.acrossNumber);
    const downIssueId = crosswordIssueId("down", crossing.downNumber);
    const acrossClue = spec.clues.find(
      (clue) => clue.direction === "across" && clue.number === crossing.acrossNumber,
    );
    const downClue = spec.clues.find(
      (clue) => clue.direction === "down" && clue.number === crossing.downNumber,
    );
    const across = currentFill(graph, acrossIssueId, acrossClue?.length);
    const down = currentFill(graph, downIssueId, downClue?.length);
    if (!across || !down) continue;
    const acrossLetter = across[crossing.acrossIndex];
    const downLetter = down[crossing.downIndex];
    if (!acrossLetter || !downLetter || acrossLetter === downLetter) continue;
    const acrossVersion = activeVersion(graph, acrossIssueId);
    const downVersion = activeVersion(graph, downIssueId);
    const description =
      `row ${crossing.row + 1}, col ${crossing.col + 1}: ` +
      `${acrossIssueId} has ${acrossLetter}, ${downIssueId} has ${downLetter}`;
    const nodeIds = [acrossVersion?.id, downVersion?.id].filter(
      (id): id is string => Boolean(id),
    );
    conflicts.push(
      {
        issueId: acrossIssueId,
        nodeIds,
        source: "task_constraint",
        description,
      },
      {
        issueId: downIssueId,
        nodeIds,
        source: "task_constraint",
        description,
      },
    );
  }
  return conflicts;
}

export const crosswordReasoningAdapter: TaskReasoningAdapter = {
  category: "crossword",
  subjectsAreClosed: true,
  getInitialIssues(problem) {
    return crossword(problem).clues.map((clue) => ({
      id: crosswordIssueId(clue.direction, clue.number),
      kind: "task_defined" as const,
      label: clueLabel(clue),
      prompt: clue.clue,
      description: clue.clue,
      source: "task" as const,
      metadata: {
        direction: clue.direction,
        number: clue.number,
        row: clue.row,
        col: clue.col,
        length: clue.length,
      },
    }));
  },
  resolveSubject: resolveCrosswordSubject,
  validateContent: validateCrosswordContent,
  messageLooksSubstantive: (_problem, message) =>
    crosswordMessageLooksSubstantive(message),
  deriveConflicts: deriveCrosswordConflicts,
  solverStateFingerprint: (problem, graph) =>
    crosswordSolverStateFingerprint(problem, graph),
};
