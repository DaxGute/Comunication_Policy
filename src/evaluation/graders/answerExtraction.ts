/**
 * Shared answer extraction from agent transcripts.
 */

const FINAL_ANSWER_MARKER = /FINAL_ANSWER:\s*/i;

export function hasFinalAnswerMarker(content: string): boolean {
  return FINAL_ANSWER_MARKER.test(content);
}

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

function looksLikeCrosswordBlock(lines: string[]): boolean {
  return lines.some((line) => {
    const t = line.trim();
    if (/^(across|down)\s*:?$/i.test(t)) return true;
    if (/^(across|down)\s+\d+\s*[:.\-–—)]/i.test(t)) return true;
    if (/^\d+\s*[:.\-–—)]\s*\S+/.test(t)) return true;
    return false;
  });
}

function looksLikeMultiLineAnswer(text: string, lines: string[]): boolean {
  if (text.length < 80) return false;
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  // Long write-ups: either multiple lines or one long paragraph.
  return nonEmpty.length >= 2 || text.length >= 160;
}

function cleanExtractedAnswer(raw: string): string | undefined {
  const text = raw.replace(/\r/g, "").trim();
  if (!text) return undefined;

  const lines = text.split("\n");
  const first = lines[0]?.trim() ?? "";
  const rest = lines.slice(1);

  if (looksLikeCrosswordBlock(lines)) {
    // Keep Across/Down sections even when separated by blank lines.
    // Only drop trailing commentary paragraphs that are not crossword-like.
    const parts = text.split(/\n\s*\n/);
    let end = parts.length;
    while (end > 1 && !looksLikeCrosswordBlock(parts[end - 1].split("\n"))) {
      end -= 1;
    }
    return parts.slice(0, end).join("\n\n").trim();
  }

  if (looksLikeMultiLineAnswer(text, lines)) {
    // Preserve paragraph structure for long collaborative answers.
    return text;
  }

  // Short prose answers (moral stances / legacy): keep consecutive non-empty lines.
  const proseLines: string[] = [];
  if (first) proseLines.push(first);
  for (const line of rest) {
    const trimmed = line.trim();
    if (!trimmed) break;
    proseLines.push(trimmed);
  }
  if (proseLines.length === 0) return undefined;

  let prose = proseLines.join(" ").trim();
  prose = prose.replace(/^['"`]+|['"`]+$/g, "").trim();
  prose = prose.replace(/[.;,:]+$/g, "").trim();
  return prose || undefined;
}
