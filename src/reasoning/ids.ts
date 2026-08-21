export function isValidReasoningId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(id);
}

export function nextPropositionVersionId(existingIds: Iterable<string>): string {
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`pv-${n}`)) n += 1;
  return `pv-${n}`;
}

/** Human title for a lane. Moral ids without a separate label become readable names. */
export function subjectDisplayTitle(subject: {
  id: string;
  label?: string;
}): string {
  const label = subject.label?.trim();
  if (label && label !== subject.id) return label;
  const id = subject.id.trim();
  if (/^moral:/i.test(id)) {
    const rest = id.replace(/^moral:/i, "").replace(/[_-]+/g, " ").trim();
    if (!rest) return id;
    return rest.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  return label || id;
}

