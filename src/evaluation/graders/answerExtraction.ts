/**
 * Shared answer extraction from agent transcripts.
 */

const FINAL_ANSWER_MARKER = /FINAL_ANSWER:\s*/i;

export function extractFinalAnswerFromText(content: string): string | undefined {
  const match = content.match(FINAL_ANSWER_MARKER);
  if (!match || match.index === undefined) return undefined;
  const after = content.slice(match.index + match[0].length);
  return cleanExtractedAnswer(after);
}

export function extractFinalAnswerFromMessages(
  messages: Array<{ content: string }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = extractFinalAnswerFromText(messages[i].content);
    if (found) return found;
  }
  return undefined;
}

function looksLikeStructuredBlock(lines: string[]): boolean {
  return lines.some((line) => {
    const t = line.trim();
    if (/^(across|down)\s*:?$/i.test(t)) return true;
    if (/^(across|down)\s+\d+\s*[:.\-–—)]/i.test(t)) return true;
    if (/^\d+\s*[:.\-–—)]\s*\S+/.test(t)) return true;
    return false;
  });
}

function cleanExtractedAnswer(raw: string): string | undefined {
  const text = raw.replace(/\r/g, "").trim();
  if (!text) return undefined;

  const lines = text.split("\n");
  const first = lines[0]?.trim() ?? "";
  const rest = lines.slice(1);

  if (looksLikeStructuredBlock(lines)) {
    // Keep multi-line clue-assignment / grid blocks intact.
    let block = text;
    // Drop a trailing blank-line commentary paragraph if present after a dense block.
    const parts = block.split(/\n\s*\n/);
    if (parts.length > 1 && looksLikeStructuredBlock(parts[0].split("\n"))) {
      block = parts[0].trim();
    }
    return block;
  }

  // Single-line answers (moral / proof / legacy).
  let line = first;
  line = line.replace(/^['"`]+|['"`]+$/g, "").trim();
  line = line.replace(/[.;,:]+$/g, "").trim();
  if (rest.length && !line) {
    // FINAL_ANSWER: on its own line with body below that isn't structured — take next line.
    line = rest[0]?.trim() ?? "";
    line = line.replace(/^['"`]+|['"`]+$/g, "").trim();
    line = line.replace(/[.;,:]+$/g, "").trim();
  }
  return line || undefined;
}
