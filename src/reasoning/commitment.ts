import type { PropositionVersion } from "./types";

export type PropositionCommitment = "tentative" | "committed";

/**
 * Derived, not stored. Crossword complete fills are committed answers;
 * patterns such as MIDN? are persistent working state. Other domains have
 * no partial-fill notion, so active values count as committed reasoning.
 */
export function propositionCommitment(
  version: Pick<PropositionVersion, "subjectId" | "content">,
): PropositionCommitment {
  if (!version.subjectId.startsWith("crossword:")) return "committed";
  const content = version.content.trim();
  return /^[A-Z]+$/.test(content) ? "committed" : "tentative";
}

export function liveLabel(status: PropositionVersion["status"]): string {
  if (status === "active") return "current";
  return status;
}
