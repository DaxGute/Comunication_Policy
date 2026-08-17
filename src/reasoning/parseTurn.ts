import type { AgentId } from "../agents/types";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";
import {
  REASONING_INTENT_ACTIONS,
  type ParsedAgentTurn,
  type ReasoningIntent,
  type ReasoningIntentAction,
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
    subjectId: asString(node.subjectId ?? node.subject_id),
    localId: asString(node.localId) ?? asString(raw.localId),
  };
}

function liftLegacyRevise(raw: Record<string, unknown>): ReasoningIntent | undefined {
  const replacement = isRecord(raw.replacement) ? raw.replacement : undefined;
  return {
    action: "revise",
    targetId: asString(raw.targetId),
    nodeType: replacement
      ? (asString(replacement.nodeType) ?? asString(replacement.type))
      : asString(raw.nodeType),
    text: replacement ? asString(replacement.text) : asString(raw.text),
    confidence: replacement
      ? asNumber(replacement.confidence)
      : asNumber(raw.confidence),
    parents: asStringArray(replacement?.parents ?? raw.parents),
    dependencies: asStringArray(replacement?.dependencies ?? raw.dependencies),
    subjectId: asString(
      replacement?.subjectId ??
        replacement?.subject_id ??
        raw.subjectId ??
        raw.subject_id,
    ),
    reason: asString(raw.reason),
    localId: asString(raw.localId),
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
  const actionRaw = aliasNodeType ? "create" : suppliedAction;
  if (actionRaw === "create" && isRecord(raw.node)) {
    return liftLegacyCreate(raw) ?? { action: "invalid", raw };
  }
  if (actionRaw === "revise" && (isRecord(raw.replacement) || asString(raw.targetId))) {
    if (isRecord(raw.replacement) || !asString(raw.text)) {
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
      text: asString(raw.text),
      confidence: asNumber(raw.confidence),
      parents: asStringArray(raw.parents),
      dependencies: asStringArray(raw.dependencies),
      subjectId: asString(raw.subjectId ?? raw.subject_id),
      localId: asString(raw.localId),
    };
  }
  if (actionRaw === "revise") {
    return {
      action: "revise",
      targetId: asString(raw.targetId),
      nodeType: asString(raw.nodeType),
      text: asString(raw.text),
      confidence: asNumber(raw.confidence),
      parents: asStringArray(raw.parents),
      dependencies: asStringArray(raw.dependencies),
      subjectId: asString(raw.subjectId ?? raw.subject_id),
      reason: asString(raw.reason),
      localId: asString(raw.localId),
    };
  }
  return {
    action: actionRaw,
    sourceNodeId: asString(raw.sourceNodeId ?? raw.source_node_id),
    targetNodeId: asString(raw.targetNodeId ?? raw.target_node_id),
    targetId: asString(raw.targetId),
    reason: asString(raw.reason),
  };
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

/**
 * Split a model turn into the conversational utterance and structured
 * reasoning intents. Malformed array elements are kept as invalid intents.
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
  const intentsRaw =
    parsed.reasoningIntents ??
    parsed.reasoning_intents ??
    parsed.reasoningOperations ??
    parsed.reasoning_operations;

  let protocolFailure: string | undefined;
  let intents: ReasoningIntent[] = [];
  if (intentsRaw === undefined || intentsRaw === null) {
    intents = [];
  } else if (!Array.isArray(intentsRaw)) {
    protocolFailure = "reasoningIntents is not an array";
  } else {
    intents = intentsRaw.map((item) => parseReasoningIntent(item));
  }

  return {
    message,
    intents,
    protocolFailure,
    finalAnswerSupport: parseFinalAnswerSupport(
      parsed.finalAnswer ?? parsed.final_answer,
      message,
    ),
    raw,
    parsedAsJson: true,
  };
}
