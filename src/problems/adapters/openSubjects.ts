/**
 * Moral graph lanes are considerations only.
 * The dilemma is task context. The overall answer is final synthesis.
 *
 * Active architecture: agent-created empty graphs only.
 * Benchmark issue labels stay on the problem for post-hoc evaluation and are
 * never injected into agent memory.
 *
 * Legacy seeding aliases (`explicit-task-only`, `explicit-task-seeded`, `none`)
 * are accepted only so old configs/ablation snapshots parse. They normalize to
 * agent-created and never seed subjects on the live path.
 */
import type { ReasoningSubject } from "../../reasoning/types";
import { reservedMoralSubjectKey } from "../../reasoning/moralOntology";
import type { Problem } from "../types";

/** @deprecated Prefer MoralSubjectInitialization. Historical aliases only. */
export type MoralSubjectSeeding =
  | "agent-created"
  | "explicit-task-seeded"
  | "none"
  | "explicit-task-only";

export type MoralSubjectInitialization = "agent-created";

export const DEFAULT_MORAL_SUBJECT_INITIALIZATION: MoralSubjectInitialization =
  "agent-created";

/** @deprecated Use DEFAULT_MORAL_SUBJECT_INITIALIZATION. */
export const DEFAULT_MORAL_SUBJECT_SEEDING: MoralSubjectSeeding = "agent-created";

export function parseMoralSubjectSeeding(
  raw: unknown,
): MoralSubjectSeeding | undefined {
  return raw === "agent-created" ||
    raw === "explicit-task-seeded" ||
    raw === "none" ||
    raw === "explicit-task-only"
    ? raw
    : undefined;
}

export function normalizeMoralSubjectSeeding(
  _raw?: MoralSubjectSeeding,
): MoralSubjectInitialization {
  return "agent-created";
}

export function reservedMoralSubjectError(raw: string): string | undefined {
  const kind = reservedMoralSubjectKey(raw);
  if (kind === "dilemma_mirror") {
    return "the dilemma is task context, not a consideration";
  }
  if (kind === "overall_answer") {
    return [
      "Overall/final stance is not a consideration.",
      "Persist independently revisable considerations instead.",
      "Synthesize the overall answer only as FINAL_ANSWER outside the graph.",
    ].join(" ");
  }
  return undefined;
}

export function isMoralSubjectId(id: string): boolean {
  return id.trim().replace(/\s+/g, "").toLowerCase().startsWith("moral:");
}

/**
 * Reference consideration labels from the dataset. Used for post-hoc
 * coverage metrics only — never injected into agent memory.
 */
export function referenceMoralConsiderations(problem: Problem): string[] {
  return (problem.moral?.issues ?? []).map((issue) => issue.trim()).filter(Boolean);
}

/** Moral conversations always start with an empty consideration graph. */
export function moralSubjectsForProblem(
  _problem: Problem,
  _seeding: MoralSubjectSeeding = DEFAULT_MORAL_SUBJECT_SEEDING,
): ReasoningSubject[] {
  return [];
}

/**
 * Hidden Profile conversations start with an empty agent-created graph —
 * same rule as Moral. Do not seed options, evidence lanes, or evaluator tags.
 */
export function hiddenProfileSubjectsForProblem(
  _problem: Problem,
): ReasoningSubject[] {
  return [];
}

export function isLegacyMoralGraphSubject(subject: ReasoningSubject): boolean {
  return reservedMoralSubjectKey(subject.id) !== undefined;
}
