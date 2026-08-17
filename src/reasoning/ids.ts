import type { AtomicReasoningNodeType } from "./types";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

const TYPE_PREFIX: Record<AtomicReasoningNodeType, string> = {
  issue: "I",
  proposal: "P",
  claim: "C",
  evidence: "E",
  challenge: "X",
};

export function isValidReasoningId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function prefixForType(type: AtomicReasoningNodeType): string {
  return TYPE_PREFIX[type];
}

export function nextReasoningId(
  type: AtomicReasoningNodeType,
  existingIds: Iterable<string>,
): string {
  const prefix = TYPE_PREFIX[type];
  const used = new Set(existingIds);
  let n = 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

export function allocateReasoningId(
  _requested: string | undefined,
  type: AtomicReasoningNodeType,
  existingIds: Iterable<string>,
): string {
  return nextReasoningId(type, existingIds);
}
