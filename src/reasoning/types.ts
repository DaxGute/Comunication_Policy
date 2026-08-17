import type { AgentId } from "../agents/types";

/**
 * Domain-independent reasoning nodes. Task-specific fields belong in
 * optional `metadata`, never in the core protocol.
 */
export type ReasoningNodeType =
  | "issue"
  | "proposal"
  | "claim"
  | "evidence"
  | "challenge";

export type ReasoningNodeStatus =
  | "open"
  | "accepted"
  | "rejected"
  | "superseded"
  | "unresolved";

export type ReasoningNode = {
  id: string;
  type: ReasoningNodeType;
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
  supersedes?: string;
  metadata?: Record<string, unknown>;
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
      parents?: string[];
      dependencies?: string[];
      /** Turn-local handle; resolved to an engine-allocated id. */
      localId?: string;
    }
  | {
      action: "support" | "challenge" | "accept" | "reject" | "pass";
      targetId?: string;
      reason?: string;
    }
  | {
      action: "revise";
      targetId?: string;
      nodeType?: string;
      text?: string;
      confidence?: number;
      parents?: string[];
      dependencies?: string[];
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
      node: ReasoningNode;
    }
  | {
      type: "support";
      actor: AgentId;
      targetId: string;
      reason: string;
    }
  | {
      type: "challenge";
      actor: AgentId;
      targetId: string;
      reason: string;
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
      replacement: ReasoningNode;
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
  nodes: ReasoningNode[];
  events: ReasoningEvent[];
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

export const REASONING_NODE_TYPES: readonly ReasoningNodeType[] = [
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

export function emptyReasoningGraph(): ReasoningGraph {
  return { nodes: [], events: [] };
}

export function hasStructuredReasoning(value: {
  reasoningNodes?: ReasoningNode[];
  reasoningEvents?: ReasoningEvent[];
}): boolean {
  return (
    Array.isArray(value.reasoningNodes) || Array.isArray(value.reasoningEvents)
  );
}
