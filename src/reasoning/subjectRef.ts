/**
 * Resolve model-authored subject references without fuzzy matching.
 *
 * Exact ids always win. The only extra case is an unambiguous display paste
 * of `id — label` / `id — label: clue` onto a known issue id.
 */

const DISPLAY_DELIMITERS = [" — ", " – ", " - ", "—", "–"];

export type SubjectRefResolution = {
  id?: string;
  /** Set when the raw string was a unique `id — …` display form. */
  normalizedFrom?: string;
  error?: string;
};

export function knownIssueIds(
  subjects: Array<{ id: string }>,
  issueNodeIds: string[] = [],
): string[] {
  return [...new Set([...subjects.map((subject) => subject.id), ...issueNodeIds])];
}

function displayPrefixMatches(raw: string, id: string): boolean {
  if (raw === id) return true;
  for (const delimiter of DISPLAY_DELIMITERS) {
    if (raw.startsWith(`${id}${delimiter}`)) return true;
  }
  return false;
}

/**
 * Map a subjectId string onto known issue ids.
 * Multiple prefix hits keep the longest unique id; otherwise reject.
 */
export function resolveKnownSubjectId(
  raw: string | undefined,
  knownIds: readonly string[],
): SubjectRefResolution {
  if (raw === undefined) return {};
  const trimmed = raw.trim();
  if (!trimmed) return { error: "subjectId is empty" };
  if (knownIds.includes(trimmed)) return { id: trimmed };

  const matches = knownIds.filter((id) => displayPrefixMatches(trimmed, id));
  if (matches.length === 1) {
    return { id: matches[0], normalizedFrom: trimmed };
  }
  if (matches.length > 1) {
    const longest = [...matches].sort((a, b) => b.length - a.length);
    if (longest[0]!.length > longest[1]!.length) {
      return { id: longest[0], normalizedFrom: trimmed };
    }
    return { error: `subjectId references unknown issue ${trimmed}` };
  }
  return { error: `subjectId references unknown issue ${trimmed}` };
}
