/**
 * Canonical versioned-state engine: SET / REVISE / REMOVE.
 *
 * Events are the source of truth. Replay from empty state reconstructs the
 * graph. Rejected mutations are logged and never applied.
 */
import type { AgentId } from "../agents/types";
import {
  detectReasoningSchema,
  parsePropositionVersion,
  parseReasoningEvent,
  parseReasoningSubject,
} from "./parseStored";
import { resolveAndValidateBasis } from "./provenance";
import { resolveKnownSubjectId } from "./subjectRef";
import {
  REASONING_SCHEMA_VERSION,
  activeVersion,
  isStateChangeMutation,
  mutationBasis,
  mutationSourceInformationIds,
  mutationSubjectId,
  normalizePropositionContent,
  type ParsedAgentTurn,
  type ParsedMutation,
  type PropositionVersion,
  type ReasoningActor,
  type ReasoningEvent,
  type ReasoningGraph,
  type ReasoningMutation,
  type ReasoningSubject,
  type StoredReasoningMutation,
} from "./types";
import { isForbiddenMoralSubject } from "./moralOntology";

const MAX_MUTATIONS_PER_TURN = 64;
const MAX_CONTENT_CHARS = 2000;
const MAX_SUBJECT_ID_CHARS = 80;
const SUBJECT_ID_PATTERN = /^[a-z][a-z0-9]*(?::[a-z0-9][a-z0-9_-]*)+$/;

export type ApplyMutationsContext = {
  actor: ReasoningActor;
  turnIndex: number;
  messageId: string;
  protocolFailure?: string;
  finalAnswerText?: string;
  extraDiagnostics?: string[];
  /**
   * Map a model-authored subject string onto a known id (crossword aliases).
   * Returning `{ error }` rejects the mutation.
   */
  resolveSubject?: (raw: string) => { id?: string; error?: string };
  /**
   * When true (crossword), SET cannot create subjects that were not seeded.
   */
  subjectsAreClosed?: boolean;
  /** Structural gate, e.g. crossword length / letters-only. */
  validateContent?: (
    subjectId: string,
    content: string,
  ) => { ok: boolean; reasons?: string[]; normalized?: string };
  /**
   * Information-unit ids visible to the speaking agent. When set, cited
   * sourceInformationIds outside this set are rejected (privacy).
   */
  allowedSourceInformationIds?: ReadonlySet<string> | readonly string[];
};

export type ApplyMutationsResult = {
  graph: ReasoningGraph;
  events: ReasoningEvent[];
};

type MutableGraph = {
  subjects: ReasoningSubject[];
  versions: Map<string, PropositionVersion>;
  events: ReasoningEvent[];
  finalAnswer?: ReasoningGraph["finalAnswer"];
};

function cloneSubject(subject: ReasoningSubject): ReasoningSubject {
  return {
    ...subject,
    metadata: subject.metadata ? { ...subject.metadata } : undefined,
  };
}

function cloneVersion(version: PropositionVersion): PropositionVersion {
  return {
    ...version,
    derivedFromVersionIds: version.derivedFromVersionIds
      ? [...version.derivedFromVersionIds]
      : undefined,
    sourceInformationIds: version.sourceInformationIds
      ? [...version.sourceInformationIds]
      : undefined,
  };
}

function cloneMutation(mutation: StoredReasoningMutation): StoredReasoningMutation {
  if (mutation.type === "SET" || mutation.type === "REVISE") {
    return {
      ...mutation,
      ...(mutation.basis ? { basis: [...mutation.basis] } : {}),
      ...(mutation.sourceInformationIds
        ? { sourceInformationIds: [...mutation.sourceInformationIds] }
        : {}),
    };
  }
  return { ...mutation };
}

function cloneEvent(event: ReasoningEvent): ReasoningEvent {
  return {
    ...event,
    mutation: event.mutation
      ? cloneMutation(event.mutation)
      : { type: "invalid" },
    errors: Array.isArray(event.errors) ? [...event.errors] : [],
    diagnostics: event.diagnostics ? [...event.diagnostics] : undefined,
    basisVersionIds: event.basisVersionIds ? [...event.basisVersionIds] : undefined,
  };
}

export function cloneReasoningGraph(graph: ReasoningGraph): ReasoningGraph {
  return {
    schemaVersion: graph.schemaVersion ?? REASONING_SCHEMA_VERSION,
    subjects: graph.subjects.map(cloneSubject),
    versions: graph.versions.map(cloneVersion),
    events: graph.events.map(cloneEvent),
    finalAnswer: graph.finalAnswer ? { ...graph.finalAnswer } : undefined,
  };
}

/** Drop retired dilemma-mirror / overall-answer subjects from live graphs.
 * Moral considerations that were historically task-seeded are rewritten as
 * agent-created using the first accepted version's author.
 */
function scrubForbiddenMoralGraph(graph: ReasoningGraph): ReasoningGraph {
  const subjects = graph.subjects
    .filter((subject) => !isForbiddenMoralSubject(subject))
    .map((subject) => {
      if (!subject.id.trim().toLowerCase().startsWith("moral:")) {
        return cloneSubject(subject);
      }
      if (subject.source === "agent" && subject.createdBy) {
        return cloneSubject(subject);
      }
      const first = [...graph.versions]
        .filter((version) => version.subjectId === subject.id)
        .sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id))[0];
      return {
        ...cloneSubject(subject),
        source: "agent" as const,
        kind: "agent_defined" as const,
        createdBy: subject.createdBy ?? first?.agentId ?? "agent_a",
        createdAtTurn: subject.createdAtTurn ?? first?.turn ?? 1,
        metadata: {
          ...(subject.metadata ?? {}),
          role: "consideration",
        },
      };
    });
  const keepIds = new Set(subjects.map((subject) => subject.id));
  const versions = graph.versions.filter(
    (version) =>
      keepIds.has(version.subjectId) &&
      !isForbiddenMoralSubject({ id: version.subjectId }),
  );
  const events = graph.events.filter((event) => {
    const subjectId = mutationSubjectId(event.mutation);
    return !subjectId || !isForbiddenMoralSubject({ id: subjectId });
  });
  return {
    ...graph,
    subjects,
    versions: versions.map(cloneVersion),
    events: events.map(cloneEvent),
  };
}

function toGraph(mutable: MutableGraph): ReasoningGraph {
  return scrubForbiddenMoralGraph({
    schemaVersion: REASONING_SCHEMA_VERSION,
    subjects: mutable.subjects.map(cloneSubject),
    versions: [...mutable.versions.values()].map(cloneVersion),
    events: mutable.events.map(cloneEvent),
    finalAnswer: mutable.finalAnswer ? { ...mutable.finalAnswer } : undefined,
  });
}

function nextVersionId(existing: Iterable<string>): string {
  const used = new Set(existing);
  let n = 1;
  while (used.has(`pv-${n}`)) n += 1;
  return `pv-${n}`;
}

function contentsEqual(a: string, b: string): boolean {
  return normalizePropositionContent(a) === normalizePropositionContent(b);
}

function canonicalizeAgainstValidator(
  subjectId: string,
  content: string,
  ctx: ApplyMutationsContext,
): string {
  const trimmed = sanitizeContent(content);
  if (!trimmed || ctx.actor === "system" || !ctx.validateContent) {
    return normalizePropositionContent(trimmed);
  }
  const validity = ctx.validateContent(subjectId, trimmed);
  if (validity.ok && validity.normalized) return validity.normalized;
  return normalizePropositionContent(trimmed);
}

function sanitizeContent(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_CONTENT_CHARS);
}

function normalizeSubjectId(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toLowerCase();
}

function isValidSubjectId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= MAX_SUBJECT_ID_CHARS &&
    SUBJECT_ID_PATTERN.test(id)
  );
}

function findSubject(
  subjects: ReasoningSubject[],
  id: string,
): ReasoningSubject | undefined {
  const needle = normalizeSubjectId(id);
  return subjects.find((subject) => normalizeSubjectId(subject.id) === needle);
}

function activeIn(
  versions: Map<string, PropositionVersion>,
  subjectId: string,
): PropositionVersion | undefined {
  for (const version of versions.values()) {
    if (version.subjectId === subjectId && version.status === "active") {
      return version;
    }
  }
  return undefined;
}

function resolveSubjectId(
  raw: string,
  mutable: MutableGraph,
  ctx: ApplyMutationsContext,
): { id?: string; error?: string; created?: boolean; label?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "subjectId is empty" };

  const knownIds = mutable.subjects.map((subject) => subject.id);
  const known = resolveKnownSubjectId(trimmed, knownIds);
  if (known.id) return { id: known.id, error: known.error };

  const labeled = mutable.subjects.find(
    (subject) =>
      (subject.label ?? "").trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (labeled) return { id: labeled.id };

  const adapted = ctx.resolveSubject?.(trimmed);
  if (adapted?.id) return { id: adapted.id };
  if (adapted?.error) return { error: adapted.error };

  if (ctx.subjectsAreClosed) {
    return { error: `subjectId references unknown issue ${trimmed}` };
  }

  const normalized = normalizeSubjectId(trimmed);
  if (!isValidSubjectId(normalized)) {
    return {
      error: `invalid subjectId "${trimmed}"; use a stable id such as moral:responsibility or decision:leading_option`,
    };
  }
  return { id: normalized, created: true, label: trimmed };
}

type ApplyOneResult = {
  accepted: boolean;
  stateChanged?: boolean;
  errors: string[];
  stored: StoredReasoningMutation;
  diagnostics?: string[];
  versionId?: string;
  previousVersionId?: string;
  basisVersionIds?: string[];
  sourceInformationIds?: string[];
};

function reject(
  stored: StoredReasoningMutation,
  errors: string[],
  diagnostics?: string[],
): ApplyOneResult {
  return {
    accepted: false,
    stateChanged: false,
    errors,
    stored,
    diagnostics,
  };
}

function withDeclaredProvenanceFields<
  T extends Extract<ReasoningMutation, { type: "SET" | "REVISE" }>,
>(stored: T, mutation: T): T {
  const basis = mutationBasis(mutation);
  const sources = mutationSourceInformationIds(mutation);
  return {
    ...stored,
    ...(basis.length > 0 ? { basis: [...basis] } : {}),
    ...(sources.length > 0 ? { sourceInformationIds: [...sources] } : {}),
  };
}

function validateSourceInformationIds(
  mutation: Extract<ReasoningMutation, { type: "SET" | "REVISE" }>,
  ctx: ApplyMutationsContext,
): { ids: string[]; errors: string[] } {
  const declared = mutationSourceInformationIds(mutation);
  if (declared.length === 0) return { ids: [], errors: [] };
  const allowed = ctx.allowedSourceInformationIds;
  if (!allowed) {
    // No assignment context (legacy / tests): accept declared ids as-is.
    return { ids: [...new Set(declared)], errors: [] };
  }
  const allowedSet =
    allowed instanceof Set ? allowed : new Set(allowed);
  const errors: string[] = [];
  const ids: string[] = [];
  for (const id of declared) {
    if (!allowedSet.has(id)) {
      errors.push(
        `sourceInformationId "${id}" is not in this agent's information packet`,
      );
      continue;
    }
    ids.push(id);
  }
  return { ids: [...new Set(ids)], errors };
}

function withDeclaredBasis<T extends Extract<ReasoningMutation, { type: "SET" | "REVISE" }>>(
  stored: T,
  mutation: T,
): T {
  return withDeclaredProvenanceFields(stored, mutation);
}

function validateProvenance(
  mutation: Extract<ReasoningMutation, { type: "SET" | "REVISE" }>,
  mutable: MutableGraph,
  ctx: ApplyMutationsContext,
): { nextId: string; versionIds: string[]; errors: string[] } {
  const nextId = nextVersionId(mutable.versions.keys());
  const resolved = resolveAndValidateBasis(mutation.basis, [...mutable.versions.values()], {
    nextVersionId: nextId,
    turnIndex: ctx.turnIndex,
    subjects: mutable.subjects,
  });
  return { nextId, ...resolved };
}

function applySet(
  mutation: Extract<ReasoningMutation, { type: "SET" }>,
  ctx: ApplyMutationsContext,
  mutable: MutableGraph,
): ApplyOneResult {
  let content = sanitizeContent(mutation.content);
  let stored: ReasoningMutation = withDeclaredBasis(
    {
      type: "SET",
      subjectId: mutation.subjectId,
      content,
      ...(mutation.subjectLabel?.trim()
        ? { subjectLabel: mutation.subjectLabel.trim() }
        : {}),
    },
    mutation,
  );
  if (!content) {
    return reject(stored, ["SET is missing content"]);
  }

  const resolved = resolveSubjectId(mutation.subjectId, mutable, ctx);
  if (resolved.error || !resolved.id) {
    return reject(stored, [resolved.error ?? "SET is missing subjectId"]);
  }
  stored = { ...stored, subjectId: resolved.id };

  const current = activeIn(mutable.versions, resolved.id);
  if (current) {
    return reject(stored, [
      `duplicate SET for ${resolved.id}; use REVISE (current value is "${current.content}")`,
    ]);
  }

  if (ctx.actor !== "system" && ctx.validateContent) {
    const validity = ctx.validateContent(resolved.id, content);
    if (!validity.ok) {
      return reject(stored, validity.reasons ?? ["content failed structural validation"]);
    }
    if (validity.normalized) {
      content = validity.normalized;
      stored = { ...stored, content };
    }
  }

  if (ctx.actor !== "agent_a" && ctx.actor !== "agent_b") {
    return reject(stored, ["SET requires an agent actor"]);
  }

  const provenance = validateProvenance(mutation, mutable, ctx);
  if (provenance.errors.length > 0) {
    return reject(stored, provenance.errors);
  }
  const sources = validateSourceInformationIds(mutation, ctx);
  if (sources.errors.length > 0) {
    return reject(stored, sources.errors);
  }

  if (resolved.created) {
    mutable.subjects.push({
      id: resolved.id,
      label: mutation.subjectLabel?.trim() || resolved.label || resolved.id,
      kind: "agent_defined",
      source: "agent",
      createdAtTurn: ctx.turnIndex,
      createdBy: ctx.actor,
    });
  } else if (mutation.subjectLabel?.trim()) {
    const existing = findSubject(mutable.subjects, resolved.id);
    if (existing && !existing.label) {
      existing.label = mutation.subjectLabel.trim();
    }
  }

  const version: PropositionVersion = {
    id: provenance.nextId,
    subjectId: resolved.id,
    content,
    agentId: ctx.actor,
    turn: ctx.turnIndex,
    sourceUtteranceTurn: ctx.turnIndex,
    sourceMessageId: ctx.messageId,
    status: "active",
    ...(provenance.versionIds.length > 0
      ? { derivedFromVersionIds: provenance.versionIds }
      : {}),
    ...(sources.ids.length > 0 ? { sourceInformationIds: sources.ids } : {}),
  };
  mutable.versions.set(provenance.nextId, version);
  return {
    accepted: true,
    errors: [],
    stored,
    versionId: provenance.nextId,
    ...(provenance.versionIds.length > 0
      ? { basisVersionIds: provenance.versionIds }
      : {}),
    ...(sources.ids.length > 0 ? { sourceInformationIds: sources.ids } : {}),
  };
}

function applyRevise(
  mutation: Extract<ReasoningMutation, { type: "REVISE" }>,
  ctx: ApplyMutationsContext,
  mutable: MutableGraph,
): ApplyOneResult {
  let after = sanitizeContent(mutation.after);
  const declaredFrom = mutation.fromVersionId?.trim();
  let stored: ReasoningMutation = withDeclaredBasis(
    {
      type: "REVISE",
      subjectId: mutation.subjectId,
      after,
      ...(declaredFrom ? { fromVersionId: declaredFrom } : {}),
      ...(mutation.before !== undefined
        ? { before: sanitizeContent(mutation.before) }
        : {}),
    },
    mutation,
  );
  if (!after) {
    return reject(stored, ["REVISE is missing after"]);
  }

  const resolved = resolveSubjectId(mutation.subjectId, mutable, ctx);
  if (resolved.error || !resolved.id || resolved.created) {
    return reject(stored, [
      resolved.created
        ? `REVISE requires an existing subject; ${mutation.subjectId} is unknown`
        : (resolved.error ?? "REVISE is missing subjectId"),
    ]);
  }
  stored = { ...stored, subjectId: resolved.id };

  const current = activeIn(mutable.versions, resolved.id);
  if (!current) {
    return reject(stored, [
      `REVISE requires an active value for ${resolved.id}; use SET`,
    ]);
  }

  if (declaredFrom) {
    if (declaredFrom !== current.id) {
      return reject(stored, [
        `stale fromVersionId for ${resolved.id}: current is ${current.id}, got ${declaredFrom}`,
      ]);
    }
  } else if (mutation.before !== undefined) {
    const before = canonicalizeAgainstValidator(
      resolved.id,
      sanitizeContent(mutation.before),
      ctx,
    );
    stored = { ...stored, before };
    if (!contentsEqual(before, current.content) && before !== current.content) {
      return reject(stored, [
        `stale before value for ${resolved.id}: expected "${current.content}"`,
      ]);
    }
  } else {
    return reject(stored, ["REVISE requires fromVersionId"]);
  }

  stored = {
    ...stored,
    fromVersionId: current.id,
    before: current.content,
  };

  if (ctx.actor !== "system" && ctx.validateContent) {
    const validity = ctx.validateContent(resolved.id, after);
    if (!validity.ok) {
      return reject(stored, validity.reasons ?? ["content failed structural validation"]);
    }
    if (validity.normalized) {
      after = validity.normalized;
      stored = { ...stored, after };
    }
  }

  if (contentsEqual(current.content, after)) {
    return reject(
      stored,
      [`no-op REVISE for ${resolved.id}`],
      [`no_state_change: ${resolved.id} is already "${current.content}"`],
    );
  }

  if (ctx.actor !== "agent_a" && ctx.actor !== "agent_b") {
    return reject(stored, ["REVISE requires an agent actor"]);
  }

  const provenance = validateProvenance(mutation, mutable, ctx);
  if (provenance.errors.length > 0) {
    return reject(stored, provenance.errors);
  }
  const sources = validateSourceInformationIds(mutation, ctx);
  if (sources.errors.length > 0) {
    return reject(stored, sources.errors);
  }

  const version: PropositionVersion = {
    id: provenance.nextId,
    subjectId: resolved.id,
    content: after,
    agentId: ctx.actor,
    turn: ctx.turnIndex,
    previousVersionId: current.id,
    sourceUtteranceTurn: ctx.turnIndex,
    sourceMessageId: ctx.messageId,
    status: "active",
    ...(provenance.versionIds.length > 0
      ? { derivedFromVersionIds: provenance.versionIds }
      : {}),
    ...(sources.ids.length > 0 ? { sourceInformationIds: sources.ids } : {}),
  };
  mutable.versions.set(current.id, { ...current, status: "superseded" });
  mutable.versions.set(provenance.nextId, version);
  return {
    accepted: true,
    errors: [],
    stored,
    versionId: provenance.nextId,
    previousVersionId: current.id,
    ...(provenance.versionIds.length > 0
      ? { basisVersionIds: provenance.versionIds }
      : {}),
    ...(sources.ids.length > 0 ? { sourceInformationIds: sources.ids } : {}),
  };
}

function applyRemove(
  mutation: Extract<ReasoningMutation, { type: "REMOVE" }>,
  ctx: ApplyMutationsContext,
  mutable: MutableGraph,
): ApplyOneResult {
  let before = sanitizeContent(mutation.before);
  const stored: ReasoningMutation = {
    type: "REMOVE",
    subjectId: mutation.subjectId,
    before,
  };
  const resolved = resolveSubjectId(mutation.subjectId, mutable, ctx);
  if (resolved.error || !resolved.id || resolved.created) {
    return reject(stored, [
      resolved.created
        ? `REMOVE requires an existing subject; ${mutation.subjectId} is unknown`
        : (resolved.error ?? "REMOVE is missing subjectId"),
    ]);
  }
  stored.subjectId = resolved.id;
  before = canonicalizeAgainstValidator(resolved.id, before, ctx);
  stored.before = before;

  const current = activeIn(mutable.versions, resolved.id);
  if (!current) {
    return reject(stored, [`REMOVE requires an active value for ${resolved.id}`]);
  }
  if (!contentsEqual(before, current.content) && before !== current.content) {
    return reject(stored, [
      `stale before value for ${resolved.id}: expected "${current.content}"`,
    ]);
  }

  mutable.versions.set(current.id, { ...current, status: "removed" });
  return {
    accepted: true,
    errors: [],
    stored,
    previousVersionId: current.id,
  };
}

function applyOneMutation(
  mutation: StoredReasoningMutation,
  ctx: ApplyMutationsContext,
  mutable: MutableGraph,
): ApplyOneResult {
  if (mutation.type === "invalid") {
    return reject(mutation, ["malformed idea mutation"]);
  }
  if (mutation.type === "protocol_failure") {
    return reject(mutation, [mutation.reason]);
  }
  if (mutation.type === "final_answer") {
    return reject(mutation, [
      "FINAL_ANSWER belongs on the turn envelope, not in mutations",
    ]);
  }
  if (mutation.type === "SET") return applySet(mutation, ctx, mutable);
  if (mutation.type === "REVISE") return applyRevise(mutation, ctx, mutable);
  return applyRemove(mutation, ctx, mutable);
}

function appendEvent(
  mutable: MutableGraph,
  ctx: ApplyMutationsContext,
  result: ApplyOneResult,
): ReasoningEvent {
  const seq = mutable.events.length + 1;
  const event: ReasoningEvent = {
    id: `re-${seq}`,
    seq,
    turnIndex: ctx.turnIndex,
    messageId: ctx.messageId,
    actor: ctx.actor,
    mutation: cloneMutation(result.stored),
    accepted: result.accepted,
    errors: [...result.errors],
    ...(result.diagnostics && result.diagnostics.length > 0
      ? { diagnostics: [...result.diagnostics] }
      : {}),
    ...(result.stateChanged === false || !result.accepted
      ? { stateChanged: false as const }
      : {}),
    ...(result.versionId ? { versionId: result.versionId } : {}),
    ...(result.previousVersionId
      ? { previousVersionId: result.previousVersionId }
      : {}),
    ...(result.basisVersionIds && result.basisVersionIds.length > 0
      ? { basisVersionIds: [...result.basisVersionIds] }
      : {}),
    ...(result.sourceInformationIds && result.sourceInformationIds.length > 0
      ? { sourceInformationIds: [...result.sourceInformationIds] }
      : {}),
  };
  mutable.events.push(event);
  return event;
}

function addEventDiagnostic(event: ReasoningEvent, message: string): void {
  if (event.diagnostics?.includes(message)) return;
  event.diagnostics = [...(event.diagnostics ?? []), message];
}

function applyAcceptedMutation(
  versions: Map<string, PropositionVersion>,
  subjects: ReasoningSubject[],
  event: ReasoningEvent,
): void {
  if (!event.accepted || event.stateChanged === false) return;
  const mutation = event.mutation;
  if (!isStateChangeMutation(mutation)) return;
  if (event.actor !== "agent_a" && event.actor !== "agent_b") return;

  if (mutation.type === "SET") {
    if (!findSubject(subjects, mutation.subjectId)) {
      subjects.push({
        id: mutation.subjectId,
        label: mutation.subjectLabel ?? mutation.subjectId,
        kind: "agent_defined",
        source: "agent",
        createdAtTurn: event.turnIndex,
        createdBy: event.actor,
      });
    }
    const id = event.versionId ?? nextVersionId(versions.keys());
    versions.set(id, {
      id,
      subjectId: mutation.subjectId,
      content: sanitizeContent(mutation.content),
      agentId: event.actor,
      turn: event.turnIndex,
      sourceUtteranceTurn: event.turnIndex,
      sourceMessageId: event.messageId,
      status: "active",
      ...(event.basisVersionIds && event.basisVersionIds.length > 0
        ? { derivedFromVersionIds: [...event.basisVersionIds] }
        : {}),
      ...(event.sourceInformationIds && event.sourceInformationIds.length > 0
        ? { sourceInformationIds: [...event.sourceInformationIds] }
        : {}),
    });
    return;
  }

  if (mutation.type === "REVISE") {
    const current = activeIn(versions, mutation.subjectId);
    if (current) {
      versions.set(current.id, { ...current, status: "superseded" });
    }
    const id = event.versionId ?? nextVersionId(versions.keys());
    versions.set(id, {
      id,
      subjectId: mutation.subjectId,
      content: sanitizeContent(mutation.after),
      agentId: event.actor,
      turn: event.turnIndex,
      previousVersionId: event.previousVersionId ?? current?.id,
      sourceUtteranceTurn: event.turnIndex,
      sourceMessageId: event.messageId,
      status: "active",
      ...(event.basisVersionIds && event.basisVersionIds.length > 0
        ? { derivedFromVersionIds: [...event.basisVersionIds] }
        : {}),
      ...(event.sourceInformationIds && event.sourceInformationIds.length > 0
        ? { sourceInformationIds: [...event.sourceInformationIds] }
        : {}),
    });
    return;
  }

  const current = activeIn(versions, mutation.subjectId);
  if (current) {
    versions.set(current.id, { ...current, status: "removed" });
  }
}

/**
 * Rebuild canonical state from the event log. Rejected events are kept but
 * do not mutate subjects or versions.
 */
export function materializeGraph(
  events: ReasoningEvent[],
  subjects: ReasoningSubject[] = [],
): ReasoningGraph {
  const sorted = [...events].sort((a, b) => a.seq - b.seq || a.turnIndex - b.turnIndex);
  const mutable: MutableGraph = {
    subjects: subjects.map(cloneSubject),
    versions: new Map(),
    events: sorted.map(cloneEvent),
  };
  for (const event of sorted) {
    applyAcceptedMutation(mutable.versions, mutable.subjects, event);
    const mutation = event.mutation;
    if (mutation?.type === "final_answer" && event.accepted) {
      mutable.finalAnswer = {
        text: mutation.text,
        actor: event.actor,
        turn: event.turnIndex,
        messageId: event.messageId,
      };
    }
  }
  return toGraph(mutable);
}

/**
 * Prefer the event log as source of truth. Version snapshots are a cache.
 * Schema-1 dense-graph records are not converted into versioned state.
 */
export function hydrateReasoningGraph(raw: {
  reasoningSchemaVersion?: number;
  reasoningSubjects?: ReasoningSubject[] | unknown[];
  reasoningVersions?: PropositionVersion[] | unknown[];
  reasoningEvents?: ReasoningEvent[] | unknown[];
}): ReasoningGraph {
  const schemaVersion =
    detectReasoningSchema({
      reasoningSchemaVersion: raw.reasoningSchemaVersion,
      reasoningEvents: raw.reasoningEvents,
    }) === 1
      ? 1
      : REASONING_SCHEMA_VERSION;
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      subjects: [],
      versions: [],
      events: [],
    };
  }
  const subjects = (raw.reasoningSubjects ?? [])
    .map((item) => parseReasoningSubject(item))
    .filter((subject): subject is ReasoningSubject => Boolean(subject));
  const events = (raw.reasoningEvents ?? [])
    .map((item) => parseReasoningEvent(item))
    .filter((event): event is ReasoningEvent => Boolean(event));
  if (events.length > 0) {
    return materializeGraph(events, subjects);
  }
  return scrubForbiddenMoralGraph({
    schemaVersion: REASONING_SCHEMA_VERSION,
    subjects,
    versions: (raw.reasoningVersions ?? [])
      .map((item) => parsePropositionVersion(item))
      .filter((version): version is PropositionVersion => Boolean(version)),
    events: [],
  });
}

export function applyReasoningMutations(
  graph: ReasoningGraph,
  mutations: ParsedMutation[],
  ctx: ApplyMutationsContext,
): ApplyMutationsResult {
  const materialized =
    graph.events.length > 0
      ? materializeGraph(graph.events, graph.subjects)
      : cloneReasoningGraph(graph);
  const mutable: MutableGraph = {
    subjects: materialized.subjects.map(cloneSubject),
    versions: new Map(materialized.versions.map((version) => [version.id, cloneVersion(version)])),
    events: materialized.events.map(cloneEvent),
    finalAnswer: materialized.finalAnswer ? { ...materialized.finalAnswer } : undefined,
  };

  const applied: ReasoningEvent[] = [];

  if (ctx.protocolFailure) {
    applied.push(
      appendEvent(mutable, ctx, {
        accepted: false,
        stateChanged: false,
        errors: [ctx.protocolFailure],
        stored: { type: "protocol_failure", reason: ctx.protocolFailure },
      }),
    );
  }

  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]!;
    if (i >= MAX_MUTATIONS_PER_TURN && ctx.actor !== "system") {
      applied.push(
        appendEvent(mutable, ctx, {
          accepted: false,
          stateChanged: false,
          errors: [`ignored: over the per-turn cap of ${MAX_MUTATIONS_PER_TURN}`],
          stored: mutation,
        }),
      );
      continue;
    }
    applied.push(appendEvent(mutable, ctx, applyOneMutation(mutation, ctx, mutable)));
  }

  if (ctx.extraDiagnostics && ctx.extraDiagnostics.length > 0) {
    if (applied.length > 0) {
      for (const item of ctx.extraDiagnostics) addEventDiagnostic(applied[0]!, item);
    }
    // Valid empty mutations must not become a rejected graph event.
    // Diagnostics-only notes are dropped when there is no real mutation or
    // protocol-failure event to attach them to.
  }

  if (ctx.finalAnswerText?.trim()) {
    const text = ctx.finalAnswerText.trim();
    mutable.finalAnswer = {
      text,
      actor: ctx.actor,
      turn: ctx.turnIndex,
      messageId: ctx.messageId,
    };
    applied.push(
      appendEvent(mutable, ctx, {
        accepted: true,
        errors: [],
        stored: { type: "final_answer", text },
      }),
    );
  }

  const next = materializeGraph(mutable.events, mutable.subjects);
  return { graph: next, events: applied };
}

export function applyParsedTurn(
  graph: ReasoningGraph,
  parsed: ParsedAgentTurn,
  ctx: ApplyMutationsContext,
): ApplyMutationsResult {
  return applyReasoningMutations(graph, parsed.mutations, {
    ...ctx,
    protocolFailure: ctx.protocolFailure ?? parsed.protocolFailure,
    finalAnswerText: ctx.finalAnswerText ?? parsed.finalAnswerText,
  });
}

export function currentValue(
  graph: ReasoningGraph,
  subjectId: string,
): string | undefined {
  return activeVersion(graph, subjectId)?.content;
}

export function isAgentActor(actor: ReasoningActor): actor is AgentId {
  return actor === "agent_a" || actor === "agent_b";
}
