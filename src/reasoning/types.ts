import type { AgentId } from "../agents/types";

/** Agent or application actor that can create graph records. */
export type ReasoningActor = AgentId | "system";

/**
 * Canonical reasoning schema.
 * 1 = dense claim/evidence/stance graph (legacy runs; inspect only).
 * 2 = versioned subject state (SET / REVISE / REMOVE).
 */
export const REASONING_SCHEMA_VERSION = 2 as const;
export type ReasoningSchemaVersion = 1 | 2;

export type PropositionVersionStatus = "active" | "superseded" | "removed";

export type ReasoningSubjectSource = "task" | "agent";

/**
 * One independently revisable unit of reasoning state.
 * Crossword: a clue. Moral: a consideration. Hidden Profile: an agent-created
 * decision-relevant consideration (not a seeded option/evidence lane).
 * Task adapters seed known subjects; agents may conservatively introduce new
 * ones on SET. The original task prompt and the final answer are not subjects.
 */
export type ReasoningSubject = {
  id: string;
  label?: string;
  description?: string;
  prompt?: string;
  kind?: "task_defined" | "agent_defined";
  source: ReasoningSubjectSource;
  createdAtTurn?: number;
  createdBy?: ReasoningActor;
  metadata?: Record<string, unknown>;
};

/**
 * Immutable snapshot of a subject's value at a point in the conversation.
 * Revisions never mutate an existing version.
 */
export type PropositionVersion = {
  id: string;
  subjectId: string;
  content: string;
  agentId: AgentId;
  turn: number;
  previousVersionId?: string;
  /**
   * Agent-declared provenance: existing versions this commitment was based on.
   * Reconstructed from the event log. Never inferred from prose.
   */
  derivedFromVersionIds?: string[];
  /**
   * Task / private evidence provenance (information unit ids).
   * Separate from derivedFromVersionIds. Never leaked into partner prompts.
   */
  sourceInformationIds?: string[];
  sourceUtteranceTurn: number;
  sourceMessageId?: string;
  status: PropositionVersionStatus;
};

/** Model-authored commitment. Validated deterministically before application. */
export type ReasoningMutation =
  | {
      type: "SET";
      subjectId: string;
      subjectLabel?: string;
      content: string;
      /**
       * Agent-authored refs to existing shared versions (`pv-2`).
       * Legacy `subject@vN` forms remain parseable for historical transcripts.
       * `private:` ids are reserved and rejected (use sourceInformationIds).
       */
      basis?: string[];
      /**
       * Task/private evidence ids from the agent's information packet.
       * Separate from basis. Validated against the speaker's visible units.
       */
      sourceInformationIds?: string[];
    }
  | {
      type: "REVISE";
      subjectId: string;
      /**
       * Active version being replaced. Preferred agent-facing staleness check.
       * Historical mutations may omit this and use `before` instead.
       */
      fromVersionId?: string;
      /**
       * Canonical content of the replaced version. Derived from the referenced
       * version on accept. Legacy agent output may still supply it instead of
       * `fromVersionId`.
       */
      before?: string;
      after: string;
      basis?: string[];
      sourceInformationIds?: string[];
    }
  | {
      type: "REMOVE";
      subjectId: string;
      before: string;
    };

/** Speaker-authored mutation or a recoverable malformed entry kept for rejection. */
export type ParsedMutation =
  | ReasoningMutation
  | { type: "invalid"; raw?: unknown };

export type StoredReasoningMutation =
  | ReasoningMutation
  | { type: "protocol_failure"; reason: string }
  | { type: "final_answer"; text?: string }
  | { type: "invalid"; raw?: unknown };

/**
 * Append-only event. Replay of accepted SET/REVISE/REMOVE events from an
 * empty graph reconstructs canonical state. Rejected mutations stay in the
 * log for diagnostics and are not applied.
 */
export type ReasoningEvent = {
  id: string;
  seq: number;
  turnIndex: number;
  messageId: string;
  actor: ReasoningActor;
  mutation: StoredReasoningMutation;
  accepted: boolean;
  errors: string[];
  diagnostics?: string[];
  /**
   * False when recorded but canonical state did not change (no-op, stale,
   * duplicate SET). Absent on historical Aug 19 events; treat missing as
   * `accepted`.
   */
  stateChanged?: boolean;
  reason?: string;
  /** Version created by an accepted SET or REVISE. */
  versionId?: string;
  /** Version superseded or removed by an accepted REVISE or REMOVE. */
  previousVersionId?: string;
  /** Resolved provenance version ids for an accepted SET/REVISE. */
  basisVersionIds?: string[];
  /**
   * Accepted task/private evidence ids for this mutation.
   * Not serialized into partner-facing graph state text.
   */
  sourceInformationIds?: string[];
};

export type ReasoningGraph = {
  schemaVersion: ReasoningSchemaVersion;
  subjects: ReasoningSubject[];
  versions: PropositionVersion[];
  events: ReasoningEvent[];
  finalAnswer?: {
    text?: string;
    actor: ReasoningActor;
    turn: number;
    messageId: string;
  };
};

export type ParsedAgentTurn = {
  /** Natural-language utterance the partner hears this turn. */
  message: string;
  /** Speaker-authored commitments. Empty is a valid turn. */
  mutations: ParsedMutation[];
  /**
   * Set when the turn did not provide a valid envelope. The engine records a
   * protocol-failure event; `mutations` is empty.
   */
  protocolFailure?: string;
  finalAnswerText?: string;
  /**
   * Speaker-declared citations of considerations used in FINAL_ANSWER.
   * Absent when the field was omitted. Empty array means declared none.
   */
  finalBasisRefs?: string[];
  finalBasisDeclared?: boolean;
  /** Task/private evidence ids cited alongside FINAL_ANSWER. */
  finalSourceInformationIds?: string[];
  /** Exact model output. */
  raw: string;
  parsedAsJson: boolean;
  /**
   * Speaker declared that this turn adds no persistent reasoning after
   * reviewing canonical state. Rare escape hatch for moral finalization.
   */
  nothingToAdd?: boolean;
  /**
   * Protocol metadata: speaker judges the current shared graph ready for
   * final synthesis. Bound to the graph fingerprint by the controller.
   * Not graph state. Moral runs only.
   */
  readyToFinalize?: boolean;
  /**
   * Optional inspection metadata naming consideration ids this turn focused on.
   * Not canonical graph state. Moral runs only.
   */
  focusSubjectIds?: string[];
  /** True when mutations were recovered from a near-miss JSON shape. */
  normalizedFromMalformedShape?: boolean;
  /**
   * True when the envelope is missing or every listed mutation is malformed.
   * Never set for a valid `mutations: []` turn. Never used to invent graph changes.
   */
  structuredReasoningMissing?: boolean;
};

export const MUTATION_TYPES = ["SET", "REVISE", "REMOVE"] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

export const STATE_CHANGE_MUTATION_TYPES = MUTATION_TYPES;

export function emptyReasoningGraph(
  subjects: ReasoningSubject[] = [],
): ReasoningGraph {
  return {
    schemaVersion: REASONING_SCHEMA_VERSION,
    subjects: subjects.map((subject) => ({ ...subject })),
    versions: [],
    events: [],
  };
}

export function hasStructuredReasoning(value: {
  reasoningSubjects?: ReasoningSubject[];
  reasoningVersions?: PropositionVersion[];
  reasoningEvents?: ReasoningEvent[];
  reasoningNodes?: unknown[];
}): boolean {
  return (
    Array.isArray(value.reasoningSubjects) ||
    Array.isArray(value.reasoningVersions) ||
    Array.isArray(value.reasoningEvents) ||
    Array.isArray(value.reasoningNodes)
  );
}

export function isStateChangeMutation(
  mutation: StoredReasoningMutation | undefined,
): mutation is ReasoningMutation {
  return (
    mutation?.type === "SET" ||
    mutation?.type === "REVISE" ||
    mutation?.type === "REMOVE"
  );
}

export function mutationSubjectId(
  mutation: StoredReasoningMutation | undefined,
): string | undefined {
  if (!mutation) return undefined;
  if (mutation.type === "SET" || mutation.type === "REVISE" || mutation.type === "REMOVE") {
    return mutation.subjectId;
  }
  return undefined;
}

export function mutationBasis(
  mutation: StoredReasoningMutation | undefined,
): string[] {
  if (!mutation) return [];
  if (mutation.type === "SET" || mutation.type === "REVISE") {
    return mutation.basis ?? [];
  }
  return [];
}

export function mutationSourceInformationIds(
  mutation: StoredReasoningMutation | undefined,
): string[] {
  if (!mutation) return [];
  if (mutation.type === "SET" || mutation.type === "REVISE") {
    return mutation.sourceInformationIds ?? [];
  }
  return [];
}

export type ProvenanceEdgeKind = "revises" | "derived_from";

export type ProvenanceEdge = {
  from: string;
  to: string;
  kind: ProvenanceEdgeKind;
};

/** Current value for a subject, if any. */
export function activeVersion(
  graph: Pick<ReasoningGraph, "versions">,
  subjectId: string,
): PropositionVersion | undefined {
  return graph.versions.find(
    (version) => version.subjectId === subjectId && version.status === "active",
  );
}

export function versionsForSubject(
  graph: Pick<ReasoningGraph, "versions">,
  subjectId: string,
): PropositionVersion[] {
  return graph.versions
    .filter((version) => version.subjectId === subjectId)
    .sort((a, b) => a.turn - b.turn || a.id.localeCompare(b.id));
}

export function normalizePropositionContent(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * Legacy dense-graph types retained only so old inspector/export code can
 * mention the retired representation. New runs never produce these.
 */
export type ReasoningNodeStatus =
  | "open"
  | "accepted"
  | "rejected"
  | "superseded"
  | "unresolved";

export type IssueConflict = {
  issueId: string;
  nodeIds: string[];
  source: "reasoning" | "task_constraint";
  description?: string;
};

export type DeterministicReasoningSignal = {
  id: string;
  issueId: string;
  kind: "evidence" | "challenge" | "contradiction" | "revision";
  nodeIds?: string[];
  description?: string;
};

export type TaskCompatibility = "compatible" | "incompatible" | "unknown";

export type IssueConvergenceState = {
  issueId: string;
  liveClaimIds: string[];
  settledClaimId?: string;
  unresolved: boolean;
  contradictory: boolean;
  reopened: boolean;
  lastChangedTurn?: number;
  conflicts: IssueConflict[];
  claimCompatibility?: Record<string, TaskCompatibility>;
};

export type GenericReadiness = {
  allRequiredIssuesSettled: boolean;
  unresolvedIssueCount: number;
  unresolvedConflictCount: number;
};

export type ReasoningProgressState = {
  unresolvedIssueCount: number;
  settledIssueCount: number;
  liveClaimCount: number;
  turnsSinceIssueResolution: number;
  turnsSinceNewEvidence: number;
  turnsSinceSemanticEdge: number;
  repeatedClaimCount: number;
  reopenedIssueCount: number;
  likelyStalled: boolean;
  reasons: string[];
};

export type ReasoningIssue = {
  id: string;
  kind: "task_defined" | "emergent";
  label: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
};

export type FinalAnswerSupport = {
  text?: string;
  supportingNodeIds?: string[];
  /** Resolved proposition version ids cited as final-synthesis basis. */
  basisVersionIds?: string[];
  /** False when the speaker omitted finalBasis. Empty basis with true means declared none. */
  declared?: boolean;
  errors: string[];
};
