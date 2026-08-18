import type { AgentId } from "../agents/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import type { TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import { compileReasoningMoves } from "./compile";
import { looksLikeMoveRecord, normalizeReasoningMove } from "./normalize";
import {
  REASONING_INTENT_ACTIONS,
  type ParsedAgentTurn,
  type ReasoningGraph,
  type ReasoningIntent,
  type ReasoningIntentAction,
  type ReasoningMove,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
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

function isIntentAction(value: unknown): value is ReasoningIntentAction {
  return (
    typeof value === "string" &&
    (REASONING_INTENT_ACTIONS as readonly string[]).includes(value)
  );
}

const CREATE_ACTION_ALIASES: Record<string, string> = {
  propose: "proposal",
  proposal: "proposal",
  claim: "claim",
  issue: "issue",
  evidence: "evidence",
};

function liftLegacyCreate(raw: Record<string, unknown>): ReasoningIntent | undefined {
  if (!isRecord(raw.node)) return undefined;
  const node = raw.node;
  return {
    action: "create",
    nodeType: asString(node.nodeType) ?? asString(node.type),
    text: asString(node.text),
    confidence: asNumber(node.confidence),
    parents: asStringArray(node.parents),
    dependencies: asStringArray(node.dependencies),
    subjectId: asString(node.subjectId ?? node.subject_id ?? node.subject),
    localId: asString(node.localId) ?? asString(raw.localId),
    metadata: isRecord(node.metadata) ? node.metadata : undefined,
    groundsNodeIds: asStringArray(node.groundsNodeIds ?? raw.groundsNodeIds),
    supportsNodeIds: asStringArray(node.supportsNodeIds ?? raw.supportsNodeIds),
    basis: asStringArray(node.basis ?? raw.basis),
  };
}

function liftLegacyRevise(raw: Record<string, unknown>): ReasoningIntent | undefined {
  const replacement = isRecord(raw.replacement) ? raw.replacement : undefined;
  return {
    action: "revise",
    targetId: asString(raw.targetId ?? raw.claim),
    nodeType: replacement
      ? (asString(replacement.nodeType) ?? asString(replacement.type))
      : asString(raw.nodeType),
    text: replacement ? asString(replacement.text) : asString(raw.text ?? raw.value),
    confidence: replacement
      ? asNumber(replacement.confidence)
      : asNumber(raw.confidence),
    parents: asStringArray(replacement?.parents ?? raw.parents),
    dependencies: asStringArray(replacement?.dependencies ?? raw.dependencies),
    subjectId: asString(
      replacement?.subjectId ??
        replacement?.subject_id ??
        replacement?.subject ??
        raw.subjectId ??
        raw.subject_id ??
        raw.subject,
    ),
    reason: asString(raw.reason),
    localId: asString(raw.localId),
    groundsNodeIds: asStringArray(raw.groundsNodeIds),
    supportsNodeIds: asStringArray(raw.supportsNodeIds),
    basis: asStringArray(raw.basis),
  };
}

/**
 * Parse one array element into an intent. Never returns undefined: unknown
 * shapes become `{ action: "invalid" }` so the engine can reject them.
 */
export function parseReasoningIntent(raw: unknown): ReasoningIntent {
  if (!isRecord(raw)) {
    return { action: "invalid", raw };
  }

  const suppliedAction = asString(raw.action) ?? asString(raw.type);
  const aliasNodeType = suppliedAction
    ? CREATE_ACTION_ALIASES[suppliedAction.toLowerCase()]
    : undefined;
  let actionRaw = aliasNodeType ? "create" : suppliedAction;
  if (actionRaw === "agree") actionRaw = "accept";
  if (actionRaw === "disagree") actionRaw = "challenge";
  if (actionRaw === "create" && isRecord(raw.node)) {
    return liftLegacyCreate(raw) ?? { action: "invalid", raw };
  }
  if (actionRaw === "revise" && (isRecord(raw.replacement) || asString(raw.targetId))) {
    if (isRecord(raw.replacement) || !asString(raw.text ?? raw.value)) {
      return liftLegacyRevise(raw) ?? { action: "invalid", raw };
    }
  }

  if (!actionRaw || !isIntentAction(actionRaw) || actionRaw === "invalid") {
    return { action: "invalid", raw };
  }
  if (actionRaw === "protocol_failure") {
    return {
      action: "protocol_failure",
      reason: asString(raw.reason)?.trim() || "protocol failure",
    };
  }
  if (actionRaw === "final_answer") {
    return {
      action: "final_answer",
      text: asString(raw.text),
      supportingNodeIds: asStringArray(raw.supportingNodeIds) ?? [],
    };
  }
  if (actionRaw === "create") {
    return {
      action: "create",
      nodeType: asString(raw.nodeType) ?? aliasNodeType,
      text: asString(raw.text ?? raw.value),
      confidence: asNumber(raw.confidence),
      parents: asStringArray(raw.parents),
      dependencies: asStringArray(raw.dependencies),
      subjectId: asString(raw.subjectId ?? raw.subject_id ?? raw.subject),
      localId: asString(raw.localId),
      metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
      groundsNodeIds: asStringArray(raw.groundsNodeIds),
      supportsNodeIds: asStringArray(raw.supportsNodeIds),
      basis: asStringArray(raw.basis),
    };
  }
  if (actionRaw === "revise") {
    return {
      action: "revise",
      targetId: asString(raw.targetId ?? raw.claim),
      nodeType: asString(raw.nodeType),
      text: asString(raw.text ?? raw.value),
      confidence: asNumber(raw.confidence),
      parents: asStringArray(raw.parents),
      dependencies: asStringArray(raw.dependencies),
      subjectId: asString(raw.subjectId ?? raw.subject_id ?? raw.subject),
      selector:
        asString(raw.selector) === "previous"
          ? "previous"
          : asString(raw.selector) === "current"
            ? "current"
            : undefined,
      reason: asString(raw.reason),
      localId: asString(raw.localId),
      groundsNodeIds: asStringArray(raw.groundsNodeIds),
      supportsNodeIds: asStringArray(raw.supportsNodeIds),
      basis: asStringArray(raw.basis),
    };
  }
  return {
    action: actionRaw,
    sourceNodeId: asString(raw.sourceNodeId ?? raw.source_node_id ?? raw.source),
    targetNodeId: asString(raw.targetNodeId ?? raw.target_node_id),
    targetId: asString(raw.targetId ?? raw.claim ?? raw.target),
    subjectId: asString(raw.subjectId ?? raw.subject_id ?? raw.subject),
    selector:
      asString(raw.selector) === "previous"
        ? "previous"
        : asString(raw.selector) === "current"
          ? "current"
          : undefined,
    reason: asString(raw.reason),
  };
}

function isLegacyIntentRecord(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const action = asString(raw.action) ?? asString(raw.type);
  if (!action) return false;
  if (CREATE_ACTION_ALIASES[action.toLowerCase()]) return true;
  return isIntentAction(action) || action === "agree" || action === "disagree";
}

function parseFinalAnswerSupport(
  raw: unknown,
  message: string,
): ParsedAgentTurn["finalAnswerSupport"] {
  const fromText = extractFinalAnswerFromText(message);
  if (typeof raw === "string" && raw.trim()) {
    return {
      text: raw.trim(),
      supportingNodeIds: [],
    };
  }
  if (isRecord(raw)) {
    const text = asString(raw.text)?.trim() || fromText;
    const supportingNodeIds = asStringArray(
      raw.supportingNodeIds ?? raw.supporting_node_ids,
    ) ?? [];
    if (text || supportingNodeIds.length > 0) {
      return { text, supportingNodeIds };
    }
  }
  if (fromText) {
    return { text: fromText, supportingNodeIds: [] };
  }
  return undefined;
}

function arrayField(parsed: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (parsed[key] !== undefined) return parsed[key];
  }
  return undefined;
}

function parseMoveList(raw: unknown): {
  moves: ReasoningMove[];
  invalid: ReasoningIntent[];
  normalizedFromMalformedShape: boolean;
  error?: string;
} {
  if (raw === undefined || raw === null) {
    return { moves: [], invalid: [], normalizedFromMalformedShape: false };
  }
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : undefined;
  if (!list) {
    return {
      moves: [],
      invalid: [],
      normalizedFromMalformedShape: false,
      error: "moves is not an array",
    };
  }
  const moves: ReasoningMove[] = [];
  const invalid: ReasoningIntent[] = [];
  let normalizedFromMalformedShape = false;
  for (const item of list) {
    const normalized = normalizeReasoningMove(item);
    if (normalized.move) {
      moves.push(normalized.move);
      if (normalized.normalizedFromMalformedShape) normalizedFromMalformedShape = true;
    } else {
      invalid.push({ action: "invalid", raw: item });
    }
  }
  return { moves, invalid, normalizedFromMalformedShape };
}

/**
 * Split a model turn into the conversational utterance and structured
 * reasoning moves. Malformed array elements are kept as invalid intents.
 * Non-JSON output becomes the natural-language message plus a protocol failure.
 */
export function parseAgentTurn(
  raw: string,
  _actor: AgentId,
  _turn: number,
): ParsedAgentTurn {
  const parsed = tryParseJson(raw);
  if (!isRecord(parsed) || typeof parsed.message !== "string") {
    return {
      message: raw,
      moves: [],
      intents: [],
      protocolFailure: isRecord(parsed)
        ? "JSON object is missing a string \"message\" field"
        : "turn did not provide valid JSON reasoning intents",
      finalAnswerSupport: parseFinalAnswerSupport(undefined, raw),
      raw,
      parsedAsJson: false,
    };
  }

  const message = parsed.message;
  const movesRaw = arrayField(parsed, ["moves"]);
  const intentsRaw = arrayField(parsed, [
    "reasoningIntents",
    "reasoning_intents",
    "reasoningOperations",
    "reasoning_operations",
  ]);

  let protocolFailure: string | undefined;
  let moves: ReasoningMove[] = [];
  let intents: ReasoningIntent[] = [];
  let normalizedFromMalformedShape = false;

  const preferMoves =
    movesRaw !== undefined ||
    (Array.isArray(intentsRaw) &&
      intentsRaw.length > 0 &&
      intentsRaw.some((item) => looksLikeMoveRecord(item)) &&
      !intentsRaw.some((item) => isLegacyIntentRecord(item)));

  if (preferMoves) {
    const parsedMoves = parseMoveList(movesRaw ?? intentsRaw);
    moves = parsedMoves.moves;
    intents = parsedMoves.invalid;
    normalizedFromMalformedShape = parsedMoves.normalizedFromMalformedShape;
    if (parsedMoves.error) protocolFailure = parsedMoves.error;
  } else if (intentsRaw === undefined || intentsRaw === null) {
    intents = [];
  } else if (!Array.isArray(intentsRaw)) {
    protocolFailure = "reasoningIntents is not an array";
  } else {
    intents = intentsRaw.map((item) => parseReasoningIntent(item));
  }

  return {
    message,
    moves,
    intents,
    protocolFailure,
    finalAnswerSupport: parseFinalAnswerSupport(
      parsed.finalAnswer ?? parsed.final_answer,
      message,
    ),
    raw,
    parsedAsJson: true,
    normalizedFromMalformedShape,
  };
}

export type RecoverTurnContext = {
  problem: Problem;
  adapter: TaskReasoningAdapter;
  graph: ReasoningGraph;
};

/**
 * Resolve moves against the live graph, recover simple crossword fills, and
 * compile engine intents. Does not invent nuanced semantics.
 */
export function recoverParsedTurn(
  parsed: ParsedAgentTurn,
  ctx: RecoverTurnContext,
): ParsedAgentTurn {
  let moves = [...parsed.moves];
  let extractedFromMessage = parsed.extractedFromMessage ?? false;
  let structuredReasoningMissing = false;
  const diagnosticsIntents = [...parsed.intents];

  if (
    moves.length === 0 &&
    parsed.intents.every((intent) => intent.action === "invalid") &&
    ctx.adapter.extractMoves
  ) {
    const extracted = ctx.adapter.extractMoves(ctx.problem, parsed.message);
    if (extracted.length > 0) {
      moves = extracted;
      extractedFromMessage = true;
    }
  }

  if (
    moves.length === 0 &&
    parsed.intents.filter((intent) => intent.action !== "invalid").length === 0 &&
    ctx.adapter.messageLooksSubstantive?.(ctx.problem, parsed.message)
  ) {
    structuredReasoningMissing = true;
  }

  const compiled =
    moves.length > 0
      ? compileReasoningMoves(moves, ctx)
      : { intents: [], diagnostics: [] };

  const intents =
    compiled.intents.length > 0
      ? [...compiled.intents, ...diagnosticsIntents.filter((intent) => intent.action === "invalid")]
      : parsed.intents;

  return {
    ...parsed,
    moves,
    intents,
    extractedFromMessage,
    structuredReasoningMissing,
    normalizedFromMalformedShape: parsed.normalizedFromMalformedShape,
  };
}
