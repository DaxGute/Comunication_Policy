const COMMITTED_ASSIGNMENT =
  /(?:across|down)\s+\d+\s*(?:=|:|is)\s*[A-Za-z]{2,}|\d+\s*[- ]?(?:across|down|[ad])\s*(?:=|:|is)\s*[A-Za-z]{2,}|\b[ad]\d+\s*(?:=|:)\s*[A-Za-z]{2,}/i;

export function crosswordMessageLooksSubstantive(message: string): boolean {
  return COMMITTED_ASSIGNMENT.test(message);
}
