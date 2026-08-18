import type { AgentId } from "../agents/types";

/** Agent or application actor that can create graph records. */
export type ReasoningActor = AgentId | "system";

/**
 * Where an evidence node originated. Task and deterministic nodes are
 * application-created; agent nodes are model-authored observations.
 */
export type EvidenceOrigin = "task" | "deterministic" | "agent";

export type ClaimSelector = "current" | "previous";

/**
 * Domain-independent reasoning nodes. Task-specific fields belong in
 * optional `metadata`, never in the core protocol.
 *
 * issue: a question or subproblem requiring resolution.
 * proposal: a candidate answer, decision, interpretation, or solution.
 * claim: a proposition asserted as part of the reasoning.
 * evidence: a fact, observation, calculation, constraint, premise, or reason.
 * challenge: legacy-only node label; new objections use typed challenge edges.
 */
export type AtomicReasoningNodeType =
  | "issue"
  | "proposal"
  | "claim"
  | "evidence"
  | "challenge";

export type ReasoningNodeType = AtomicReasoningNodeType | "final_answer";

export type ReasoningNodeStatus =
  | "open"
  | "accepted"
  | "rejected"
  | "superseded"
  | "unresolved";

export type ReasoningIssueKind = "task_defined" | "emergent";

/**
 * Stable task- or application-defined question that reasoning nodes can
 * concern across turns. Unlike an issue node, a task subject is structural
 * context and has no conversational creation turn.
 */
export type ReasoningSubject = {
  id: string;
  label: string;
  description?: string;
  /** New records use task_defined; optional for persisted v1 subjects. */
  kind?: "task_defined";
  /** Task-facing wording of the question or subproblem. */
  prompt?: string;
  source: "task";
  metadata?: Record<string, unknown>;
};

/** A task-defined subject or an emergent issue node, in a common view. */
export type ReasoningIssue = {
  id: string;
  kind: ReasoningIssueKind;
  label: string;
  prompt?: string;
  metadata?: Record<string, unknown>;
};

export type ReasoningStance = {
  actor: AgentId;
  kind: "support" | "challenge" | "accept" | "reject" | "pass";
  reason?: string;
  turnIndex: number;
  messageId: string;
};

/**
 * Model-facing semantic move. The engine converts these into canonical
 * nodes, ids, edges, revisions, provenance, and events.
 */
export type ReasoningMove =
  | {
      kind: "claim";
      subject?: string;
      value?: string;
      text?: string;
      basis?: string[];
    }
  | {
      kind: "evidence";
      text: string;
      source?: string;
      subject?: string;
    }
  | {
      kind: "revise";
      subject?: string;
      claim?: string;
      value?: string;
      text?: string;
      basis?: string[];
      selector?: ClaimSelector;
    }
  | {
      kind: "agree";
      subject?: string;
      claim?: string;
    }
  | {
      kind: "disagree";
      subject?: string;
      claim?: string;
      basis?: string[];
    }
  | {
      kind: "support" | "challenge";
      source?: string;
      target?: string;
      subject?: string;
      reason?: string;
    };

/**
 * A conflict is generic protocol input. The producer, not the convergence
 * engine, owns the semantics that made the nodes incompatible.
 */
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
  agentStances?: {
    agentA?: ReasoningStance;
    agentB?: ReasoningStance;
  };
  conflicts: IssueConflict[];
  /**
   * Task-adapter compatibility of live claims. Independent of agent status:
   * a claim may be accepted by an agent and incompatible with constraints.
   */
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

export type AtomicReasoningNode = {
  id: string;
  type: AtomicReasoningNodeType;
  text: string;
  createdBy: ReasoningActor;
  createdAtTurn: number;
  /** Transcript message that created this node. */
  sourceMessageId?: string;
  confidence?: number;
  /** Present on evidence nodes when origin is known. */
  evidenceOrigin?: EvidenceOrigin;
  /**
   * Derived convenience snapshot. Agent stances live in `reasoningEvents`;
   * this field is recomputed by the reducer and must not be treated as an
   * independent source of truth.
   */
  status: ReasoningNodeStatus;
  parents: string[];
  dependencies: string[];
  /** Stable task subject id or the id of an emergent issue node. */
  subjectId?: string;
  supersedes?: string;
  metadata?: Record<string, unknown>;
};

/**
 * Engine-derived terminal node. It is materialized from a final_answer event
 * even when one or more claimed supports are missing or otherwise invalid.
 */
export type FinalAnswerNode = {
  id: "__final_answer__";
  type: "final_answer";
  text: string;
  createdBy: ReasoningActor;
  createdAtTurn: number;
  sourceMessageId: string;
  sourceEventId: string;
  confidence?: number;
  status: ReasoningNodeStatus;
  parents: string[];
  dependencies: string[];
  supersedes?: string;
  metadata?: Record<string, unknown>;
  supportingNodeIds: string[];
  supportErrors: string[];
};

export type ReasoningNode = AtomicReasoningNode | FinalAnswerNode;

export type ReasoningEdgeType =
  | "answers"
  | "supports"
  | "challenges"
  | "depends_on"
  | "revises"
  /**
   * Provenance, not decisive support. Canonical direction is
   * `evidence|claim --grounds--> claim` ("E1 grounds C4").
   */
  | "grounds"
  /**
   * Historical, not epistemic: the previous active candidate for an issue
   * was succeeded by this node. Canonical direction is old → new
   * (`old --replaced_by--> new`). Distinct from `revises`.
   */
  | "replaced_by";

/** A directed semantic relationship with event-level provenance. */
export type ReasoningEdge = {
  id: string;
  type: ReasoningEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  createdBy: ReasoningActor;
  createdAtTurn: number;
  sourceMessageId: string;
  sourceEventId: string;
  reason?: string;
  /** True when reconstructed from an old node field rather than a typed edge intent. */
  legacy?: boolean;
};

/**
 * Model-authored reasoning intent. The engine owns ids, actor, provenance,
 * status, supersession, and legality. Partial / malformed intents are still
 * represented so they can become rejected events instead of disappearing.
 */
export type ReasoningIntent =
  | {
      action: "create";
      nodeType?: string;
      text?: string;
      confidence?: number;
      /** @deprecated Legacy grouping only; ignored for newly applied creates. */
      parents?: string[];
      dependencies?: string[];
      subjectId?: string;
      /** Turn-local handle; resolved to an engine-allocated id. */
      localId?: string;
      metadata?: Record<string, unknown>;
      /** Resolved grounding sources; engine creates `grounds` edges. */
      groundsNodeIds?: string[];
      /** Stronger evidential support; engine creates `supports` edges. */
      supportsNodeIds?: string[];
      /** Unresolved semantic basis aliases; engine resolves via the adapter. */
      basis?: string[];
    }
  | {
      action: "support" | "challenge";
      sourceNodeId?: string;
      targetNodeId?: string;
      /** Legacy alias for targetNodeId. */
      targetId?: string;
      subjectId?: string;
      selector?: ClaimSelector;
      reason?: string;
    }
  | {
      action: "accept" | "reject" | "pass";
      targetId?: string;
      subjectId?: string;
      selector?: ClaimSelector;
      reason?: string;
    }
  | {
      action: "revise";
      targetId?: string;
      nodeType?: string;
      text?: string;
      confidence?: number;
      /** @deprecated Legacy grouping only; ignored for newly applied revisions. */
      parents?: string[];
      dependencies?: string[];
      subjectId?: string;
      selector?: ClaimSelector;
      reason?: string;
      localId?: string;
      metadata?: Record<string, unknown>;
      groundsNodeIds?: string[];
      supportsNodeIds?: string[];
      basis?: string[];
    }
  | {
      action: "invalid";
      raw?: unknown;
    }
  | {
      action: "protocol_failure";
      reason: string;
    }
  | {
      action: "final_answer";
      text?: string;
      supportingNodeIds: string[];
    };

/**
 * Canonical applied operation stored on the event log. Created by the engine,
 * never by the model. Replay rebuilds graph state from these records.
 */
export type GroundingLink = {
  sourceNodeId: string;
  relation: "grounds" | "supports" | "challenges";
};

export type ReasoningOperation =
  | {
      type: "create";
      node: AtomicReasoningNode;
      /**
       * Previous active claim/proposal on the same issue, when this create
       * became the new active candidate. Engine-derived history only.
       */
      replacedActiveNodeId?: string;
      grounding?: GroundingLink[];
    }
  | {
      type: "support";
      actor: ReasoningActor;
      sourceNodeId?: string;
      targetNodeId: string;
      /** Legacy alias retained in stored operations. */
      targetId: string;
      reason?: string;
    }
  | {
      type: "challenge";
      actor: ReasoningActor;
      sourceNodeId?: string;
      targetNodeId: string;
      targetId: string;
      reason?: string;
    }
  | {
      type: "accept";
      actor: ReasoningActor;
      targetId: string;
      reason?: string;
    }
  | {
      type: "reject";
      actor: ReasoningActor;
      targetId: string;
      reason: string;
    }
  | {
      type: "revise";
      actor: ReasoningActor;
      targetId: string;
      replacement: AtomicReasoningNode;
      reason?: string;
      replacedActiveNodeId?: string;
      grounding?: GroundingLink[];
    }
  | {
      type: "pass";
      actor: ReasoningActor;
      targetId: string;
      reason?: string;
    }
  | {
      type: "invalid";
      actor: ReasoningActor;
      targetId?: string;
    }
  | {
      type: "protocol_failure";
      actor: ReasoningActor;
      reason: string;
    }
  | {
      type: "final_answer";
      actor: ReasoningActor;
      text?: string;
      supportingNodeIds: string[];
    };

/**
 * Append-only event. Every attempted intent produces an event. Invalid moves
 * are stored with `accepted: false` so evaluation can see attempted duplicates,
 * cycles, malformed references, and protocol failures.
 *
 * Events are the canonical historical record; node snapshots are derived.
 */
export type ReasoningEvent = {
  id: string;
  seq: number;
  turnIndex: number;
  messageId: string;
  actor: ReasoningActor;
  intent: ReasoningIntent;
  operation: ReasoningOperation;
  accepted: boolean;
  errors: string[];
  /**
   * Non-fatal observations (subjectId normalization, candidate revisits,
   * transitions without semantic lineage). Never used to reject the event.
   */
  diagnostics?: string[];
};

export type ReasoningGraph = {
  /** Stable task-defined subjects. Emergent issues remain ordinary issue nodes. */
  subjects?: ReasoningSubject[];
  nodes: ReasoningNode[];
  events: ReasoningEvent[];
  /** Derived from canonical events; optional only for old in-memory callers. */
  edges?: ReasoningEdge[];
};

export type FinalAnswerSupport = {
  text?: string;
  supportingNodeIds: string[];
  /** Engine-produced linkage errors. Empty when linkage is valid. */
  errors: string[];
};

export type ParsedAgentTurn = {
  /** Natural-language utterance used as the conversational record. */
  message: string;
  /** Tiny semantic moves as the model expressed them (after shape recovery). */
  moves: ReasoningMove[];
  intents: ReasoningIntent[];
  /**
   * Set when the turn did not provide a valid JSON envelope. The engine
   * records a protocol-failure event; `intents` is empty.
   */
  protocolFailure?: string;
  finalAnswerSupport?: Omit<FinalAnswerSupport, "errors">;
  /** Exact model output. */
  raw: string;
  parsedAsJson: boolean;
  /** True when at least one move was recovered from a near-miss JSON shape. */
  normalizedFromMalformedShape?: boolean;
  /** True when simple crossword fills were extracted from the message. */
  extractedFromMessage?: boolean;
  /**
   * True when the message looks substantive but no usable move was recorded.
   * Never used to invent complex semantics.
   */
  structuredReasoningMissing?: boolean;
};

export const REASONING_NODE_TYPES: readonly AtomicReasoningNodeType[] = [
  "issue",
  "proposal",
  "claim",
  "evidence",
  "challenge",
];

export const REASONING_NODE_STATUSES: readonly ReasoningNodeStatus[] = [
  "open",
  "accepted",
  "rejected",
  "superseded",
  "unresolved",
];

export const REASONING_OPERATION_TYPES = [
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
] as const;

export type ReasoningOperationType = (typeof REASONING_OPERATION_TYPES)[number];

export const REASONING_INTENT_ACTIONS = [
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
] as const;

export type ReasoningIntentAction = (typeof REASONING_INTENT_ACTIONS)[number];

export function emptyReasoningGraph(
  subjects: ReasoningSubject[] = [],
): ReasoningGraph {
  return { subjects, nodes: [], events: [], edges: [] };
}

export function hasStructuredReasoning(value: {
  reasoningSubjects?: ReasoningSubject[];
  reasoningNodes?: ReasoningNode[];
  reasoningEvents?: ReasoningEvent[];
}): boolean {
  return (
    Array.isArray(value.reasoningSubjects) ||
    Array.isArray(value.reasoningNodes) ||
    Array.isArray(value.reasoningEvents)
  );
}
