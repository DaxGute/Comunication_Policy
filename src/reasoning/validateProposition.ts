/**
 * Deterministic gates for committed graph mutations.
 *
 * Internal search may be messy. Graph nodes must look like propositions a
 * human would recognize as an actual reasoning step.
 */
import type { AtomicReasoningNodeType, ReasoningNode } from "./types";

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export const MIN_COMMIT_CONFIDENCE = 0.5;

const PROCESS_NARRATION =
  /^(?:let'?s|let me|i(?:'m| am) (?:just )?thinking|i (?:will|should|need to) (?:think|consider|look|try|guess|brainstorm)|we (?:should|could|might) (?:consider|look|think|try)|just (?:thinking|considering|looking)|thinking (?:about|out loud)|hmm+|uh+)\b/i;

const QUESTION_ONLY =
  /^(?:who|what|when|where|why|how|is|are|does|do|did|can|could|should|would|will|which)\b.+\?\s*$/i;

const ALTERNATIVE_LIST =
  /\b(?:either\s+.+\s+or\b)|(?:\b(?:or|\/)\b.+\b(?:or|\/)\b)|(?:\bcould be\b[^.]*(?:,|\/| or ).+(?:,|\/| or ))|(?:\b(?:options?|candidates?|possib(?:le|ilit\w+)|alternatives?)\b[^.]*(?:,| or ))/i;

const MALFORMED =
  /(?:[[\]{}<>]{2,})|(?:\bundefined\b)|(?:\bnull\b)|(?:\[object )|(?:^\s*[{[])|(?:\bTODO\b)|(?:\bTBD\b)/i;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "for",
  "and",
  "or",
  "in",
  "on",
  "at",
  "as",
  "by",
  "it",
  "this",
  "that",
  "with",
]);

export type PropositionValidation = {
  ok: boolean;
  reasons: string[];
};

export type PropositionKind = "claim" | "proposal" | "evidence" | "issue";

export function tokenizeProposition(text: string): string[] {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));
}

export function propositionKey(text: string): string {
  return tokenizeProposition(text).join(" ");
}

export function jaccardTokens(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

export function isParaphrase(a: string, b: string): boolean {
  const keyA = propositionKey(a);
  const keyB = propositionKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  const tokensA = tokenizeProposition(a);
  const tokensB = tokenizeProposition(b);
  if (tokensA.length < 2 || tokensB.length < 2) return false;
  const jaccard = jaccardTokens(tokensA, tokensB);
  const lengthRatio =
    Math.min(tokensA.length, tokensB.length) /
    Math.max(tokensA.length, tokensB.length);
  return jaccard >= 0.85 && lengthRatio >= 0.7;
}

function letterRatio(text: string): number {
  const trimmed = text.replace(/\s+/g, "");
  if (trimmed.length === 0) return 0;
  const letters = trimmed.replace(/[^A-Za-z0-9=]/g, "").length;
  return letters / trimmed.length;
}

function looksLikeAlternativeList(text: string): boolean {
  if (ALTERNATIVE_LIST.test(text)) return true;
  const fills = text.match(/\b[A-Z]{2,20}\b/g) ?? [];
  if (fills.length >= 3 && /\b(?:or|\/|,)\b/.test(text)) return true;
  const clauses = text
    .split(/\s*(?:,|;|\/|\bor\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return clauses.length >= 3 && clauses.every((part) => part.length <= 40);
}

function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.includes("?")) return false;
  if (/=/.test(trimmed)) return false;
  if (QUESTION_ONLY.test(trimmed)) return true;
  return /\?\s*$/.test(trimmed) && !/[.]/.test(trimmed.replace(/\?$/, ""));
}

function looksLikeProcessNarration(text: string): boolean {
  return PROCESS_NARRATION.test(text.trim());
}

function looksMalformed(text: string): boolean {
  if (MALFORMED.test(text)) return true;
  const opens = (text.match(/[({[]/g) ?? []).length;
  const closes = (text.match(/[)}\]]/g) ?? []).length;
  if (opens !== closes && opens + closes >= 2) return true;
  return letterRatio(text) < 0.45;
}

/**
 * Structural/semantic checks that do not require an LLM.
 * Issues may be questions; claims, proposals, and evidence may not.
 */
export function validateCommittedProposition(
  text: string,
  kind: PropositionKind,
): PropositionValidation {
  const reasons: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, reasons: ["empty proposition"] };
  }
  if (trimmed.length > 2000) {
    reasons.push("proposition exceeds the text cap");
  }
  if (kind !== "issue") {
    if (looksLikeQuestion(trimmed)) {
      reasons.push("not a committed proposition (question only)");
    }
    if (looksLikeProcessNarration(trimmed)) {
      reasons.push("vague process narration rather than a committed idea");
    }
    if (looksLikeAlternativeList(trimmed)) {
      reasons.push("list of alternatives rather than one committed idea");
    }
    if (looksMalformed(trimmed)) {
      reasons.push("malformed or non-propositional text");
    }
    const tokens = tokenizeProposition(trimmed);
    if (kind !== "evidence" && tokens.length === 0) {
      reasons.push("not syntactically interpretable as a proposition");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

export function validateCommitConfidence(
  confidence: number | undefined,
): PropositionValidation {
  if (confidence === undefined) return { ok: true, reasons: [] };
  if (confidence < MIN_COMMIT_CONFIDENCE) {
    return {
      ok: false,
      reasons: [
        `confidence ${confidence} is below the commit threshold ${MIN_COMMIT_CONFIDENCE}; omit the move rather than recording a weak candidate`,
      ],
    };
  }
  return { ok: true, reasons: [] };
}

export function findParaphraseId(
  nodes: Iterable<ReasoningNode>,
  type: AtomicReasoningNodeType,
  text: string,
  subjectId: string | undefined,
  ignoreId?: string,
): string | undefined {
  if (type !== "claim" && type !== "proposal") return undefined;
  for (const node of nodes) {
    if (ignoreId && node.id === ignoreId) continue;
    if (node.status === "superseded" || node.status === "rejected") continue;
    if (node.type !== "claim" && node.type !== "proposal") continue;
    if (node.subjectId !== subjectId) continue;
    if (isParaphrase(node.text, text)) return node.id;
  }
  return undefined;
}

export function isCandidateType(
  type: AtomicReasoningNodeType | string | undefined,
): type is "claim" | "proposal" {
  return type === "claim" || type === "proposal";
}
