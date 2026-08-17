import type { AgentId } from "../agents/types";

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

/**
 * Stable task- or application-defined question that reasoning nodes can
 * concern across turns. Unlike an issue node, a task subject is structural
 * context and has no conversational creation turn.
 */
export type ReasoningSubject = {
  id: string;
  label: string;
  description?: string;
  source: "task";
  metadata?: Record<string, unknown>;
};

export type AtomicReasoningNode = {
  id: string;
  type: AtomicReasoningNodeType;
  text: string;
  createdBy: AgentId;
  createdAtTurn: number;
  /** Transcript message that created this node. */
  sourceMessageId?: string;
  confidence?: number;
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
  createdBy: AgentId;
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
  | "revises";

/** A directed semantic relationship with event-level provenance. */
export type ReasoningEdge = {
  id: string;
  type: ReasoningEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  createdBy: AgentId;
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
    }
  | {
      action: "support" | "challenge";
      sourceNodeId?: string;
      targetNodeId?: string;
      /** Legacy alias for targetNodeId. */
      targetId?: string;
      reason?: string;
    }
  | {
      action: "accept" | "reject" | "pass";
      targetId?: string;
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
      reason?: string;
      localId?: string;
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
export type ReasoningOperation =
  | {
      type: "create";
      node: AtomicReasoningNode;
    }
  | {
      type: "support";
      actor: AgentId;
      sourceNodeId?: string;
      targetNodeId: string;
      /** Legacy alias retained in stored operations. */
      targetId: string;
      reason?: string;
    }
  | {
      type: "challenge";
      actor: AgentId;
      sourceNodeId?: string;
      targetNodeId: string;
      targetId: string;
      reason?: string;
    }
  | {
      type: "accept";
      actor: AgentId;
      targetId: string;
      reason?: string;
    }
  | {
      type: "reject";
      actor: AgentId;
      targetId: string;
      reason: string;
    }
  | {
      type: "revise";
      actor: AgentId;
      targetId: string;
      replacement: AtomicReasoningNode;
      reason?: string;
    }
  | {
      type: "pass";
      actor: AgentId;
      targetId: string;
      reason?: string;
    }
  | {
      type: "invalid";
      actor: AgentId;
      targetId?: string;
    }
  | {
      type: "protocol_failure";
      actor: AgentId;
      reason: string;
    }
  | {
      type: "final_answer";
      actor: AgentId;
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
  actor: AgentId;
  intent: ReasoningIntent;
  operation: ReasoningOperation;
  accepted: boolean;
  errors: string[];
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
