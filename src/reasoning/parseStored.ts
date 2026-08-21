import type { AgentId } from "../agents/types";
import { parseReasoningMutation } from "./parseTurn";
import {
  REASONING_SCHEMA_VERSION,
  type PropositionVersion,
  type PropositionVersionStatus,
  type ReasoningActor,
  type ReasoningEvent,
  type ReasoningGraph,
  type ReasoningMutation,
  type ReasoningSubject,
  type ReasoningSubjectSource,
  type StoredReasoningMutation,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentId(value: unknown): value is AgentId {
  return value === "agent_a" || value === "agent_b";
}

function isReasoningActor(value: unknown): value is ReasoningActor {
  return isAgentId(value) || value === "system";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mutationType(raw: unknown): "SET" | "REVISE" | "REMOVE" | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.trim().toUpperCase();
  if (upper === "SET" || upper === "REVISE" || upper === "REMOVE") return upper;
  return undefined;
}

export function looksLikeLegacyDenseEvent(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.operation)) return false;
  const type = raw.operation.type;
  return (
    typeof type === "string" &&
    [
      "create",
      "support",
      "challenge",
      "accept",
      "reject",
      "revise",
      "pass",
      "invalid",
      "protocol_failure",
      "final_answer",
    ].includes(type)
  );
}

export function looksLikeCanonicalMutationEvent(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  if (isRecord(raw.mutation) && mutationType(raw.mutation.type)) return true;
  if (mutationType(raw.action) && !raw.operation) return true;
  if (mutationType(raw.type) && (raw.subjectId || raw.subject)) return true;
  return false;
}

export function detectReasoningSchema(raw: {
  reasoningSchemaVersion?: unknown;
  reasoningEvents?: unknown;
}): 1 | 2 | undefined {
  if (raw.reasoningSchemaVersion === 1) return 1;
  if (raw.reasoningSchemaVersion === 2) return 2;
  const events = Array.isArray(raw.reasoningEvents) ? raw.reasoningEvents : [];
  if (events.length === 0) {
    return raw.reasoningSchemaVersion === undefined ? undefined : 2;
  }
  if (events.some(looksLikeCanonicalMutationEvent)) return 2;
  if (events.some(looksLikeLegacyDenseEvent)) return 1;
  return undefined;
}

export function parseReasoningSubject(
  raw: unknown,
): ReasoningSubject | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !raw.id.trim()) return undefined;
  const source: ReasoningSubjectSource =
    raw.source === "agent" ? "agent" : "task";
  return {
    id: raw.id,
    label: typeof raw.label === "string" ? raw.label : undefined,
    kind:
      raw.kind === "agent_defined" || raw.kind === "task_defined"
        ? raw.kind
        : undefined,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    description:
      typeof raw.description === "string" ? raw.description : undefined,
    source,
    createdAtTurn:
      typeof raw.createdAtTurn === "number" && Number.isFinite(raw.createdAtTurn)
        ? Math.max(0, Math.round(raw.createdAtTurn))
        : undefined,
    createdBy: isReasoningActor(raw.createdBy) ? raw.createdBy : undefined,
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  };
}

function parseStatus(value: unknown): PropositionVersionStatus | undefined {
  return value === "active" || value === "superseded" || value === "removed"
    ? value
    : undefined;
}

export function parsePropositionVersion(
  raw: unknown,
): PropositionVersion | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !raw.id.trim()) return undefined;
  if (typeof raw.subjectId !== "string" || !raw.subjectId.trim()) return undefined;
  if (typeof raw.content !== "string") return undefined;
  if (!isAgentId(raw.agentId)) return undefined;
  if (typeof raw.turn !== "number" || !Number.isFinite(raw.turn)) return undefined;
  const status = parseStatus(raw.status);
  if (!status) return undefined;
  return {
    id: raw.id,
    subjectId: raw.subjectId,
    content: raw.content,
    agentId: raw.agentId,
    turn: Math.max(0, Math.round(raw.turn)),
    previousVersionId:
      typeof raw.previousVersionId === "string" ? raw.previousVersionId : undefined,
    sourceUtteranceTurn:
      typeof raw.sourceUtteranceTurn === "number" &&
      Number.isFinite(raw.sourceUtteranceTurn)
        ? Math.max(0, Math.round(raw.sourceUtteranceTurn))
        : Math.max(0, Math.round(raw.turn)),
    sourceMessageId:
      typeof raw.sourceMessageId === "string" ? raw.sourceMessageId : undefined,
    status,
    ...(Array.isArray(raw.derivedFromVersionIds) &&
    raw.derivedFromVersionIds.every((item) => typeof item === "string")
      ? {
          derivedFromVersionIds: [
            ...new Set(raw.derivedFromVersionIds as string[]),
          ],
        }
      : {}),
    ...(Array.isArray(raw.sourceInformationIds) &&
    raw.sourceInformationIds.every((item) => typeof item === "string")
      ? {
          sourceInformationIds: [
            ...new Set(raw.sourceInformationIds as string[]),
          ],
        }
      : {}),
  };
}

function parseStoredMutation(raw: unknown): StoredReasoningMutation | undefined {
  if (!isRecord(raw)) return undefined;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  if (type === "protocol_failure") {
    return {
      type: "protocol_failure",
      reason: typeof raw.reason === "string" ? raw.reason : "protocol failure",
    };
  }
  if (type === "final_answer") {
    return {
      type: "final_answer",
      text: typeof raw.text === "string" ? raw.text : undefined,
    };
  }
  if (type === "invalid") {
    return { type: "invalid", raw: raw.raw };
  }
  const parsed = parseReasoningMutation(raw);
  if (parsed.type === "invalid") return { type: "invalid", raw: parsed.raw ?? raw };
  return parsed;
}

function mutationFromAug19(raw: Record<string, unknown>): StoredReasoningMutation | undefined {
  const action = mutationType(raw.action ?? raw.type);
  if (!action) {
    if (raw.accepted === false && typeof raw.reason === "string") {
      return { type: "protocol_failure", reason: raw.reason };
    }
    return undefined;
  }
  const parsed = parseReasoningMutation({
    type: action,
    subjectId: raw.subjectId ?? raw.subject,
    subjectLabel: raw.subjectLabel,
    content: raw.after ?? raw.content,
    before: raw.before,
    after: raw.after,
    basis: raw.basis ?? raw.basisVersionIds,
  });
  return parsed.type === "invalid" ? undefined : parsed;
}

/**
 * Parse a persisted event. Accepts canonical v2 records and Aug 19
 * `{ action: SET|REVISE|REMOVE, subjectId, before, after }` records.
 * Dense-graph `operation` events return undefined (not converted).
 */
export function parseReasoningEvent(raw: unknown): ReasoningEvent | undefined {
  if (!isRecord(raw)) return undefined;
  if (looksLikeLegacyDenseEvent(raw) && !looksLikeCanonicalMutationEvent(raw)) {
    return undefined;
  }

  const mutation =
    parseStoredMutation(raw.mutation) ?? mutationFromAug19(raw);
  if (!mutation) return undefined;

  const actorRaw = raw.actor ?? raw.agent;
  if (!isReasoningActor(actorRaw)) return undefined;
  const turnRaw = raw.turnIndex ?? raw.turn;
  if (typeof turnRaw !== "number" || !Number.isFinite(turnRaw)) return undefined;

  const id =
    typeof raw.id === "string" && raw.id.trim()
      ? raw.id
      : `re-${Math.max(0, Math.round(turnRaw))}`;
  const messageId =
    typeof raw.messageId === "string"
      ? raw.messageId
      : `legacy-turn-${Math.max(0, Math.round(turnRaw))}`;

  return {
    id,
    seq:
      typeof raw.seq === "number" && Number.isFinite(raw.seq)
        ? Math.max(0, Math.round(raw.seq))
        : 0,
    turnIndex: Math.max(0, Math.round(turnRaw)),
    messageId,
    actor: actorRaw,
    mutation,
    accepted: raw.accepted !== false,
    errors: asStringArray(raw.errors),
    diagnostics:
      Array.isArray(raw.diagnostics) && raw.diagnostics.length > 0
        ? asStringArray(raw.diagnostics)
        : undefined,
    ...(raw.stateChanged === false ? { stateChanged: false as const } : {}),
    reason: typeof raw.reason === "string" ? raw.reason : undefined,
    versionId: typeof raw.versionId === "string" ? raw.versionId : undefined,
    previousVersionId:
      typeof raw.previousVersionId === "string" ? raw.previousVersionId : undefined,
    ...(Array.isArray(raw.basisVersionIds) &&
    raw.basisVersionIds.every((item) => typeof item === "string")
      ? { basisVersionIds: [...new Set(raw.basisVersionIds as string[])] }
      : {}),
    ...(Array.isArray(raw.sourceInformationIds) &&
    raw.sourceInformationIds.every((item) => typeof item === "string")
      ? {
          sourceInformationIds: [
            ...new Set(raw.sourceInformationIds as string[]),
          ],
        }
      : {}),
  };
}

export function parseReasoningGraph(raw: {
  reasoningSchemaVersion?: unknown;
  reasoningSubjects?: unknown;
  reasoningVersions?: unknown;
  reasoningEvents?: unknown;
}): ReasoningGraph | undefined {
  const schema = detectReasoningSchema(raw);
  if (schema === 1) {
    return {
      schemaVersion: 1,
      subjects: [],
      versions: [],
      events: [],
    };
  }
  const subjectsRaw = Array.isArray(raw.reasoningSubjects)
    ? raw.reasoningSubjects
    : undefined;
  const versionsRaw = Array.isArray(raw.reasoningVersions)
    ? raw.reasoningVersions
    : undefined;
  const eventsRaw = Array.isArray(raw.reasoningEvents)
    ? raw.reasoningEvents
    : undefined;
  if (!subjectsRaw && !versionsRaw && !eventsRaw) return undefined;
  const events = (eventsRaw ?? [])
    .map(parseReasoningEvent)
    .filter((event): event is ReasoningEvent => Boolean(event));
  return {
    schemaVersion: REASONING_SCHEMA_VERSION,
    subjects: (subjectsRaw ?? [])
      .map(parseReasoningSubject)
      .filter((subject): subject is ReasoningSubject => Boolean(subject)),
    versions: (versionsRaw ?? [])
      .map(parsePropositionVersion)
      .filter((version): version is PropositionVersion => Boolean(version)),
    events,
  };
}

export function parseReasoningMutationRecord(
  raw: unknown,
): ReasoningMutation | undefined {
  const parsed = parseReasoningMutation(raw);
  return parsed.type === "invalid" ? undefined : parsed;
}
