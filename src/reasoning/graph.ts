/**
 * Applies structured reasoning intents to the proposal graph.
 *
 * Owns create/revise/stance/final-answer legality and event materialization.
 * Turn parsing is in parseTurn.ts; SVG layout is in layout.ts.
 */
import type { AgentId } from "../agents/types";
import { nextReasoningId } from "./ids";
import {
  REASONING_NODE_TYPES,
  type FinalAnswerSupport,
  type ReasoningEvent,
  type ReasoningGraph,
  type ReasoningIntent,
  type ReasoningNode,
  type ReasoningNodeStatus,
  type ReasoningNodeType,
  type ReasoningOperation,
} from "./types";

const MAX_OPS_PER_TURN = 24;
const MAX_TEXT_CHARS = 2000;
const LOCAL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

export type ApplyIntentsContext = {
  actor: AgentId;
  turnIndex: number;
  messageId: string;
  protocolFailure?: string;
  finalAnswer?: {
    text?: string;
    supportingNodeIds: string[];
  };
};

export type ApplyIntentsResult = {
  graph: ReasoningGraph;
  events: ReasoningEvent[];
  finalAnswerSupport?: FinalAnswerSupport;
};

/** @deprecated Use ApplyIntentsContext. */
export type ApplyOperationsContext = ApplyIntentsContext;

export type ApplyOperationsResult = ApplyIntentsResult;

type MutableGraph = {
  nodes: Map<string, ReasoningNode>;
  events: ReasoningEvent[];
};

type LocalScope = {
  byLocalId: Map<string, string>;
  byIndex: Map<number, string>;
  createReviseCount: number;
};

export function cloneReasoningGraph(graph: ReasoningGraph): ReasoningGraph {
  return {
    nodes: graph.nodes.map(cloneNode),
    events: graph.events.map(cloneEvent),
  };
}

function cloneNode(node: ReasoningNode): ReasoningNode {
  return {
    ...node,
    parents: [...node.parents],
    dependencies: [...node.dependencies],
    metadata: node.metadata ? { ...node.metadata } : undefined,
  };
}

function cloneOperation(op: ReasoningOperation): ReasoningOperation {
  if (op.type === "create") {
    return { type: "create", node: cloneNode(op.node) };
  }
  if (op.type === "revise") {
    return { ...op, replacement: cloneNode(op.replacement) };
  }
  if (op.type === "final_answer") {
    return { ...op, supportingNodeIds: [...op.supportingNodeIds] };
  }
  return { ...op };
}

function cloneIntent(intent: ReasoningIntent): ReasoningIntent {
  if (intent.action === "create" || intent.action === "revise") {
    return {
      ...intent,
      parents: intent.parents ? [...intent.parents] : undefined,
      dependencies: intent.dependencies ? [...intent.dependencies] : undefined,
    };
  }
  if (intent.action === "final_answer") {
    return { ...intent, supportingNodeIds: [...intent.supportingNodeIds] };
  }
  if (intent.action === "invalid") {
    return { action: "invalid", raw: intent.raw };
  }
  return { ...intent };
}

function cloneEvent(event: ReasoningEvent): ReasoningEvent {
  return {
    ...event,
    errors: [...event.errors],
    intent: cloneIntent(event.intent),
    operation: cloneOperation(event.operation),
  };
}

function toGraph(mutable: MutableGraph): ReasoningGraph {
  return {
    nodes: [...mutable.nodes.values()],
    events: mutable.events,
  };
}

export function getNode(
  graph: ReasoningGraph,
  id: string,
): ReasoningNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

export function normalizeNodeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function clampConfidence(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}

function uniqueIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isNodeType(value: unknown): value is ReasoningNodeType {
  return (
    typeof value === "string" &&
    (REASONING_NODE_TYPES as readonly string[]).includes(value)
  );
}

function sanitizeText(text: unknown): string {
  if (typeof text !== "string") return "";
  return text.trim().slice(0, MAX_TEXT_CHARS);
}

function graphHasCycle(
  nodes: Iterable<ReasoningNode>,
  edgesOf: (node: ReasoningNode) => string[],
): boolean {
  const edges = new Map<string, string[]>();
  for (const node of nodes) {
    edges.set(node.id, edgesOf(node));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const node of nodes) {
    if (dfs(node.id)) return true;
  }
  return false;
}

function findDuplicateId(
  nodes: Iterable<ReasoningNode>,
  type: ReasoningNodeType,
  text: string,
  ignoreId?: string,
): string | undefined {
  const needle = normalizeNodeText(text);
  if (!needle) return undefined;
  for (const node of nodes) {
    if (ignoreId && node.id === ignoreId) continue;
    if (node.status === "superseded") continue;
    if (node.type !== type) continue;
    if (normalizeNodeText(node.text) === needle) return node.id;
  }
  return undefined;
}

function liveRevisionId(
  nodes: Iterable<ReasoningNode>,
  id: string,
): string | undefined {
  const list = [...nodes];
  let current = id;
  const seen = new Set<string>();
  while (true) {
    const child = list.find((node) => node.supersedes === current);
    if (!child || seen.has(child.id)) break;
    seen.add(child.id);
    current = child.id;
  }
  return current === id ? undefined : current;
}

function supersededMessage(
  nodes: Iterable<ReasoningNode>,
  targetId: string,
): string {
  const live = liveRevisionId(nodes, targetId);
  return live
    ? `target ${targetId} is superseded; reference the live revision ${live}`
    : `target ${targetId} is superseded; reference the live revision`;
}

/**
 * Latest explicit stance per agent. `pass` is recorded but is not a
 * resolution. `support` / `challenge` are reactions, not global status.
 */
export type NodeStance = {
  actor: AgentId;
  kind: "support" | "challenge" | "accept" | "reject" | "pass";
  reason?: string;
  turnIndex: number;
  messageId: string;
};

const STANCE_OPS = new Set(["support", "challenge", "accept", "reject", "pass"]);

export function stancesForNode(
  graph: ReasoningGraph,
  nodeId: string,
): NodeStance[] {
  const latest = new Map<AgentId, NodeStance>();
  for (const event of graph.events) {
    if (!event.accepted) continue;
    const op = event.operation;
    if (!STANCE_OPS.has(op.type)) continue;
    if (!("targetId" in op) || op.targetId !== nodeId) continue;
    latest.set(op.actor, {
      actor: op.actor,
      kind: op.type as NodeStance["kind"],
      reason: "reason" in op ? op.reason : undefined,
      turnIndex: event.turnIndex,
      messageId: event.messageId,
    });
  }
  return [...latest.values()];
}

function resolutionStatus(
  node: ReasoningNode,
  events: ReasoningEvent[],
): ReasoningNodeStatus | undefined {
  if (
    events.some(
      (event) =>
        event.accepted &&
        event.operation.type === "revise" &&
        event.operation.targetId === node.id,
    )
  ) {
    return "superseded";
  }

  const stances = stancesForNode({ nodes: [node], events }, node.id);
  const resolutions = stances.filter(
    (stance) => stance.kind === "accept" || stance.kind === "reject",
  );
  const acceptors = new Set(
    resolutions.filter((s) => s.kind === "accept").map((s) => s.actor),
  );
  const rejectors = new Set(
    resolutions.filter((s) => s.kind === "reject").map((s) => s.actor),
  );

  if (rejectors.has(node.createdBy) || (rejectors.has("agent_a") && rejectors.has("agent_b"))) {
    return "rejected";
  }
  if (acceptors.has("agent_a") && acceptors.has("agent_b")) {
    return "accepted";
  }
  return undefined;
}

function refreshStatuses(mutable: MutableGraph): void {
  const events = mutable.events;
  for (const [id, node] of mutable.nodes) {
    const resolved = resolutionStatus(node, events);
    if (resolved && resolved !== node.status) {
      mutable.nodes.set(id, { ...node, status: resolved });
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of mutable.nodes) {
      if (
        node.status === "superseded" ||
        node.status === "rejected" ||
        node.status === "accepted"
      ) {
        continue;
      }
      const blocking = node.dependencies.filter((depId) => {
        const dep = mutable.nodes.get(depId);
        return !dep || dep.status !== "accepted";
      });
      const next: ReasoningNodeStatus =
        blocking.length > 0 ? "unresolved" : "open";
      if (next !== node.status) {
        mutable.nodes.set(id, { ...node, status: next });
        changed = true;
      }
    }
  }
}

function applyAcceptedOperation(
  nodes: Map<string, ReasoningNode>,
  operation: ReasoningOperation,
): void {
  if (operation.type === "create") {
    nodes.set(operation.node.id, cloneNode(operation.node));
    return;
  }
  if (operation.type === "revise") {
    nodes.set(operation.replacement.id, cloneNode(operation.replacement));
    const target = nodes.get(operation.targetId);
    if (target) {
      nodes.set(operation.targetId, { ...target, status: "superseded" });
    }
  }
}

/**
 * Rebuild derived node state from the canonical event log.
 * Rejected events are kept on the graph but do not mutate nodes.
 */
export function materializeGraph(events: ReasoningEvent[]): ReasoningGraph {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const nodes = new Map<string, ReasoningNode>();
  for (const event of sorted) {
    if (!event.accepted) continue;
    applyAcceptedOperation(nodes, event.operation);
  }
  const mutable: MutableGraph = { nodes, events: sorted.map(cloneEvent) };
  refreshStatuses(mutable);
  return toGraph(mutable);
}

/**
 * Prefer the event log as source of truth. Node snapshots are a cache:
 * when events are present they are replayed. Legacy records that only
 * stored nodes are returned as-is.
 */
export function hydrateReasoningGraph(raw: {
  reasoningNodes?: ReasoningNode[];
  reasoningEvents?: ReasoningEvent[];
}): ReasoningGraph {
  const events = raw.reasoningEvents ?? [];
  const nodes = raw.reasoningNodes ?? [];
  if (events.length > 0) {
    return materializeGraph(events);
  }
  return {
    nodes: nodes.map(cloneNode),
    events: [],
  };
}

function emptyScope(): LocalScope {
  return {
    byLocalId: new Map(),
    byIndex: new Map(),
    createReviseCount: 0,
  };
}

function resolveRef(
  ref: string,
  mutable: MutableGraph,
  scope: LocalScope,
): { id?: string; error?: string } {
  const trimmed = ref.trim();
  if (!trimmed) return { error: "empty reference" };
  const local = scope.byLocalId.get(trimmed);
  if (local) return { id: local };
  const dollar = trimmed.match(/^\$(\d+)$/);
  if (dollar) {
    const mapped = scope.byIndex.get(Number(dollar[1]));
    if (!mapped) {
      return { error: `local reference ${trimmed} was not created` };
    }
    return { id: mapped };
  }
  if (mutable.nodes.has(trimmed)) return { id: trimmed };
  return { error: `unknown target ${trimmed}` };
}

function resolveIdList(
  refs: string[] | undefined,
  mutable: MutableGraph,
  scope: LocalScope,
  kind: string,
): { ids: string[]; errors: string[] } {
  const errors: string[] = [];
  const ids: string[] = [];
  for (const ref of refs ?? []) {
    const resolved = resolveRef(ref, mutable, scope);
    if (resolved.error) {
      errors.push(`${kind}: ${resolved.error}`);
      continue;
    }
    if (resolved.id) ids.push(resolved.id);
  }
  return { ids: uniqueIds(ids), errors };
}

function registerLocal(
  scope: LocalScope,
  localId: string | undefined,
  allocatedId: string,
): string | undefined {
  scope.createReviseCount += 1;
  scope.byIndex.set(scope.createReviseCount, allocatedId);
  if (!localId) return undefined;
  const trimmed = localId.trim();
  if (!LOCAL_ID_PATTERN.test(trimmed)) {
    return `invalid localId "${trimmed}"`;
  }
  if (scope.byLocalId.has(trimmed)) {
    return `localId "${trimmed}" is already used in this turn`;
  }
  scope.byLocalId.set(trimmed, allocatedId);
  return undefined;
}

function invalidOperation(
  ctx: ApplyIntentsContext,
  targetId?: string,
): ReasoningOperation {
  return { type: "invalid", actor: ctx.actor, targetId };
}

function appendEvent(
  mutable: MutableGraph,
  ctx: ApplyIntentsContext,
  intent: ReasoningIntent,
  operation: ReasoningOperation,
  accepted: boolean,
  errors: string[],
): ReasoningEvent {
  const seq = mutable.events.length + 1;
  const event: ReasoningEvent = {
    id: `rev-${seq}`,
    seq,
    turnIndex: ctx.turnIndex,
    messageId: ctx.messageId,
    actor: ctx.actor,
    intent: cloneIntent(intent),
    operation: cloneOperation(operation),
    accepted,
    errors: [...errors],
  };
  mutable.events.push(event);
  return event;
}

function targetLegality(
  mutable: MutableGraph,
  targetId: string,
  action: string,
): string[] {
  const target = mutable.nodes.get(targetId);
  if (!target) return [`unknown target ${targetId}`];
  if (target.status === "superseded") {
    return [supersededMessage(mutable.nodes.values(), targetId)];
  }
  if (target.status === "rejected") {
    if (action === "revise" || action === "pass" || action === "reject") {
      return [];
    }
    return [
      `target ${targetId} is rejected; revise it to reopen rather than ${action}`,
    ];
  }
  return [];
}

function prepareNewNode(
  args: {
    type: ReasoningNodeType;
    text: string;
    parents: string[];
    dependencies: string[];
    confidence?: number;
    supersedes?: string;
  },
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  ignoreDuplicateId?: string,
): { node?: ReasoningNode; errors: string[] } {
  const errors: string[] = [];
  const duplicateOf = findDuplicateId(
    mutable.nodes.values(),
    args.type,
    args.text,
    ignoreDuplicateId,
  );
  if (duplicateOf) {
    return {
      errors: [
        `duplicate of ${duplicateOf}; reference the existing node instead of recreating it`,
      ],
    };
  }

  const id = nextReasoningId(args.type, mutable.nodes.keys());
  const parents = args.parents.filter((parentId) => parentId !== id);
  const dependencies = args.dependencies.filter((depId) => depId !== id);

  if (args.parents.includes(id) || parents.includes(id)) {
    errors.push(`${id} cannot be its own parent`);
  }
  if (args.dependencies.includes(id) || dependencies.includes(id)) {
    errors.push(`${id} cannot depend on itself`);
  }

  const missingParents = parents.filter((parentId) => !mutable.nodes.has(parentId));
  const missingDeps = dependencies.filter((depId) => !mutable.nodes.has(depId));
  if (missingParents.length > 0) {
    errors.push(`unknown parents: ${missingParents.join(", ")}`);
  }
  if (missingDeps.length > 0) {
    errors.push(`unknown dependencies: ${missingDeps.join(", ")}`);
  }

  for (const parentId of parents) {
    const parent = mutable.nodes.get(parentId);
    if (parent?.status === "superseded") {
      errors.push(supersededMessage(mutable.nodes.values(), parentId));
    }
  }
  for (const depId of dependencies) {
    const dep = mutable.nodes.get(depId);
    if (dep?.status === "superseded") {
      errors.push(supersededMessage(mutable.nodes.values(), depId));
    }
  }

  const preview: ReasoningNode = {
    id,
    type: args.type,
    text: args.text,
    createdBy: ctx.actor,
    createdAtTurn: ctx.turnIndex,
    sourceMessageId: ctx.messageId,
    confidence: clampConfidence(args.confidence),
    status: "open",
    parents,
    dependencies,
    supersedes: args.supersedes,
  };

  const withPreview = [...mutable.nodes.values(), preview];
  if (graphHasCycle(withPreview, (node) => node.dependencies)) {
    errors.push(`dependency cycle involving ${id}`);
  }
  if (graphHasCycle(withPreview, (node) => node.parents)) {
    errors.push(`parent cycle involving ${id}`);
  }

  if (errors.length > 0) return { errors };
  return { node: preview, errors: [] };
}

function applyCreate(
  intent: Extract<ReasoningIntent, { action: "create" }>,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): { accepted: boolean; errors: string[]; stored: ReasoningOperation } {
  const errors: string[] = [];
  const type = isNodeType(intent.nodeType) ? intent.nodeType : undefined;
  if (!type) errors.push("create is missing a valid node type");
  const text = sanitizeText(intent.text);
  if (!text) errors.push("create is missing node text");
  if (intent.localId) {
    const lid = intent.localId.trim();
    if ((intent.parents ?? []).some((ref) => ref.trim() === lid)) {
      errors.push(`${lid} cannot be its own parent`);
    }
    if ((intent.dependencies ?? []).some((ref) => ref.trim() === lid)) {
      errors.push(`${lid} cannot depend on itself`);
    }
  }
  if (!type || !text) {
    return {
      accepted: false,
      errors,
      stored: invalidOperation(ctx),
    };
  }

  const parents = resolveIdList(intent.parents, mutable, scope, "parents");
  const deps = resolveIdList(intent.dependencies, mutable, scope, "dependencies");
  errors.push(...parents.errors, ...deps.errors);

  const prepared = prepareNewNode(
    {
      type,
      text,
      parents: parents.ids,
      dependencies: deps.ids,
      confidence: intent.confidence,
    },
    ctx,
    mutable,
  );
  errors.push(...prepared.errors);
  if (!prepared.node || errors.length > 0) {
    return { accepted: false, errors, stored: invalidOperation(ctx) };
  }

  const localError = registerLocal(scope, intent.localId, prepared.node.id);
  if (localError) {
    return { accepted: false, errors: [...errors, localError], stored: invalidOperation(ctx) };
  }

  mutable.nodes.set(prepared.node.id, prepared.node);
  return {
    accepted: true,
    errors: [],
    stored: { type: "create", node: prepared.node },
  };
}

function applyRevise(
  intent: Extract<ReasoningIntent, { action: "revise" }>,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): { accepted: boolean; errors: string[]; stored: ReasoningOperation } {
  const targetRaw = intent.targetId?.trim();
  if (!targetRaw) {
    return {
      accepted: false,
      errors: ["revise is missing targetId"],
      stored: invalidOperation(ctx),
    };
  }
  const resolved = resolveRef(targetRaw, mutable, scope);
  if (resolved.error || !resolved.id) {
    return {
      accepted: false,
      errors: [resolved.error ?? `unknown target ${targetRaw}`],
      stored: invalidOperation(ctx, targetRaw),
    };
  }
  const legality = targetLegality(mutable, resolved.id, "revise");
  if (legality.length > 0) {
    return {
      accepted: false,
      errors: legality,
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const target = mutable.nodes.get(resolved.id)!;
  const type = isNodeType(intent.nodeType) ? intent.nodeType : target.type;
  const text = sanitizeText(intent.text);
  if (!text) {
    return {
      accepted: false,
      errors: ["revise is missing replacement text"],
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const parents = resolveIdList(intent.parents, mutable, scope, "parents");
  const deps = resolveIdList(intent.dependencies, mutable, scope, "dependencies");
  const errors = [...parents.errors, ...deps.errors];
  const parentIds =
    (intent.parents?.length ?? 0) > 0
      ? uniqueIds([resolved.id, ...parents.ids])
      : uniqueIds([resolved.id, ...target.parents]);
  const depIds =
    intent.dependencies !== undefined ? deps.ids : [...target.dependencies];

  const prepared = prepareNewNode(
    {
      type,
      text,
      parents: parentIds,
      dependencies: depIds,
      confidence: intent.confidence ?? target.confidence,
      supersedes: target.id,
    },
    ctx,
    mutable,
    target.id,
  );
  errors.push(...prepared.errors);
  if (!prepared.node || errors.length > 0) {
    return {
      accepted: false,
      errors,
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const localError = registerLocal(scope, intent.localId, prepared.node.id);
  if (localError) {
    return {
      accepted: false,
      errors: [...errors, localError],
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const replacement: ReasoningNode = {
    ...prepared.node,
    supersedes: target.id,
    parents: uniqueIds(
      prepared.node.parents.includes(target.id)
        ? prepared.node.parents
        : [target.id, ...prepared.node.parents],
    ),
  };
  mutable.nodes.set(replacement.id, replacement);
  mutable.nodes.set(target.id, { ...target, status: "superseded" });
  return {
    accepted: true,
    errors: [],
    stored: {
      type: "revise",
      actor: ctx.actor,
      targetId: target.id,
      replacement,
      reason: intent.reason?.trim() || undefined,
    },
  };
}

function applyStance(
  intent: Extract<
    ReasoningIntent,
    { action: "support" | "challenge" | "accept" | "reject" | "pass" }
  >,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): { accepted: boolean; errors: string[]; stored: ReasoningOperation } {
  const targetRaw = intent.targetId?.trim();
  if (!targetRaw) {
    return {
      accepted: false,
      errors: [`${intent.action} is missing targetId`],
      stored: invalidOperation(ctx),
    };
  }
  const resolved = resolveRef(targetRaw, mutable, scope);
  if (resolved.error || !resolved.id) {
    return {
      accepted: false,
      errors: [resolved.error ?? `unknown target ${targetRaw}`],
      stored: invalidOperation(ctx, targetRaw),
    };
  }
  const legality = targetLegality(mutable, resolved.id, intent.action);
  if (legality.length > 0) {
    return {
      accepted: false,
      errors: legality,
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const reason = intent.reason?.trim() ?? "";
  if (intent.action === "reject" && !reason) {
    return {
      accepted: false,
      errors: ["reject requires a reason"],
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const stored = {
    type: intent.action,
    actor: ctx.actor,
    targetId: resolved.id,
    reason: reason || undefined,
  } as ReasoningOperation;
  return { accepted: true, errors: [], stored };
}

function applyOneIntent(
  intent: ReasoningIntent,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): { accepted: boolean; errors: string[]; stored: ReasoningOperation } {
  if (intent.action === "invalid") {
    return {
      accepted: false,
      errors: ["malformed reasoning intent"],
      stored: invalidOperation(ctx),
    };
  }
  if (intent.action === "protocol_failure") {
    return {
      accepted: false,
      errors: [intent.reason],
      stored: {
        type: "protocol_failure",
        actor: ctx.actor,
        reason: intent.reason,
      },
    };
  }
  if (intent.action === "final_answer") {
    return {
      accepted: false,
      errors: ["finalAnswer belongs on the turn envelope, not in reasoningIntents"],
      stored: invalidOperation(ctx),
    };
  }
  if (intent.action === "create") {
    return applyCreate(intent, ctx, mutable, scope);
  }
  if (intent.action === "revise") {
    return applyRevise(intent, ctx, mutable, scope);
  }
  return applyStance(intent, ctx, mutable, scope);
}

export function validateFinalAnswerSupport(
  graph: ReasoningGraph,
  raw: { text?: string; supportingNodeIds: string[] } | undefined,
): FinalAnswerSupport | undefined {
  if (!raw) return undefined;
  const supportingNodeIds = uniqueIds(raw.supportingNodeIds);
  const errors: string[] = [];
  for (const id of supportingNodeIds) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) {
      errors.push(`${id} does not exist`);
      continue;
    }
    if (node.status === "superseded") {
      errors.push(supersededMessage(graph.nodes, id));
    } else if (node.status === "rejected") {
      errors.push(`${id} is rejected`);
    }
  }
  return {
    text: raw.text,
    supportingNodeIds,
    errors,
  };
}

function applyFinalAnswer(
  mutable: MutableGraph,
  ctx: ApplyIntentsContext,
): FinalAnswerSupport | undefined {
  if (!ctx.finalAnswer) return undefined;
  refreshStatuses(mutable);
  const support = validateFinalAnswerSupport(toGraph(mutable), ctx.finalAnswer);
  if (!support) return undefined;
  appendEvent(
    mutable,
    ctx,
    {
      action: "final_answer",
      text: support.text,
      supportingNodeIds: support.supportingNodeIds,
    },
    {
      type: "final_answer",
      actor: ctx.actor,
      text: support.text,
      supportingNodeIds: support.supportingNodeIds,
    },
    support.errors.length === 0,
    support.errors.length > 0
      ? support.errors.map((error) => `Supporting-node linkage invalid: ${error}`)
      : [],
  );
  return support;
}

/**
 * Apply model-authored intents through the deterministic rule engine.
 * Always materializes prior state from the event log first.
 */
export function applyReasoningIntents(
  graph: ReasoningGraph,
  intents: ReasoningIntent[],
  ctx: ApplyIntentsContext,
): ApplyIntentsResult {
  const mutable: MutableGraph = {
    nodes: new Map(
      materializeGraph(graph.events).nodes.map((node) => [node.id, cloneNode(node)]),
    ),
    events: graph.events.map(cloneEvent),
  };
  if (graph.events.length === 0 && graph.nodes.length > 0) {
    for (const node of graph.nodes) {
      mutable.nodes.set(node.id, cloneNode(node));
    }
  }

  const applied: ReasoningEvent[] = [];
  const scope = emptyScope();

  if (ctx.protocolFailure) {
    applied.push(
      appendEvent(
        mutable,
        ctx,
        { action: "protocol_failure", reason: ctx.protocolFailure },
        {
          type: "protocol_failure",
          actor: ctx.actor,
          reason: ctx.protocolFailure,
        },
        false,
        [ctx.protocolFailure],
      ),
    );
  }

  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i]!;
    if (i >= MAX_OPS_PER_TURN) {
      applied.push(
        appendEvent(
          mutable,
          ctx,
          intent,
          invalidOperation(ctx),
          false,
          [`ignored: over the per-turn cap of ${MAX_OPS_PER_TURN}`],
        ),
      );
      continue;
    }
    const result = applyOneIntent(intent, ctx, mutable, scope);
    applied.push(
      appendEvent(
        mutable,
        ctx,
        intent,
        result.stored,
        result.accepted,
        result.errors,
      ),
    );
    refreshStatuses(mutable);
  }

  const finalAnswerSupport = applyFinalAnswer(mutable, ctx);
  if (finalAnswerSupport) {
    const last = mutable.events[mutable.events.length - 1];
    if (last?.operation.type === "final_answer") applied.push(last);
  }

  const next = materializeGraph(mutable.events);
  return { graph: next, events: applied, finalAnswerSupport };
}

/** @deprecated Prefer {@link applyReasoningIntents}. */
export function applyReasoningOperations(
  graph: ReasoningGraph,
  operations: ReasoningOperation[],
  ctx: ApplyOperationsContext,
): ApplyOperationsResult {
  const intents: ReasoningIntent[] = operations.map((op) => {
    if (op.type === "create") {
      return {
        action: "create" as const,
        nodeType: op.node.type,
        text: op.node.text,
        confidence: op.node.confidence,
        parents: op.node.parents,
        dependencies: op.node.dependencies,
      };
    }
    if (op.type === "revise") {
      return {
        action: "revise" as const,
        targetId: op.targetId,
        nodeType: op.replacement.type,
        text: op.replacement.text,
        confidence: op.replacement.confidence,
        parents: op.replacement.parents,
        dependencies: op.replacement.dependencies,
        reason: op.reason,
      };
    }
    if (op.type === "protocol_failure") {
      return { action: "protocol_failure" as const, reason: op.reason };
    }
    if (op.type === "final_answer") {
      return {
        action: "final_answer" as const,
        text: op.text,
        supportingNodeIds: op.supportingNodeIds,
      };
    }
    if (op.type === "invalid") {
      return { action: "invalid" as const };
    }
    return {
      action: op.type,
      targetId: op.targetId,
      reason: "reason" in op ? op.reason : undefined,
    };
  });
  return applyReasoningIntents(graph, intents, ctx);
}
