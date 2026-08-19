/**
 * Applies structured reasoning intents to the reasoning graph.
 *
 * Owns create/revise/stance/final-answer legality and event materialization.
 * Turn parsing is in parseTurn.ts; SVG layout is in layout.ts.
 */
import type { AgentId } from "../agents/types";
import { nextReasoningId } from "./ids";
import { resolveKnownSubjectId } from "./subjectRef";
import {
  REASONING_NODE_TYPES,
  type AtomicReasoningNode,
  type AtomicReasoningNodeType,
  type DeterministicReasoningSignal,
  type EvidenceOrigin,
  type FinalAnswerSupport,
  type FinalAnswerNode,
  type GroundingLink,
  type IssueConflict,
  type ReasoningActor,
  type ReasoningEdge,
  type ReasoningEvent,
  type ReasoningGraph,
  type ReasoningIntent,
  type ReasoningNode,
  type ReasoningNodeStatus,
  type ReasoningOperation,
  type ReasoningSubject,
} from "./types";
import {
  findParaphraseId,
  isCandidateType,
  validateCommitConfidence,
  validateCommittedProposition,
} from "./validateProposition";

const MAX_OPS_PER_TURN = 64;
const MAX_TEXT_CHARS = 2000;
const FINAL_ANSWER_NODE_ID = "__final_answer__";
const LOCAL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

export type ApplyIntentsContext = {
  actor: ReasoningActor;
  turnIndex: number;
  messageId: string;
  protocolFailure?: string;
  finalAnswer?: {
    text?: string;
    supportingNodeIds: string[];
  };
  /** Adapter-produced structural triggers that may legitimately reopen issues. */
  reopenSignals?: DeterministicReasoningSignal[];
  /** Adapter-owned identity for candidate duplicate/revisit detection. */
  candidateIdentity?: (
    node: Pick<AtomicReasoningNode, "type" | "text" | "subjectId" | "metadata">,
  ) => string | undefined;
  /** Adapter structural gate (e.g. crossword length / format). */
  validateCandidate?: (
    node: Pick<AtomicReasoningNode, "type" | "text" | "subjectId" | "metadata">,
  ) => { ok: boolean; reasons?: string[] };
  /** Known task conflicts at the start of this turn. */
  conflicts?: IssueConflict[];
  resolveSubjectAlias?: (raw: string) => { id?: string; error?: string };
  resolveBasis?: (
    raw: string,
    subjectId?: string,
  ) => { id?: string; relation?: "grounds" | "supports"; error?: string };
  autoGround?: (subjectId: string) => { nodeId: string; relation: "grounds" | "supports" } | undefined;
  extraDiagnostics?: string[];
  /**
   * Task-specific reconstruction of final-answer ancestry from surviving
   * graph ideas. Generic fallback cites live claims when the model omits ids.
   */
  reconcileFinalAnswer?: (
    text: string | undefined,
    supportingNodeIds: string[],
    graph: ReasoningGraph,
  ) => { supportingNodeIds: string[]; errors: string[] };
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
  subjects: ReasoningSubject[];
  nodes: Map<string, ReasoningNode>;
  events: ReasoningEvent[];
};

type LocalScope = {
  byLocalId: Map<string, string>;
  byIndex: Map<number, string>;
  createReviseCount: number;
  /** Subjects that already received a committed idea create this turn. */
  committedSubjects: Set<string>;
};

export function cloneReasoningGraph(graph: ReasoningGraph): ReasoningGraph {
  return {
    subjects: graph.subjects?.map((subject) => ({
      ...subject,
      metadata: subject.metadata ? { ...subject.metadata } : undefined,
    })),
    nodes: graph.nodes.map(cloneNode),
    events: graph.events.map(cloneEvent),
    edges: graph.edges?.map((edge) => ({ ...edge })) ?? [],
  };
}

function cloneNode(node: AtomicReasoningNode): AtomicReasoningNode;
function cloneNode(node: FinalAnswerNode): FinalAnswerNode;
function cloneNode(node: ReasoningNode): ReasoningNode;
function cloneNode(node: ReasoningNode): ReasoningNode {
  if (node.type === "final_answer") {
    return {
      ...node,
      parents: [...node.parents],
      dependencies: [],
      supportingNodeIds: [...node.supportingNodeIds],
      supportErrors: [...node.supportErrors],
    };
  }
  return {
    ...node,
    parents: [...node.parents],
    dependencies: [...node.dependencies],
    metadata: node.metadata ? { ...node.metadata } : undefined,
    evidenceOrigin: node.evidenceOrigin,
  };
}

function cloneOperation(op: ReasoningOperation): ReasoningOperation {
  if (op.type === "create") {
    return {
      type: "create",
      node: cloneNode(op.node),
      replacedActiveNodeId: op.replacedActiveNodeId,
      grounding: op.grounding?.map((item) => ({ ...item })),
    };
  }
  if (op.type === "revise") {
    return {
      ...op,
      replacement: cloneNode(op.replacement),
      replacedActiveNodeId: op.replacedActiveNodeId,
      grounding: op.grounding?.map((item) => ({ ...item })),
    };
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
      groundsNodeIds: intent.groundsNodeIds ? [...intent.groundsNodeIds] : undefined,
      supportsNodeIds: intent.supportsNodeIds ? [...intent.supportsNodeIds] : undefined,
      basis: intent.basis ? [...intent.basis] : undefined,
      metadata: intent.metadata ? { ...intent.metadata } : undefined,
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
    diagnostics: event.diagnostics ? [...event.diagnostics] : undefined,
    intent: cloneIntent(event.intent),
    operation: cloneOperation(event.operation),
  };
}

function toGraph(mutable: MutableGraph): ReasoningGraph {
  return {
    subjects: mutable.subjects.map((subject) => ({
      ...subject,
      metadata: subject.metadata ? { ...subject.metadata } : undefined,
    })),
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

function isNodeType(value: unknown): value is AtomicReasoningNodeType {
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
  type: AtomicReasoningNodeType,
  text: string,
  subjectId: string | undefined,
  ignoreId: string | undefined,
  identity: string | undefined,
  identityOf: (node: ReasoningNode) => string | undefined,
): string | undefined {
  if (identity) {
    for (const node of nodes) {
      if (ignoreId && node.id === ignoreId) continue;
      if (node.status === "superseded" || node.status === "rejected") continue;
      if (node.type !== "claim" && node.type !== "proposal") continue;
      if (identityOf(node) === identity) return node.id;
    }
    return undefined;
  }
  const needle = normalizeNodeText(text);
  if (!needle) return undefined;
  for (const node of nodes) {
    if (ignoreId && node.id === ignoreId) continue;
    if (node.status === "superseded") continue;
    if (node.type !== type) continue;
    if (node.subjectId !== subjectId) continue;
    if (normalizeNodeText(node.text) === needle) {
      return node.id;
    }
  }
  return undefined;
}

function isCandidateNode(node: ReasoningNode): node is AtomicReasoningNode {
  return node.type === "claim" || node.type === "proposal";
}

function candidateIdentityOf(
  ctx: ApplyIntentsContext,
  node: ReasoningNode,
): string | undefined {
  if (node.type === "final_answer") return undefined;
  return ctx.candidateIdentity?.({
    type: node.type,
    text: node.text,
    subjectId: node.subjectId,
    metadata: node.metadata,
  });
}

function historicalIdentityNodes(
  nodes: Iterable<ReasoningNode>,
  identity: string,
  identityOf: (node: ReasoningNode) => string | undefined,
  exceptId?: string,
): ReasoningNode[] {
  return [...nodes].filter(
    (node) =>
      node.id !== exceptId &&
      (node.status === "rejected" || node.status === "superseded") &&
      identityOf(node) === identity,
  );
}

function liveIdentityNode(
  nodes: Iterable<ReasoningNode>,
  identity: string,
  identityOf: (node: ReasoningNode) => string | undefined,
  exceptId?: string,
): ReasoningNode | undefined {
  for (const node of nodes) {
    if (exceptId && node.id === exceptId) continue;
    if (node.status === "superseded" || node.status === "rejected") continue;
    if (node.type !== "claim" && node.type !== "proposal") continue;
    if (identityOf(node) === identity) return node;
  }
  return undefined;
}

function hasNovelAgentEvidence(
  mutable: MutableGraph,
  ctx: ApplyIntentsContext,
): boolean {
  const priorTexts = new Set(
    [...mutable.nodes.values()]
      .filter(
        (node) =>
          node.type === "evidence" && node.createdAtTurn < ctx.turnIndex,
      )
      .map((node) => normalizeNodeText(node.text)),
  );
  return [...mutable.nodes.values()].some(
    (node) =>
      node.type === "evidence" &&
      node.createdAtTurn === ctx.turnIndex &&
      node.evidenceOrigin === "agent" &&
      !priorTexts.has(normalizeNodeText(node.text)),
  );
}

type IntentApplyResult = {
  accepted: boolean;
  stateChanged?: boolean;
  errors: string[];
  stored: ReasoningOperation;
  diagnostics?: string[];
};

function noStateChangeResult(
  stored: ReasoningOperation,
  detail: string,
  diagnostics: string[] = [],
): IntentApplyResult {
  return {
    accepted: true,
    stateChanged: false,
    errors: [],
    stored,
    diagnostics: [`no_state_change: ${detail}`, ...diagnostics],
  };
}

function liveRevisionId(
  nodes: Iterable<ReasoningNode>,
  id: string,
): string | undefined {
  const list = [...nodes];
  let current = id;
  const seen = new Set<string>();
  while (true) {
    const child = list.find(
      (node) => node.type !== "final_answer" && node.supersedes === current,
    );
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
    if (op.actor !== "agent_a" && op.actor !== "agent_b") continue;
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
  if (node.type === "final_answer") return "accepted";
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

  if (
    (node.createdBy === "agent_a" || node.createdBy === "agent_b") &&
    (rejectors.has(node.createdBy) ||
      (rejectors.has("agent_a") && rejectors.has("agent_b")))
  ) {
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

function edgeFromEvent(
  event: ReasoningEvent,
  type: ReasoningEdge["type"],
  sourceNodeId: string,
  targetNodeId: string,
  reason?: string,
  legacy = false,
): ReasoningEdge {
  return {
    id: `redge-${event.seq}-${type}-${sourceNodeId}-${targetNodeId}`,
    type,
    sourceNodeId,
    targetNodeId,
    createdBy: event.actor,
    createdAtTurn: event.turnIndex,
    sourceMessageId: event.messageId,
    sourceEventId: event.id,
    reason,
    legacy,
  };
}

function materializeEdges(events: ReasoningEvent[]): ReasoningEdge[] {
  const edges: ReasoningEdge[] = [];
  const seen = new Set<string>();
  const add = (edge: ReasoningEdge) => {
    const key = `${edge.type}:${edge.sourceNodeId}->${edge.targetNodeId}:${edge.sourceEventId}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };
  for (const event of events) {
    const op = event.operation;
    if (op.type === "final_answer") {
      for (const sourceId of op.supportingNodeIds) {
        add(
          edgeFromEvent(
            event,
            "supports",
            sourceId,
            FINAL_ANSWER_NODE_ID,
            undefined,
          ),
        );
      }
      continue;
    }
    if (!event.accepted) continue;
    if (event.stateChanged === false) continue;
    if (
      event.diagnostics?.some(
        (item) =>
          item === "no_state_change" || item.startsWith("no_state_change:"),
      )
    ) {
      continue;
    }
    if (op.type === "create") {
      if (op.node.subjectId && (op.node.type === "claim" || op.node.type === "proposal")) {
        add(
          edgeFromEvent(
            event,
            "answers",
            op.node.id,
            op.node.subjectId,
          ),
        );
      }
      for (const parentId of op.node.parents) {
        add(edgeFromEvent(event, "supports", parentId, op.node.id, undefined, true));
      }
      for (const dependencyId of op.node.dependencies) {
        add(
          edgeFromEvent(
            event,
            "depends_on",
            op.node.id,
            dependencyId,
            undefined,
            true,
          ),
        );
      }
      if (op.replacedActiveNodeId) {
        add(
          edgeFromEvent(
            event,
            "replaced_by",
            op.replacedActiveNodeId,
            op.node.id,
          ),
        );
      }
      for (const link of op.grounding ?? []) {
        add(
          edgeFromEvent(
            event,
            link.relation,
            link.sourceNodeId,
            op.node.id,
          ),
        );
      }
    } else if (op.type === "revise") {
      add(edgeFromEvent(event, "revises", op.replacement.id, op.targetId, op.reason));
      add(
        edgeFromEvent(
          event,
          "replaced_by",
          op.replacedActiveNodeId ?? op.targetId,
          op.replacement.id,
        ),
      );
      if (op.replacement.subjectId) {
        add(
          edgeFromEvent(
            event,
            "answers",
            op.replacement.id,
            op.replacement.subjectId,
          ),
        );
      }
      for (const dependencyId of op.replacement.dependencies) {
        add(
          edgeFromEvent(
            event,
            "depends_on",
            op.replacement.id,
            dependencyId,
            undefined,
            true,
          ),
        );
      }
      for (const link of op.grounding ?? []) {
        add(
          edgeFromEvent(
            event,
            link.relation,
            link.sourceNodeId,
            op.replacement.id,
          ),
        );
      }
    } else if (
      (op.type === "support" || op.type === "challenge") &&
      op.sourceNodeId
    ) {
      add(
        edgeFromEvent(
          event,
          op.type === "support" ? "supports" : "challenges",
          op.sourceNodeId,
          op.targetNodeId,
          op.reason,
        ),
      );
    }
  }
  return edges;
}

function edgesFromLegacyNodes(nodes: ReasoningNode[]): ReasoningEdge[] {
  const edges: ReasoningEdge[] = [];
  for (const node of nodes) {
    if (node.type !== "final_answer" && node.subjectId) {
      edges.push({
        id: `legacy-answers-${node.id}-${node.subjectId}`,
        type: "answers",
        sourceNodeId: node.id,
        targetNodeId: node.subjectId,
        createdBy: node.createdBy,
        createdAtTurn: node.createdAtTurn,
        sourceMessageId: node.sourceMessageId ?? `legacy-turn-${node.createdAtTurn}`,
        sourceEventId: `legacy-${node.id}`,
        legacy: true,
      });
    }
    for (const parentId of node.parents) {
      edges.push({
        id: `legacy-supports-${parentId}-${node.id}`,
        type: "supports",
        sourceNodeId: parentId,
        targetNodeId: node.id,
        createdBy: node.createdBy,
        createdAtTurn: node.createdAtTurn,
        sourceMessageId: node.sourceMessageId ?? `legacy-turn-${node.createdAtTurn}`,
        sourceEventId:
          node.type === "final_answer" ? node.sourceEventId : `legacy-${node.id}`,
        legacy: true,
      });
    }
    if (node.type === "final_answer") continue;
    for (const dependencyId of node.dependencies) {
      edges.push({
        id: `legacy-depends-${node.id}-${dependencyId}`,
        type: "depends_on",
        sourceNodeId: node.id,
        targetNodeId: dependencyId,
        createdBy: node.createdBy,
        createdAtTurn: node.createdAtTurn,
        sourceMessageId: node.sourceMessageId ?? `legacy-turn-${node.createdAtTurn}`,
        sourceEventId: `legacy-${node.id}`,
        legacy: true,
      });
    }
    if (node.supersedes) {
      edges.push({
        id: `legacy-revises-${node.id}-${node.supersedes}`,
        type: "revises",
        sourceNodeId: node.id,
        targetNodeId: node.supersedes,
        createdBy: node.createdBy,
        createdAtTurn: node.createdAtTurn,
        sourceMessageId: node.sourceMessageId ?? `legacy-turn-${node.createdAtTurn}`,
        sourceEventId: `legacy-${node.id}`,
        legacy: true,
      });
    }
  }
  return edges;
}

function finalAnswerNode(event: ReasoningEvent): FinalAnswerNode | undefined {
  if (event.operation.type !== "final_answer") return undefined;
  return {
    id: FINAL_ANSWER_NODE_ID,
    type: "final_answer",
    text: event.operation.text ?? "",
    createdBy: event.actor,
    createdAtTurn: event.turnIndex,
    sourceMessageId: event.messageId,
    sourceEventId: event.id,
    status: event.errors.length > 0 ? "unresolved" : "accepted",
    parents: [...event.operation.supportingNodeIds],
    dependencies: [],
    supportingNodeIds: [...event.operation.supportingNodeIds],
    supportErrors: [...event.errors],
  };
}

/**
 * Rebuild derived node state from the canonical event log.
 * Rejected events are kept on the graph but do not mutate nodes.
 */
export function materializeGraph(
  events: ReasoningEvent[],
  subjects: ReasoningSubject[] = [],
): ReasoningGraph {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const nodes = new Map<string, ReasoningNode>();
  for (const event of sorted) {
    const final = finalAnswerNode(event);
    if (final) {
      nodes.set(FINAL_ANSWER_NODE_ID, final);
      continue;
    }
    if (
      event.accepted &&
      event.stateChanged !== false &&
      !event.diagnostics?.some(
        (item) =>
          item === "no_state_change" || item.startsWith("no_state_change:"),
      )
    ) {
      applyAcceptedOperation(nodes, event.operation);
    }
  }
  const mutable: MutableGraph = {
    subjects: subjects.map((subject) => ({
      ...subject,
      metadata: subject.metadata ? { ...subject.metadata } : undefined,
    })),
    nodes,
    events: sorted.map(cloneEvent),
  };
  refreshStatuses(mutable);
  const materialized = toGraph(mutable);
  const liveIds = new Set(
    materialized.nodes
      .filter(
        (node) =>
          node.type !== "final_answer" &&
          node.status !== "rejected" &&
          node.status !== "superseded",
      )
      .map((node) => node.id),
  );
  const edges = materializeEdges(sorted).filter(
    (edge) =>
      edge.targetNodeId !== FINAL_ANSWER_NODE_ID ||
      liveIds.has(edge.sourceNodeId),
  );
  return { ...materialized, edges };
}

/**
 * Prefer the event log as source of truth. Node snapshots are a cache:
 * when events are present they are replayed. Legacy records that only
 * stored nodes are returned as-is.
 */
export function hydrateReasoningGraph(raw: {
  reasoningSubjects?: ReasoningSubject[];
  reasoningNodes?: ReasoningNode[];
  reasoningEvents?: ReasoningEvent[];
}): ReasoningGraph {
  const subjects = raw.reasoningSubjects ?? [];
  const events = raw.reasoningEvents ?? [];
  const nodes = raw.reasoningNodes ?? [];
  if (events.length > 0) {
    return materializeGraph(events, subjects);
  }
  return {
    subjects: subjects.map((subject) => ({
      ...subject,
      metadata: subject.metadata ? { ...subject.metadata } : undefined,
    })),
    nodes: nodes.map(cloneNode),
    events: [],
    edges: edgesFromLegacyNodes(nodes),
  };
}

function emptyScope(): LocalScope {
  return {
    byLocalId: new Map(),
    byIndex: new Map(),
    createReviseCount: 0,
    committedSubjects: new Set(),
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

function resolveSubjectRef(
  ref: string | undefined,
  mutable: MutableGraph,
  scope: LocalScope,
  ctx?: ApplyIntentsContext,
): { id?: string; error?: string; normalizedFrom?: string } {
  if (ref === undefined) return {};
  const trimmed = ref.trim();
  if (!trimmed) return { error: "subjectId is empty" };
  const knownIds = [
    ...mutable.subjects.map((subject) => subject.id),
    ...[...mutable.nodes.values()]
      .filter((node) => node.type === "issue")
      .map((node) => node.id),
  ];
  const known = resolveKnownSubjectId(trimmed, knownIds);
  if (known.id) {
    if (mutable.subjects.some((subject) => subject.id === known.id)) {
      return known;
    }
    const node = mutable.nodes.get(known.id);
    if (node?.type === "issue") return known;
    return { error: `subjectId ${known.id} is not an issue` };
  }
  const labeled = mutable.subjects.find(
    (subject) => subject.label.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (labeled) return { id: labeled.id, normalizedFrom: trimmed };
  const aliased = ctx?.resolveSubjectAlias?.(trimmed);
  if (aliased?.id) return { id: aliased.id, normalizedFrom: trimmed };
  if (aliased?.error) return { error: aliased.error };
  const resolved = resolveRef(trimmed, mutable, scope);
  if (resolved.error || !resolved.id) {
    return { error: known.error ?? `subjectId references unknown issue ${trimmed}` };
  }
  const node = mutable.nodes.get(resolved.id);
  if (node?.type !== "issue") {
    return { error: `subjectId ${resolved.id} is not an issue` };
  }
  return { id: resolved.id };
}

function liveClaims(
  nodes: Iterable<ReasoningNode>,
  subjectId: string,
  exceptId?: string,
): AtomicReasoningNode[] {
  return [...nodes]
    .filter(
      (node): node is AtomicReasoningNode =>
        isCandidateNode(node) &&
        node.subjectId === subjectId &&
        node.status !== "rejected" &&
        node.status !== "superseded" &&
        node.id !== exceptId,
    )
    .sort(
      (a, b) =>
        b.createdAtTurn - a.createdAtTurn || b.id.localeCompare(a.id),
    );
}

function previousClaim(
  nodes: Iterable<ReasoningNode>,
  subjectId: string,
): AtomicReasoningNode | undefined {
  return [...nodes]
    .filter(
      (node): node is AtomicReasoningNode =>
        isCandidateNode(node) &&
        node.subjectId === subjectId &&
        (node.status === "superseded" || node.status === "rejected"),
    )
    .sort(
      (a, b) =>
        b.createdAtTurn - a.createdAtTurn || b.id.localeCompare(a.id),
    )[0];
}

function resolveClaimTarget(
  args: {
    targetId?: string;
    subjectId?: string;
    selector?: "current" | "previous";
  },
  mutable: MutableGraph,
  scope: LocalScope,
  ctx: ApplyIntentsContext,
  action: string,
): { id?: string; subjectId?: string; error?: string; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (args.targetId?.trim()) {
    const resolved = resolveRef(args.targetId.trim(), mutable, scope);
    if (resolved.error || !resolved.id) {
      return {
        error: resolved.error ?? `unknown target ${args.targetId}`,
        diagnostics,
      };
    }
    const node = mutable.nodes.get(resolved.id);
    return {
      id: resolved.id,
      subjectId:
        node && node.type !== "final_answer" ? node.subjectId : undefined,
      diagnostics,
    };
  }
  const subject = resolveSubjectRef(args.subjectId, mutable, scope, ctx);
  if (subject.error) return { error: subject.error, diagnostics };
  if (subject.normalizedFrom && subject.id) {
    diagnostics.push(
      `normalized subjectId from "${subject.normalizedFrom}" to "${subject.id}"`,
    );
  }
  if (!subject.id) {
    return { error: `${action} is missing targetId`, diagnostics };
  }
  if (args.selector === "previous") {
    const previous = previousClaim(mutable.nodes.values(), subject.id);
    if (!previous) {
      return {
        error: `no previous claim for ${subject.id}`,
        subjectId: subject.id,
        diagnostics,
      };
    }
    return { id: previous.id, subjectId: subject.id, diagnostics };
  }
  const live = liveClaims(mutable.nodes.values(), subject.id);
  if (live.length === 0) {
    return {
      error: `no current claim for ${subject.id}`,
      subjectId: subject.id,
      diagnostics,
    };
  }
  if (live.length > 1) {
    return {
      error: `ambiguous current claim for ${subject.id}: ${live.map((node) => node.id).join(", ")}`,
      subjectId: subject.id,
      diagnostics,
    };
  }
  return { id: live[0]!.id, subjectId: subject.id, diagnostics };
}

function originFromMetadata(
  metadata: Record<string, unknown> | undefined,
  type: AtomicReasoningNodeType,
  actor: ReasoningActor,
): EvidenceOrigin | undefined {
  if (type !== "evidence") return undefined;
  const raw = metadata?.evidenceOrigin;
  if (raw === "task" || raw === "deterministic" || raw === "agent") return raw;
  if (actor === "system") return "task";
  return "agent";
}

function resolveGrounding(
  args: {
    groundsNodeIds?: string[];
    supportsNodeIds?: string[];
    basis?: string[];
    subjectId?: string;
    nodeType: AtomicReasoningNodeType;
  },
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): { links: GroundingLink[]; errors: string[]; diagnostics: string[] } {
  const errors: string[] = [];
  const diagnostics: string[] = [];
  const links: GroundingLink[] = [];
  const push = (id: string, relation: GroundingLink["relation"]) => {
    if (links.some((link) => link.sourceNodeId === id && link.relation === relation)) {
      return;
    }
    links.push({ sourceNodeId: id, relation });
  };
  const resolveOne = (ref: string, relation: GroundingLink["relation"]) => {
    const resolved = resolveRef(ref, mutable, scope);
    if (resolved.error || !resolved.id) {
      errors.push(`basis: ${resolved.error ?? `unknown target ${ref}`}`);
      return;
    }
    push(resolved.id, relation);
  };
  for (const id of args.groundsNodeIds ?? []) resolveOne(id, "grounds");
  for (const id of args.supportsNodeIds ?? []) resolveOne(id, "supports");
  for (const item of args.basis ?? []) {
    const adapted = ctx.resolveBasis?.(item, args.subjectId);
    if (adapted?.error) {
      errors.push(adapted.error);
      continue;
    }
    if (adapted?.id) {
      push(adapted.id, adapted.relation ?? "grounds");
      continue;
    }
    const resolved = resolveRef(item, mutable, scope);
    if (resolved.id) {
      push(resolved.id, "grounds");
      continue;
    }
    errors.push(`basis references unknown source ${item}`);
  }
  if (
    links.length === 0 &&
    args.subjectId &&
    (args.nodeType === "claim" || args.nodeType === "proposal")
  ) {
    const auto = ctx.autoGround?.(args.subjectId);
    if (auto) {
      push(auto.nodeId, auto.relation);
      diagnostics.push("auto_grounded_to_task_evidence");
    }
  }
  return { links, errors, diagnostics };
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
  diagnostics?: string[],
  stateChanged?: boolean,
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
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics: [...diagnostics] } : {}),
    ...(stateChanged === false ? { stateChanged: false } : {}),
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
    type: AtomicReasoningNodeType;
    text: string;
    parents: string[];
    dependencies: string[];
      subjectId?: string;
    confidence?: number;
    supersedes?: string;
    metadata?: Record<string, unknown>;
  },
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  ignoreDuplicateId?: string,
): { node?: AtomicReasoningNode; errors: string[] } {
  const errors: string[] = [];
  const identity = ctx.candidateIdentity?.({
    type: args.type,
    text: args.text,
    subjectId: args.subjectId,
    metadata: args.metadata,
  });
  const duplicateOf =
    args.type === "claim" || args.type === "proposal"
      ? findDuplicateId(
          mutable.nodes.values(),
          args.type,
          args.text,
          args.subjectId,
          ignoreDuplicateId,
          identity,
          (node) => candidateIdentityOf(ctx, node),
        ) ??
        findParaphraseId(
          mutable.nodes.values(),
          args.type,
          args.text,
          args.subjectId,
          ignoreDuplicateId,
        )
      : undefined;
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

  const preview: AtomicReasoningNode = {
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
    subjectId: args.subjectId,
    supersedes: args.supersedes,
    metadata: args.metadata,
    evidenceOrigin: originFromMetadata(args.metadata, args.type, ctx.actor),
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
): IntentApplyResult {
  const errors: string[] = [];
  const diagnostics: string[] = [];
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

  if (ctx.actor !== "system" && (type === "claim" || type === "proposal" || type === "evidence")) {
    const proposition = validateCommittedProposition(text, type);
    if (!proposition.ok) errors.push(...proposition.reasons);
    const confidence = validateCommitConfidence(intent.confidence);
    if (!confidence.ok) errors.push(...confidence.reasons);
  }

  const deps = resolveIdList(intent.dependencies, mutable, scope, "dependencies");
  const subject = resolveSubjectRef(intent.subjectId, mutable, scope, ctx);
  errors.push(...deps.errors);
  if (subject.error) errors.push(subject.error);
  if (subject.normalizedFrom && subject.id) {
    diagnostics.push(
      `normalized subjectId from "${subject.normalizedFrom}" to "${subject.id}"`,
    );
  }
  if (intent.subjectId && type !== "claim" && type !== "proposal" && type !== "evidence") {
    errors.push("subjectId is only valid on claim, proposal, or evidence nodes");
  }
  if (subject.id && (type === "claim" || type === "proposal")) {
    const settled = [...mutable.nodes.values()].find(
      (node) =>
        node.type !== "final_answer" &&
        (node.type === "claim" || node.type === "proposal") &&
        node.subjectId === subject.id &&
        node.status === "accepted",
    );
    if (settled) {
      const explicitTrigger = mutable.events.some(
        (event) =>
          event.accepted &&
          event.operation.type === "challenge" &&
          event.operation.targetId === settled.id,
      );
      const taskTrigger = (ctx.reopenSignals ?? []).some(
        (signal) => signal.issueId === subject.id,
      );
      if (!explicitTrigger && !taskTrigger) {
        errors.push(
          `issue ${subject.id} is settled by ${settled.id}; challenge, revise, or provide new evidence before adding an alternative`,
        );
      }
    }
  }

  if ((type === "claim" || type === "proposal") && ctx.validateCandidate) {
    const validity = ctx.validateCandidate({
      type,
      text,
      subjectId: subject.id,
      metadata: intent.metadata,
    });
    if (!validity.ok) {
      return {
        accepted: false,
        errors: [
          ...errors,
          ...(validity.reasons ?? ["candidate failed structural validation"]),
        ],
        stored: invalidOperation(ctx),
        diagnostics,
      };
    }
  }

  const identity = ctx.candidateIdentity?.({
    type,
    text,
    subjectId: subject.id,
    metadata: intent.metadata,
  });
  if (identity) {
    const liveDup = liveIdentityNode(
      mutable.nodes.values(),
      identity,
      (node) => candidateIdentityOf(ctx, node),
    );
    if (liveDup) {
      return noStateChangeResult(
        invalidOperation(ctx, liveDup.id),
        `${identity} is already the live candidate`,
        diagnostics,
      );
    }
  }
  const historical = identity
    ? historicalIdentityNodes(
        mutable.nodes.values(),
        identity,
        (node) => candidateIdentityOf(ctx, node),
      )
    : [];
  if (historical.length > 0) {
    const priorTurns = [...new Set(historical.map((node) => node.createdAtTurn))];
    diagnostics.push(
      `candidate_revisit: ${identity} was previously tried on turns ${priorTurns.join(" and ")}`,
    );
    if (!hasNovelAgentEvidence(mutable, ctx)) {
      return noStateChangeResult(
        invalidOperation(ctx, historical[0]?.id),
        `${identity} was already tried on turns ${priorTurns.join(" and ")} without materially new evidence`,
        diagnostics,
      );
    }
  }

  if (errors.length > 0) {
    return {
      accepted: false,
      errors,
      stored: invalidOperation(ctx),
      diagnostics,
    };
  }

  if (isCandidateType(type) && subject.id) {
    if (scope.committedSubjects.has(subject.id)) {
      return {
        accepted: false,
        errors: [
          `already committed a candidate for ${subject.id} this turn; externalize only the most plausible one`,
        ],
        stored: invalidOperation(ctx),
        diagnostics,
      };
    }
    const live = liveClaims(mutable.nodes.values(), subject.id);
    if (live.length > 0 && identity) {
      diagnostics.push(`promoted_create_to_revise:${live[0]!.id}`);
      const revised = applyRevise(
        {
          action: "revise",
          targetId: live[0]!.id,
          nodeType: type,
          text,
          confidence: intent.confidence,
          dependencies: intent.dependencies,
          subjectId: subject.id,
          groundsNodeIds: intent.groundsNodeIds,
          supportsNodeIds: intent.supportsNodeIds,
          basis: intent.basis,
          localId: intent.localId,
          metadata: intent.metadata,
          reason: "supersedes the prior live candidate for the same issue",
        },
        ctx,
        mutable,
        scope,
      );
      if (revised.accepted) {
        scope.committedSubjects.add(subject.id);
      }
      return {
        ...revised,
        diagnostics: [...diagnostics, ...(revised.diagnostics ?? [])],
      };
    }
  }

  const metadata = {
    ...(intent.metadata ?? {}),
    ...(identity ? { candidateIdentity: identity } : {}),
    ...(historical.length > 0
      ? {
          candidateRevisit: true,
          candidatePriorTurns: historical.map((node) => node.createdAtTurn),
        }
      : {}),
  };

  const prepared = prepareNewNode(
    {
      type,
      text,
      parents: [],
      dependencies: deps.ids,
      subjectId: subject.id,
      confidence: intent.confidence,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    },
    ctx,
    mutable,
  );
  errors.push(...prepared.errors);
  const grounding = type
    ? resolveGrounding(
        {
          groundsNodeIds: intent.groundsNodeIds,
          supportsNodeIds: intent.supportsNodeIds,
          basis: intent.basis,
          subjectId: subject.id,
          nodeType: type,
        },
        ctx,
        mutable,
        scope,
      )
    : { links: [], errors: [], diagnostics: [] };
  errors.push(...grounding.errors);
  diagnostics.push(...grounding.diagnostics);
  if (!prepared.node || errors.length > 0) {
    const duplicates = errors.filter((error) => error.startsWith("duplicate of "));
    const others = errors.filter((error) => !error.startsWith("duplicate of "));
    if (duplicates.length > 0 && others.length === 0) {
      return noStateChangeResult(
        invalidOperation(ctx),
        duplicates[0]!.replace(/^duplicate of /, "") +
          " is already the live candidate; reference the existing node instead of recreating it",
        diagnostics,
      );
    }
    return { accepted: false, errors, stored: invalidOperation(ctx), diagnostics };
  }

  const localError = registerLocal(scope, intent.localId, prepared.node.id);
  if (localError) {
    return {
      accepted: false,
      errors: [...errors, localError],
      stored: invalidOperation(ctx),
      diagnostics,
    };
  }

  mutable.nodes.set(prepared.node.id, prepared.node);
  if (isCandidateType(prepared.node.type) && prepared.node.subjectId) {
    scope.committedSubjects.add(prepared.node.subjectId);
  }
  return {
    accepted: true,
    errors: [],
    diagnostics,
    stored: {
      type: "create",
      node: prepared.node,
      ...(grounding.links.length > 0 ? { grounding: grounding.links } : {}),
    },
  };
}

function applyRevise(
  intent: Extract<ReasoningIntent, { action: "revise" }>,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): IntentApplyResult {
  const targetResolved = resolveClaimTarget(
    {
      targetId: intent.targetId,
      subjectId: intent.subjectId,
      selector: intent.selector ?? "current",
    },
    mutable,
    scope,
    ctx,
    "revise",
  );
  const diagnostics = [...targetResolved.diagnostics];
  if (targetResolved.error || !targetResolved.id) {
    return {
      accepted: false,
      errors: [targetResolved.error ?? "revise is missing targetId"],
      stored: invalidOperation(ctx, intent.targetId),
      diagnostics,
    };
  }
  const resolved = { id: targetResolved.id };
  const legality = targetLegality(mutable, resolved.id, "revise");
  if (legality.length > 0) {
    return {
      accepted: false,
      errors: legality,
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  const target = mutable.nodes.get(resolved.id)!;
  if (target.type === "final_answer") {
    return {
      accepted: false,
      errors: ["the engine-derived final answer cannot be revised"],
      stored: invalidOperation(ctx, resolved.id),
    };
  }
  const type = isNodeType(intent.nodeType) ? intent.nodeType : target.type;
  const text = sanitizeText(intent.text);
  if (!text) {
    return {
      accepted: false,
      errors: ["revise is missing replacement text"],
      stored: invalidOperation(ctx, resolved.id),
    };
  }

  if (ctx.actor !== "system" && (type === "claim" || type === "proposal" || type === "evidence")) {
    const proposition = validateCommittedProposition(text, type);
    if (!proposition.ok) {
      return {
        accepted: false,
        errors: proposition.reasons,
        stored: invalidOperation(ctx, resolved.id),
      };
    }
    const confidence = validateCommitConfidence(intent.confidence);
    if (!confidence.ok) {
      return {
        accepted: false,
        errors: confidence.reasons,
        stored: invalidOperation(ctx, resolved.id),
      };
    }
  }

  const deps = resolveIdList(intent.dependencies, mutable, scope, "dependencies");
  const subject = resolveSubjectRef(
    intent.subjectId ?? target.subjectId,
    mutable,
    scope,
    ctx,
  );
  const errors = [...deps.errors];
  if (subject.error) errors.push(subject.error);
  if (subject.normalizedFrom && subject.id) {
    diagnostics.push(
      `normalized subjectId from "${subject.normalizedFrom}" to "${subject.id}"`,
    );
  }
  if (
    (intent.subjectId ?? target.subjectId) &&
    type !== "claim" &&
    type !== "proposal"
  ) {
    errors.push("subjectId is only valid on claim or proposal nodes");
  }
  const depIds =
    intent.dependencies !== undefined ? deps.ids : [...target.dependencies];

  if ((type === "claim" || type === "proposal") && ctx.validateCandidate) {
    const validity = ctx.validateCandidate({
      type,
      text,
      subjectId: subject.id,
      metadata: intent.metadata ?? target.metadata,
    });
    if (!validity.ok) {
      return {
        accepted: false,
        errors: [
          ...errors,
          ...(validity.reasons ?? ["candidate failed structural validation"]),
        ],
        stored: invalidOperation(ctx, resolved.id),
        diagnostics,
      };
    }
  }

  const identity = ctx.candidateIdentity?.({
    type,
    text,
    subjectId: subject.id,
    metadata: intent.metadata ?? target.metadata,
  });
  const targetIdentity = candidateIdentityOf(ctx, target);
  if (
    (identity && identity === targetIdentity) ||
    (!identity && normalizeNodeText(text) === normalizeNodeText(target.text))
  ) {
    return noStateChangeResult(
      invalidOperation(ctx, target.id),
      `${identity ?? target.text} is already the live candidate`,
      diagnostics,
    );
  }
  if (identity) {
    const liveDup = liveIdentityNode(
      mutable.nodes.values(),
      identity,
      (node) => candidateIdentityOf(ctx, node),
      target.id,
    );
    if (liveDup) {
      return noStateChangeResult(
        invalidOperation(ctx, liveDup.id),
        `${identity} is already the live candidate`,
        diagnostics,
      );
    }
    const historical = historicalIdentityNodes(
      mutable.nodes.values(),
      identity,
      (node) => candidateIdentityOf(ctx, node),
      target.id,
    );
    if (historical.length > 0 && !hasNovelAgentEvidence(mutable, ctx)) {
      const priorTurns = [...new Set(historical.map((node) => node.createdAtTurn))];
      diagnostics.push(
        `candidate_revisit: ${identity} was previously tried on turns ${priorTurns.join(" and ")}`,
      );
      return noStateChangeResult(
        invalidOperation(ctx, target.id),
        `${identity} was already tried on turns ${priorTurns.join(" and ")} without materially new evidence`,
        diagnostics,
      );
    }
  }

  const prepared = prepareNewNode(
    {
      type,
      text,
      parents: [],
      dependencies: depIds,
      subjectId: subject.id,
      confidence: intent.confidence ?? target.confidence,
      supersedes: target.id,
      metadata: {
        ...(intent.metadata ?? {}),
        ...(identity ? { candidateIdentity: identity } : {}),
      },
    },
    ctx,
    mutable,
    target.id,
  );
  errors.push(...prepared.errors);
  const grounding = resolveGrounding(
    {
      groundsNodeIds: intent.groundsNodeIds,
      supportsNodeIds: intent.supportsNodeIds,
      basis: intent.basis,
      subjectId: subject.id,
      nodeType: type,
    },
    ctx,
    mutable,
    scope,
  );
  errors.push(...grounding.errors);
  diagnostics.push(...grounding.diagnostics);
  if (!prepared.node || errors.length > 0) {
    const duplicates = errors.filter((error) => error.startsWith("duplicate of "));
    const others = errors.filter((error) => !error.startsWith("duplicate of "));
    if (duplicates.length > 0 && others.length === 0) {
      return noStateChangeResult(
        invalidOperation(ctx, resolved.id),
        duplicates[0]!.replace(/^duplicate of /, "") +
          " is already the live candidate",
        diagnostics,
      );
    }
    return {
      accepted: false,
      errors,
      stored: invalidOperation(ctx, resolved.id),
      diagnostics,
    };
  }

  const localError = registerLocal(scope, intent.localId, prepared.node.id);
  if (localError) {
    return {
      accepted: false,
      errors: [...errors, localError],
      stored: invalidOperation(ctx, resolved.id),
      diagnostics,
    };
  }

  const replacement: AtomicReasoningNode = {
    ...prepared.node,
    supersedes: target.id,
    parents: [],
  };
  mutable.nodes.set(replacement.id, replacement);
  mutable.nodes.set(target.id, { ...target, status: "superseded" });
  if (isCandidateType(replacement.type) && replacement.subjectId) {
    scope.committedSubjects.add(replacement.subjectId);
  }
  return {
    accepted: true,
    errors: [],
    diagnostics,
    stored: {
      type: "revise",
      actor: ctx.actor,
      targetId: target.id,
      replacement,
      reason: intent.reason?.trim() || undefined,
      replacedActiveNodeId: target.id,
      ...(grounding.links.length > 0 ? { grounding: grounding.links } : {}),
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
): IntentApplyResult {
  const targetResolved = resolveClaimTarget(
    {
      targetId:
        ("targetNodeId" in intent ? intent.targetNodeId?.trim() : undefined) ??
        intent.targetId?.trim(),
      subjectId: "subjectId" in intent ? intent.subjectId : undefined,
      selector: "selector" in intent ? intent.selector : undefined,
    },
    mutable,
    scope,
    ctx,
    intent.action,
  );
  if (targetResolved.error || !targetResolved.id) {
    return {
      accepted: false,
      errors: [
        targetResolved.error ??
          `${intent.action} is missing ${
            intent.action === "support" || intent.action === "challenge"
              ? "targetId (or targetNodeId)"
              : "targetId"
          }`,
      ],
      stored: invalidOperation(ctx),
      diagnostics: targetResolved.diagnostics,
    };
  }
  const resolved = { id: targetResolved.id };
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

  let sourceNodeId: string | undefined;
  if (
    (intent.action === "support" || intent.action === "challenge") &&
    intent.sourceNodeId?.trim()
  ) {
    const source = resolveRef(intent.sourceNodeId.trim(), mutable, scope);
    if (source.error || !source.id) {
      return {
        accepted: false,
        errors: [`source: ${source.error ?? `unknown target ${intent.sourceNodeId}`}`],
        stored: invalidOperation(ctx, resolved.id),
      };
    }
    const sourceLegality = targetLegality(mutable, source.id, intent.action);
    if (sourceLegality.length > 0) {
      return {
        accepted: false,
        errors: sourceLegality.map((error) => `source ${error}`),
        stored: invalidOperation(ctx, resolved.id),
      };
    }
    if (source.id === resolved.id) {
      return {
        accepted: false,
        errors: [`${intent.action} source and target must be different nodes`],
        stored: invalidOperation(ctx, resolved.id),
      };
    }
    sourceNodeId = source.id;
  }

  const stored = {
    type: intent.action,
    actor: ctx.actor,
    targetId: resolved.id,
    ...((intent.action === "support" || intent.action === "challenge")
      ? { sourceNodeId, targetNodeId: resolved.id }
      : {}),
    reason: reason || undefined,
  } as ReasoningOperation;

  if (
    (intent.action === "support" ||
      intent.action === "challenge" ||
      intent.action === "accept") &&
    ctx.actor !== "system"
  ) {
    const existing = stancesForNode(toGraph(mutable), resolved.id).find(
      (stance) => stance.actor === ctx.actor,
    );
    const novelEvidence =
      Boolean(sourceNodeId) && hasNovelAgentEvidence(mutable, ctx);
    if (
      existing &&
      existing.kind === intent.action &&
      !novelEvidence &&
      (!reason || reason === (existing.reason ?? ""))
    ) {
      const target = mutable.nodes.get(resolved.id);
      const identity =
        target && target.type !== "final_answer"
          ? candidateIdentityOf(ctx, target)
          : undefined;
      return noStateChangeResult(
        stored,
        identity
          ? `${identity} is already ${intent.action}ed by this agent`
          : `${resolved.id} is already ${intent.action}ed by this agent`,
      );
    }
  }

  return { accepted: true, errors: [], stored };
}

function applyOneIntent(
  intent: ReasoningIntent,
  ctx: ApplyIntentsContext,
  mutable: MutableGraph,
  scope: LocalScope,
): IntentApplyResult {
  if (intent.action === "invalid") {
    const detail =
      intent.raw &&
      typeof intent.raw === "object" &&
      !Array.isArray(intent.raw) &&
      "error" in intent.raw &&
      typeof intent.raw.error === "string"
        ? intent.raw.error
        : "malformed reasoning intent";
    return {
      accepted: false,
      errors: [detail],
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

function liveIdeaIds(graph: ReasoningGraph): string[] {
  return graph.nodes
    .filter(
      (node) =>
        isCandidateNode(node) &&
        node.status !== "rejected" &&
        node.status !== "superseded",
    )
    .map((node) => node.id);
}

function applyFinalAnswer(
  mutable: MutableGraph,
  ctx: ApplyIntentsContext,
): FinalAnswerSupport | undefined {
  if (!ctx.finalAnswer) return undefined;
  refreshStatuses(mutable);
  const snapshot = toGraph(mutable);
  const cited = uniqueIds(ctx.finalAnswer.supportingNodeIds);
  let supportingNodeIds = cited;
  const extraErrors: string[] = [];
  if (ctx.reconcileFinalAnswer) {
    const reconciled = ctx.reconcileFinalAnswer(
      ctx.finalAnswer.text,
      cited,
      snapshot,
    );
    supportingNodeIds = uniqueIds(reconciled.supportingNodeIds);
    extraErrors.push(...reconciled.errors);
  } else if (cited.length === 0) {
    supportingNodeIds = liveIdeaIds(snapshot);
    if (supportingNodeIds.length === 0 && ctx.finalAnswer.text?.trim()) {
      extraErrors.push("final answer has no graph ancestry");
    }
  }
  const support = validateFinalAnswerSupport(snapshot, {
    text: ctx.finalAnswer.text,
    supportingNodeIds,
  });
  if (!support) return undefined;
  support.errors.push(...extraErrors);
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
      ? support.errors.map((error) =>
          error.startsWith("Supporting-node linkage invalid:")
            ? error
            : `Supporting-node linkage invalid: ${error}`,
        )
      : [],
  );
  return support;
}

function addEventDiagnostic(event: ReasoningEvent, message: string): void {
  if (event.diagnostics?.includes(message)) return;
  event.diagnostics = [...(event.diagnostics ?? []), message];
}

function thisTurnAddresses(events: ReasoningEvent[], nodeId: string): boolean {
  return events.some((event) => {
    if (!event.accepted) return false;
    const op = event.operation;
    if (op.type === "revise" && op.targetId === nodeId) return true;
    if (op.type === "challenge" && op.targetId === nodeId) return true;
    if (op.type === "reject" && op.targetId === nodeId) return true;
    if (
      (op.type === "support" || op.type === "challenge") &&
      op.sourceNodeId &&
      op.targetId === nodeId
    ) {
      return true;
    }
    return false;
  });
}

function thisTurnHasEvidence(events: ReasoningEvent[]): boolean {
  return events.some((event) => {
    if (!event.accepted) return false;
    const op = event.operation;
    if (op.type === "create" && op.node.type === "evidence") return true;
    if (op.type === "create" && (op.grounding?.length ?? 0) > 0) return true;
    if (op.type === "revise" && (op.grounding?.length ?? 0) > 0) return true;
    if (
      (op.type === "support" || op.type === "challenge") &&
      op.sourceNodeId
    ) {
      return true;
    }
    return false;
  });
}

function autoAttachTurnEvidence(
  mutable: MutableGraph,
  applied: ReasoningEvent[],
  ctx: ApplyIntentsContext,
): void {
  if (ctx.actor === "system") return;
  const turnEvents = applied.filter((event) => event.turnIndex === ctx.turnIndex);
  const used = new Set<string>();
  for (const event of turnEvents) {
    if (!event.accepted) continue;
    const op = event.operation;
    if (op.type === "create" || op.type === "revise") {
      for (const link of op.grounding ?? []) used.add(link.sourceNodeId);
    }
    if ((op.type === "support" || op.type === "challenge") && op.sourceNodeId) {
      used.add(op.sourceNodeId);
    }
  }
  for (const event of turnEvents) {
    if (!event.accepted || event.operation.type !== "create") continue;
    const node = event.operation.node;
    if (node.type !== "evidence") continue;
    if (node.evidenceOrigin === "task") continue;
    if (used.has(node.id) || !node.subjectId) continue;
    const live = liveClaims(mutable.nodes.values(), node.subjectId);
    if (live.length !== 1) continue;
    const support = applyStance(
      {
        action: "support",
        sourceNodeId: node.id,
        targetId: live[0]!.id,
        subjectId: node.subjectId,
      },
      ctx,
      mutable,
      emptyScope(),
    );
    applied.push(
      appendEvent(
        mutable,
        ctx,
        {
          action: "support",
          sourceNodeId: node.id,
          targetId: live[0]!.id,
          subjectId: node.subjectId,
        },
        support.stored,
        support.accepted,
        support.errors,
        ["auto_attached_evidence_to_live_idea", ...(support.diagnostics ?? [])],
        support.stateChanged,
      ),
    );
  }
}

function annotateTurnDiagnostics(
  ctx: ApplyIntentsContext,
  applied: ReasoningEvent[],
): void {
  const turnEvents = applied.filter((event) => event.turnIndex === ctx.turnIndex);
  const hasEvidence = thisTurnHasEvidence(turnEvents);
  for (const event of turnEvents) {
    if (!event.accepted || event.operation.type !== "create") continue;
    const node = event.operation.node;
    if (!isCandidateNode(node) || !node.subjectId) continue;
    if (event.operation.replacedActiveNodeId) {
      const oldId = event.operation.replacedActiveNodeId;
      const grounded = (event.operation.grounding?.length ?? 0) > 0;
      if (!thisTurnAddresses(turnEvents, oldId) && !grounded) {
        addEventDiagnostic(event, "candidate transition without semantic lineage");
      }
    }
    const revisit = event.diagnostics?.some((item) =>
      item.startsWith("candidate_revisit"),
    );
    if (revisit) {
      addEventDiagnostic(
        event,
        hasEvidence
          ? "candidate_revisit with new evidence"
          : "candidate_revisit without new evidence",
      );
    }
    const conflicted = (ctx.conflicts ?? []).filter(
      (conflict) =>
        conflict.issueId === node.subjectId &&
        conflict.source === "task_constraint",
    );
    if (conflicted.length > 0) {
      const conflictNodeIds = new Set(conflicted.flatMap((conflict) => conflict.nodeIds));
      const addressed = [...conflictNodeIds].some((id) =>
        thisTurnAddresses(turnEvents, id),
      );
      if (!addressed) {
        addEventDiagnostic(
          event,
          `unresolved conflict on ${node.subjectId}; prefer resolving conflicting live candidates before expanding unrelated alternatives`,
        );
      }
    }
  }
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
  const subjects = graph.subjects ?? [];
  const mutable: MutableGraph = {
    subjects: subjects.map((subject) => ({
      ...subject,
      metadata: subject.metadata ? { ...subject.metadata } : undefined,
    })),
    nodes: new Map(
      materializeGraph(graph.events, subjects).nodes.map((node) => [
        node.id,
        cloneNode(node),
      ]),
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
    if (i >= MAX_OPS_PER_TURN && ctx.actor !== "system") {
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
        result.diagnostics,
        result.stateChanged,
      ),
    );
    refreshStatuses(mutable);
  }

  autoAttachTurnEvidence(mutable, applied, ctx);
  annotateTurnDiagnostics(ctx, applied);
  if (ctx.extraDiagnostics && ctx.extraDiagnostics.length > 0) {
    if (applied.length === 0) {
      applied.push(
        appendEvent(
          mutable,
          ctx,
          { action: "invalid", raw: { diagnostics: ctx.extraDiagnostics } },
          invalidOperation(ctx),
          false,
          [],
          ctx.extraDiagnostics,
        ),
      );
    } else {
      for (const item of ctx.extraDiagnostics) addEventDiagnostic(applied[0]!, item);
    }
  }

  const finalAnswerSupport = applyFinalAnswer(mutable, ctx);
  if (finalAnswerSupport) {
    const last = mutable.events[mutable.events.length - 1];
    if (last?.operation.type === "final_answer") applied.push(last);
  }

  const next = materializeGraph(mutable.events, mutable.subjects);
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
        dependencies: op.node.dependencies,
        subjectId: op.node.subjectId,
      };
    }
    if (op.type === "revise") {
      return {
        action: "revise" as const,
        targetId: op.targetId,
        nodeType: op.replacement.type,
        text: op.replacement.text,
        confidence: op.replacement.confidence,
        dependencies: op.replacement.dependencies,
        subjectId: op.replacement.subjectId,
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
    if (op.type === "support" || op.type === "challenge") {
      return {
        action: op.type,
        sourceNodeId: op.sourceNodeId,
        targetNodeId: op.targetNodeId,
        targetId: op.targetId,
        reason: op.reason,
      };
    }
    return {
      action: op.type,
      targetId: op.targetId,
      reason: "reason" in op ? op.reason : undefined,
    };
  });
  return applyReasoningIntents(graph, intents, ctx);
}
