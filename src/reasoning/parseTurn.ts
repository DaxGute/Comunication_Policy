import type { AgentId } from "../agents/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import type { TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import { parseBasisField } from "./provenance";
import { parseFinalBasisField } from "./finalBasis";
import type {
  ParsedAgentTurn,
  ParsedMutation,
  ReasoningGraph,
  ReasoningMutation,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function extractJsonCandidate(text: string): string | undefined {
  const stripped = stripFence(text);
  if (stripped.startsWith("{") && stripped.endsWith("}")) return stripped;
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return stripped.slice(first, last + 1);
  }
  return undefined;
}

function tryParseJson(text: string): unknown | undefined {
  const candidate = extractJsonCandidate(text);
  if (!candidate) return undefined;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

function arrayField(parsed: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (parsed[key] !== undefined) return parsed[key];
  }
  return undefined;
}

function mutationType(raw: unknown): "SET" | "REVISE" | "REMOVE" | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  if (upper === "SET" || upper === "REVISE" || upper === "REMOVE") return upper;
  return undefined;
}

function optionalBasis(raw: Record<string, unknown>): string[] | undefined {
  const parsed = parseBasisField(
    raw.basis ?? raw.basisVersionIds ?? raw.derivedFrom ?? raw.derived_from ?? raw.references,
  );
  return parsed.length > 0 ? parsed : undefined;
}

function optionalSourceInformationIds(
  raw: Record<string, unknown>,
): string[] | undefined {
  const value =
    raw.sourceInformationIds ??
    raw.source_information_ids ??
    raw.sourceInformationUnitIds ??
    raw.source_ids;
  if (!Array.isArray(value)) return undefined;
  const ids = [
    ...new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return ids.length > 0 ? ids : undefined;
}

/**
 * Parse one array element into a mutation. Unknown shapes become invalid
 * sentinels so the engine can reject them instead of dropping them.
 */
export function parseReasoningMutation(
  raw: unknown,
): ReasoningMutation | { type: "invalid"; raw: unknown } {
  if (!isRecord(raw)) return { type: "invalid", raw };
  const type = mutationType(raw.type ?? raw.action ?? raw.kind);
  const subjectId = asString(
    raw.subjectId ?? raw.subject_id ?? raw.subject,
  )?.trim();
  if (!type || !subjectId) return { type: "invalid", raw };

  if (type === "SET") {
    const content = asString(raw.content ?? raw.after ?? raw.value ?? raw.text);
    if (content === undefined) return { type: "invalid", raw };
    const subjectLabel = asString(raw.subjectLabel ?? raw.subject_label ?? raw.label);
    const basis = optionalBasis(raw);
    const sourceInformationIds = optionalSourceInformationIds(raw);
    return {
      type: "SET",
      subjectId,
      content,
      ...(subjectLabel?.trim() ? { subjectLabel: subjectLabel.trim() } : {}),
      ...(basis ? { basis } : {}),
      ...(sourceInformationIds ? { sourceInformationIds } : {}),
    };
  }
  if (type === "REVISE") {
    const fromVersionId = asString(
      raw.fromVersionId ?? raw.from_version_id,
    )?.trim();
    const before = asString(raw.before);
    const after = asString(raw.after ?? raw.to ?? raw.content ?? raw.value ?? raw.text);
    if (after === undefined) return { type: "invalid", raw };
    if (!fromVersionId && before === undefined) return { type: "invalid", raw };
    const basis = optionalBasis(raw);
    const sourceInformationIds = optionalSourceInformationIds(raw);
    return {
      type: "REVISE",
      subjectId,
      after,
      ...(fromVersionId ? { fromVersionId } : {}),
      ...(before !== undefined ? { before } : {}),
      ...(basis ? { basis } : {}),
      ...(sourceInformationIds ? { sourceInformationIds } : {}),
    };
  }
  const before = asString(raw.before ?? raw.content ?? raw.value ?? raw.text);
  if (before === undefined) return { type: "invalid", raw };
  return { type: "REMOVE", subjectId, before };
}

function parseMutationList(raw: unknown): {
  mutations: ParsedMutation[];
  invalidCount: number;
  error?: string;
} {
  if (raw === undefined || raw === null) {
    return { mutations: [], invalidCount: 0 };
  }
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : undefined;
  if (!list) {
    return {
      mutations: [],
      invalidCount: 0,
      error: "mutations is not an array",
    };
  }
  const mutations: ParsedMutation[] = [];
  let invalidCount = 0;
  for (const item of list) {
    const parsed = parseReasoningMutation(item);
    if (parsed.type === "invalid") invalidCount += 1;
    mutations.push(parsed);
  }
  return { mutations, invalidCount };
}

function parseFinalAnswerText(raw: unknown, message: string): string | undefined {
  const fromText = extractFinalAnswerFromText(message);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (isRecord(raw)) {
    const text = asString(raw.text)?.trim();
    if (text) return text;
  }
  return fromText;
}

function parseReadyToFinalize(parsed: Record<string, unknown>): boolean | undefined {
  if (parsed.readyToFinalize === true || parsed.ready_to_finalize === true) {
    return true;
  }
  if (parsed.readyToFinalize === false || parsed.ready_to_finalize === false) {
    return false;
  }
  const convergence = parsed.convergence;
  if (isRecord(convergence)) {
    if (convergence.ready === true) return true;
    if (convergence.ready === false) return false;
  }
  return undefined;
}

function parseFocusSubjectIds(parsed: Record<string, unknown>): string[] | undefined {
  const raw = parsed.focusSubjectIds ?? parsed.focus_subject_ids;
  if (!Array.isArray(raw)) return undefined;
  const ids = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function parseTextEnvelope(raw: string): { message?: string; mutationsRaw?: unknown } {
  const messageMatch = raw.match(/MESSAGE:\s*\n?([\s\S]*?)(?:\n\s*MUTATIONS:|$)/i);
  const mutationsMatch = raw.match(/MUTATIONS:\s*\n?([\s\S]*)$/i);
  if (!messageMatch && !mutationsMatch) return {};
  let mutationsRaw: unknown;
  if (mutationsMatch) {
    const body = mutationsMatch[1]!.trim();
    if (body && body !== "[]" && body.toLowerCase() !== "none") {
      mutationsRaw = tryParseJson(body) ?? body;
    } else {
      mutationsRaw = [];
    }
  }
  return {
    message: messageMatch?.[1]?.trim(),
    mutationsRaw,
  };
}

/**
 * Split a model turn into the conversational utterance and structured
 * mutations. Non-JSON output becomes the natural-language message plus a
 * protocol failure unless a MESSAGE/MUTATIONS envelope is present.
 */
export function parseAgentTurn(
  raw: string,
  _actor: AgentId,
  _turn: number,
): ParsedAgentTurn {
  const parsed = tryParseJson(raw);
  if (isRecord(parsed) && typeof parsed.message === "string") {
    const mutationsRaw = arrayField(parsed, [
      "mutations",
      "reasoningMutations",
      "reasoning_mutations",
    ]);
    const listed = parseMutationList(mutationsRaw);
    const finalBasis = parseFinalBasisField(
      parsed.finalBasis ??
        parsed.final_basis ??
        parsed.finalBasisVersionIds ??
        parsed.final_basis_version_ids,
    );
    const finalSourceInformationIds = optionalSourceInformationIds(parsed);
    return {
      message: parsed.message,
      mutations: listed.mutations,
      protocolFailure: listed.error,
      finalAnswerText: parseFinalAnswerText(
        parsed.finalAnswer ?? parsed.final_answer,
        parsed.message,
      ),
      finalBasisRefs: finalBasis.declared ? finalBasis.refs : undefined,
      finalBasisDeclared: finalBasis.declared,
      ...(finalSourceInformationIds
        ? { finalSourceInformationIds }
        : {}),
      nothingToAdd:
        parsed.nothingToAdd === true || parsed.nothing_to_add === true
          ? true
          : undefined,
      readyToFinalize: parseReadyToFinalize(parsed),
      focusSubjectIds: parseFocusSubjectIds(parsed),
      raw,
      parsedAsJson: true,
      structuredReasoningMissing:
        listed.mutations.filter((item) => item.type !== "invalid").length === 0 &&
        listed.invalidCount > 0,

    };
  }

  const envelope = parseTextEnvelope(raw);
  if (envelope.message !== undefined) {
    const listed = parseMutationList(envelope.mutationsRaw);
    return {
      message: envelope.message,
      mutations: listed.mutations,
      protocolFailure: listed.error,
      finalAnswerText: parseFinalAnswerText(undefined, envelope.message),
      raw,
      parsedAsJson: false,
      normalizedFromMalformedShape: true,
    };
  }

  return {
    message: raw,
    mutations: [],
    protocolFailure: isRecord(parsed)
      ? "JSON object is missing a string \"message\" field"
      : "turn did not provide valid JSON reasoning mutations",
    finalAnswerText: parseFinalAnswerText(undefined, raw),
    raw,
    parsedAsJson: false,
  };
}

export type RecoverTurnContext = {
  problem: Problem;
  adapter: TaskReasoningAdapter;
  graph: ReasoningGraph;
};

/**
 * Recover a parsed turn without inventing mutations from prose.
 * Crossword fill extraction is intentionally not applied here: the speaker
 * must commit SET/REVISE/REMOVE itself.
 *
 * A valid empty mutation list is not a protocol failure, even when the
 * message looks like it contains deductions. Persistence review is an
 * inspector diagnostic, not a rejected graph event.
 */
export function recoverParsedTurn(
  parsed: ParsedAgentTurn,
  _ctx: RecoverTurnContext,
): ParsedAgentTurn {
  return parsed;
}
