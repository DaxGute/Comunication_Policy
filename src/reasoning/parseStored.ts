import type { AgentId } from "../agents/types";
import { parseReasoningIntent } from "./parseTurn";
import {
  REASONING_NODE_STATUSES,
  REASONING_NODE_TYPES,
  REASONING_OPERATION_TYPES,
  type ReasoningEvent,
  type ReasoningGraph,
  type ReasoningIntent,
  type ReasoningNode,
  type ReasoningNodeStatus,
  type ReasoningNodeType,
  type ReasoningOperation,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentId(value: unknown): value is AgentId {
  return value === "agent_a" || value === "agent_b";
}

function isNodeType(value: unknown): value is ReasoningNodeType {
  return (
    typeof value === "string" &&
    (REASONING_NODE_TYPES as readonly string[]).includes(value)
  );
}

function isStatus(value: unknown): value is ReasoningNodeStatus {
  return (
    typeof value === "string" &&
    (REASONING_NODE_STATUSES as readonly string[]).includes(value)
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseReasoningNode(raw: unknown): ReasoningNode | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !isNodeType(raw.type)) return undefined;
  if (typeof raw.text !== "string") return undefined;
  if (!isAgentId(raw.createdBy)) return undefined;
  if (typeof raw.createdAtTurn !== "number" || !Number.isFinite(raw.createdAtTurn)) {
    return undefined;
  }
  return {
    id: raw.id,
    type: raw.type,
    text: raw.text,
    createdBy: raw.createdBy,
    createdAtTurn: Math.max(0, Math.round(raw.createdAtTurn)),
    sourceMessageId:
      typeof raw.sourceMessageId === "string" ? raw.sourceMessageId : undefined,
    confidence:
      typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
        ? raw.confidence
        : undefined,
    status: isStatus(raw.status) ? raw.status : "open",
    parents: asStringArray(raw.parents),
    dependencies: asStringArray(raw.dependencies),
    supersedes: typeof raw.supersedes === "string" ? raw.supersedes : undefined,
    metadata: isRecord(raw.metadata) ? raw.metadata : undefined,
  };
}

function parseOperation(raw: unknown): ReasoningOperation | undefined {
  if (!isRecord(raw) || typeof raw.type !== "string") return undefined;
  if (!(REASONING_OPERATION_TYPES as readonly string[]).includes(raw.type)) {
    return undefined;
  }
  if (raw.type === "create") {
    const node = parseReasoningNode(raw.node);
    if (!node) return undefined;
    return { type: "create", node };
  }
  if (raw.type === "protocol_failure") {
    if (!isAgentId(raw.actor)) return undefined;
    return {
      type: "protocol_failure",
      actor: raw.actor,
      reason: typeof raw.reason === "string" ? raw.reason : "protocol failure",
    };
  }
  if (raw.type === "invalid") {
    if (!isAgentId(raw.actor)) return undefined;
    return {
      type: "invalid",
      actor: raw.actor,
      targetId: typeof raw.targetId === "string" ? raw.targetId : undefined,
    };
  }
  if (raw.type === "final_answer") {
    if (!isAgentId(raw.actor)) return undefined;
    return {
      type: "final_answer",
      actor: raw.actor,
      text: typeof raw.text === "string" ? raw.text : undefined,
      supportingNodeIds: asStringArray(raw.supportingNodeIds),
    };
  }
  if (!isAgentId(raw.actor) || typeof raw.targetId !== "string") return undefined;
  if (raw.type === "revise") {
    const replacement = parseReasoningNode(raw.replacement);
    if (!replacement) return undefined;
    return {
      type: "revise",
      actor: raw.actor,
      targetId: raw.targetId,
      replacement,
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
    };
  }
  if (raw.type === "support" || raw.type === "challenge" || raw.type === "reject") {
    if (typeof raw.reason !== "string") return undefined;
    return {
      type: raw.type,
      actor: raw.actor,
      targetId: raw.targetId,
      reason: raw.reason,
    };
  }
  if (raw.type === "accept" || raw.type === "pass") {
    return {
      type: raw.type,
      actor: raw.actor,
      targetId: raw.targetId,
      reason: typeof raw.reason === "string" ? raw.reason : undefined,
    };
  }
  return undefined;
}

export function parseReasoningOperation(
  raw: unknown,
): ReasoningOperation | undefined {
  return parseOperation(raw);
}

function intentFromOperation(operation: ReasoningOperation): ReasoningIntent {
  if (operation.type === "create") {
    return {
      action: "create",
      nodeType: operation.node.type,
      text: operation.node.text,
      confidence: operation.node.confidence,
      parents: operation.node.parents,
      dependencies: operation.node.dependencies,
    };
  }
  if (operation.type === "revise") {
    return {
      action: "revise",
      targetId: operation.targetId,
      nodeType: operation.replacement.type,
      text: operation.replacement.text,
      confidence: operation.replacement.confidence,
      parents: operation.replacement.parents,
      dependencies: operation.replacement.dependencies,
      reason: operation.reason,
    };
  }
  if (operation.type === "protocol_failure") {
    return { action: "protocol_failure", reason: operation.reason };
  }
  if (operation.type === "final_answer") {
    return {
      action: "final_answer",
      text: operation.text,
      supportingNodeIds: operation.supportingNodeIds,
    };
  }
  if (operation.type === "invalid") {
    return { action: "invalid" };
  }
  return {
    action: operation.type,
    targetId: operation.targetId,
    reason: "reason" in operation ? operation.reason : undefined,
  };
}

export function parseReasoningEvent(raw: unknown): ReasoningEvent | undefined {
  if (!isRecord(raw)) return undefined;
  const operation = parseOperation(raw.operation);
  if (!operation) return undefined;
  if (typeof raw.id !== "string") return undefined;
  if (!isAgentId(raw.actor)) return undefined;
  if (typeof raw.turnIndex !== "number" || !Number.isFinite(raw.turnIndex)) {
    return undefined;
  }
  if (typeof raw.messageId !== "string") return undefined;
  const intent = raw.intent !== undefined
    ? parseReasoningIntent(raw.intent)
    : intentFromOperation(operation);
  return {
    id: raw.id,
    seq:
      typeof raw.seq === "number" && Number.isFinite(raw.seq)
        ? Math.max(0, Math.round(raw.seq))
        : 0,
    turnIndex: Math.max(0, Math.round(raw.turnIndex)),
    messageId: raw.messageId,
    actor: raw.actor,
    intent,
    operation,
    accepted: raw.accepted !== false,
    errors: asStringArray(raw.errors),
  };
}

export function parseReasoningGraph(raw: {
  reasoningNodes?: unknown;
  reasoningEvents?: unknown;
}): ReasoningGraph | undefined {
  const nodesRaw = Array.isArray(raw.reasoningNodes) ? raw.reasoningNodes : undefined;
  const eventsRaw = Array.isArray(raw.reasoningEvents)
    ? raw.reasoningEvents
    : undefined;
  if (!nodesRaw && !eventsRaw) return undefined;
  return {
    nodes: (nodesRaw ?? [])
      .map(parseReasoningNode)
      .filter((n): n is ReasoningNode => Boolean(n)),
    events: (eventsRaw ?? [])
      .map(parseReasoningEvent)
      .filter((e): e is ReasoningEvent => Boolean(e)),
  };
}
