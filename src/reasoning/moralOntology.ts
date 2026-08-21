/**
 * Moral ontology: considerations only.
 * The dilemma is task context. The overall answer is FINAL_ANSWER.
 * Forbidden subject ids are rejected on SET and stripped on hydrate.
 */
export type ForbiddenMoralKind = "dilemma_mirror" | "overall_answer";

function normalizeKey(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Retired ids that must never appear as considerations. */
const DILEMMA_MIRROR_IDS = new Set(["moral:question", "question"]);
const OVERALL_ANSWER_IDS = new Set([
  "moral:stance",
  "stance",
  "moral:joint_stance",
  "joint_stance",
  "moral:final_answer",
  "moral:final_stance",
  "moral:overall_stance",
  "moral:overall_conclusion",
  "moral:overall_answer",
  "overall_answer",
  "overall_stance",
]);
const OVERALL_ANSWER_LABELS = new Set([
  "stance",
  "joint stance",
  "final stance",
  "overall stance",
  "overall answer",
  "final answer",
  "overall conclusion",
]);

export function reservedMoralSubjectKey(
  raw: string,
): ForbiddenMoralKind | undefined {
  const id = normalizeKey(raw);
  const label = normalizeLabel(raw);
  if (
    DILEMMA_MIRROR_IDS.has(id) ||
    label === "question" ||
    label === "the question"
  ) {
    return "dilemma_mirror";
  }
  if (OVERALL_ANSWER_IDS.has(id) || OVERALL_ANSWER_LABELS.has(label)) {
    return "overall_answer";
  }
  return undefined;
}

export function isForbiddenMoralSubject(subject: {
  id: string;
  label?: string;
  metadata?: Record<string, unknown>;
}): boolean {
  const role =
    typeof subject.metadata?.role === "string"
      ? subject.metadata.role.toLowerCase()
      : "";
  if (role === "question" || role === "stance") return true;
  return (
    reservedMoralSubjectKey(subject.id) !== undefined ||
    reservedMoralSubjectKey(subject.label ?? "") !== undefined
  );
}

/** @deprecated Use isForbiddenMoralSubject. */
export const isLegacyMoralSubject = isForbiddenMoralSubject;

export function dilemmaExcerpt(problemText: string): string {
  const match = problemText.match(
    /Discussion question:\s*([\s\S]*?)(?:\n\n[A-Z][\w /]+:|\n\nExplore |\n\nTreat |\n\nFINAL_ANSWER|\s*$)/i,
  );
  if (match?.[1]?.trim()) return match[1].trim();
  const scenario = problemText.match(
    /Scenario:\s*([\s\S]*?)(?:\n\nRelevant |\n\nDiscussion |\n\nKey )/i,
  );
  if (scenario?.[1]?.trim()) return scenario[1].trim();
  return problemText.trim();
}
