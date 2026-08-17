/**
 * SVG reasoning-graph view for a single conversation.
 *
 * Graph mutation is src/reasoning/graph.ts; this file only lays out and highlights nodes.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { AgentId } from "../../agents/types";
import { agentLabel } from "../../agents/identity";
import type { ProblemConversation } from "../../experiment/types";
import {
  eventsForNode,
  hasStructuredReasoning,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  nodeIdsTouchedByMessage,
  stancesForNode,
  type GraphLayoutNode,
  type ReasoningGraph,
  type ReasoningNode,
  type ReasoningNodeStatus,
} from "../../reasoning";

type Props = {
  conversation?: ProblemConversation;
  speakingAgentId?: AgentId;
  selectedNodeId?: string;
  selectedMessageId?: string;
  /** Tighter chrome when embedded in the problem inspector. */
  compact?: boolean;
  onSelectNode?: (nodeId: string | undefined, messageId?: string) => void;
  onOpenSourceTurn?: (messageId: string, nodeId?: string) => void;
};

const FINAL_ID = "__final_answer__";
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

function graphFromConversation(
  conversation: ProblemConversation,
): ReasoningGraph {
  return hydrateReasoningGraph({
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningNodes: conversation.reasoningNodes,
    reasoningEvents: conversation.reasoningEvents,
  });
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function statusClass(status: ReasoningNodeStatus): string {
  return `reasoning-node--${status}`;
}

function ownerClass(createdBy: AgentId): string {
  return createdBy === "agent_a" ? "reasoning-node--a" : "reasoning-node--b";
}

export function ReasoningGraphView({
  conversation,
  speakingAgentId,
  selectedNodeId,
  selectedMessageId,
  compact,
  onSelectNode,
  onOpenSourceTurn,
}: Props) {
  const prevIdsRef = useRef<Set<string>>(new Set());
  const graphRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const followLiveRef = useRef(true);
  const suppressNodeClickRef = useRef(false);
  const panRef = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        scrollLeft: number;
        scrollTop: number;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const zoomAnchorRef = useRef<
    | {
        xRatio: number;
        yRatio: number;
        offsetX: number;
        offsetY: number;
      }
    | undefined
  >(undefined);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const live = conversation?.status === "running";

  useEffect(() => {
    prevIdsRef.current = new Set();
    setZoom(1);
  }, [conversation?.problemId]);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === graphRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const graph = useMemo(
    () => (conversation ? graphFromConversation(conversation) : { nodes: [], events: [] }),
    [conversation],
  );
  const latestTurn = conversation?.messages.at(-1)?.turnIndex;

  const layout = useMemo(
    () =>
      layoutReasoningGraph(graph, {
        throughTurn: latestTurn,
        finalAnswer: conversation?.finalAnswer
          ? {
              text: conversation.finalAnswer,
              supportingNodeIds:
                conversation.finalAnswerSupport?.supportingNodeIds ?? [],
            }
          : undefined,
      }),
    [graph, latestTurn, conversation?.finalAnswer, conversation?.finalAnswerSupport],
  );

  const enteringIds = useMemo(() => {
    const prev = prevIdsRef.current;
    const next = new Set(layout.nodes.map((n) => n.id));
    const entering = new Set<string>();
    if (live) {
      for (const id of next) {
        if (!prev.has(id)) entering.add(id);
      }
    }
    prevIdsRef.current = next;
    return entering;
  }, [layout, live]);

  const selected = selectedNodeId
    ? graph.nodes.find((n) => n.id === selectedNodeId)
    : undefined;
  const selectedTurn = selectedMessageId
    ? conversation?.messages.find((message) => message.id === selectedMessageId)
        ?.turnIndex
    : undefined;
  const focusedNodeId =
    selectedNodeId ??
    (selectedMessageId
      ? graph.nodes.find((node) => node.sourceMessageId === selectedMessageId)
          ?.id ?? nodeIdsTouchedByMessage(graph, selectedMessageId)[0]
      : undefined);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || (selectedTurn === undefined && !focusedNodeId)) return;
    const svg = canvas.querySelector("svg");
    if (!svg) return;
    const scaleX = svg.clientWidth / layout.width;
    const scaleY = svg.clientHeight / layout.height;
    const item = layout.nodes.find((node) => node.id === focusedNodeId);
    const band = layout.turnBands.find(
      (candidate) => candidate.turnIndex === selectedTurn,
    );
    const targetY = band?.nodeY ?? item?.y;
    canvas.scrollTo({
      left: item
        ? Math.max(
            0,
            (item.x + item.width / 2) * scaleX - canvas.clientWidth / 2,
          )
        : canvas.scrollLeft,
      top:
        targetY === undefined
          ? canvas.scrollTop
          : Math.max(0, targetY * scaleY - canvas.clientHeight / 2),
      behavior: "smooth",
    });
  }, [focusedNodeId, layout, selectedTurn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live || enteringIds.size === 0 || !followLiveRef.current) {
      return;
    }
    canvas.scrollTo({ top: canvas.scrollHeight, behavior: "smooth" });
  }, [enteringIds, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const anchor = zoomAnchorRef.current;
    if (!canvas || !anchor) return;
    zoomAnchorRef.current = undefined;
    canvas.scrollLeft =
      anchor.xRatio * canvas.scrollWidth - anchor.offsetX;
    canvas.scrollTop =
      anchor.yRatio * canvas.scrollHeight - anchor.offsetY;
  }, [zoom]);

  const changeZoom = (
    nextZoom: number,
    clientPoint?: { x: number; y: number },
  ) => {
    const canvas = canvasRef.current;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const offsetX = clientPoint ? clientPoint.x - rect.left : rect.width / 2;
      const offsetY = clientPoint ? clientPoint.y - rect.top : rect.height / 2;
      zoomAnchorRef.current = {
        xRatio: (canvas.scrollLeft + offsetX) / canvas.scrollWidth,
        yRatio: (canvas.scrollTop + offsetY) / canvas.scrollHeight,
        offsetX,
        offsetY,
      };
    }
    followLiveRef.current = false;
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)));
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === graphRef.current) {
      await document.exitFullscreen();
      return;
    }
    await graphRef.current?.requestFullscreen();
  };

  if (!conversation) {
    return (
      <div className={compact ? "reasoning-graph reasoning-graph--compact" : "reasoning-graph"}>
        <div className="reasoning-graph__empty">
          <p>Select a problem to inspect joint reasoning.</p>
          <p className="muted">
            The graph is built during the conversation, in parallel with the
            transcript.
          </p>
        </div>
      </div>
    );
  }

  if (!hasStructuredReasoning(conversation)) {
    return (
      <div className={compact ? "reasoning-graph reasoning-graph--compact" : "reasoning-graph"}>
        <div className="reasoning-graph__empty">
          <p>No structured reasoning data for this problem.</p>
          <p className="muted">
            Legacy transcripts still load in Conversation. New runs record a
            Reasoning Graph alongside the dialogue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={graphRef}
      className={compact ? "reasoning-graph reasoning-graph--compact" : "reasoning-graph"}
    >
      <header className="reasoning-graph__header">
        {compact ? null : (
          <div className="reasoning-graph__title-block">
            <h1>Joint reasoning</h1>
            <p className="muted">{conversation.problemTitle}</p>
          </div>
        )}
        <div className="reasoning-graph__controls">
          <ReasoningLegend />
          <div
            className="reasoning-graph__zoom-controls"
            role="group"
            aria-label="Graph zoom controls"
          >
            <button
              type="button"
              className="reasoning-graph__tool"
              aria-label="Zoom out"
              title="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => changeZoom(zoom - ZOOM_STEP)}
            >
              −
            </button>
            <button
              type="button"
              className="reasoning-graph__zoom-level"
              aria-label="Reset graph zoom"
              title="Reset zoom"
              onClick={() => changeZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="reasoning-graph__tool"
              aria-label="Zoom in"
              title="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => changeZoom(zoom + ZOOM_STEP)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="reasoning-graph__tool reasoning-graph__fullscreen"
            aria-label={isFullscreen ? "Exit fullscreen" : "View graph fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className="reasoning-graph__body">
        <div
          ref={canvasRef}
          className={[
            "reasoning-graph__canvas",
            isPanning ? "is-panning" : "",
            zoom > 1 ? "is-zoomed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Reasoning Graph"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            panRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              scrollLeft: event.currentTarget.scrollLeft,
              scrollTop: event.currentTarget.scrollTop,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            const dx = event.clientX - pan.startX;
            const dy = event.clientY - pan.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
              if (!pan.moved) {
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsPanning(true);
              }
              pan.moved = true;
              suppressNodeClickRef.current = true;
            }
            if (!pan.moved) return;
            event.currentTarget.scrollLeft = pan.scrollLeft - dx;
            event.currentTarget.scrollTop = pan.scrollTop - dy;
            followLiveRef.current = false;
          }}
          onPointerUp={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            panRef.current = undefined;
            setIsPanning(false);
            if (pan.moved) {
              window.setTimeout(() => {
                suppressNodeClickRef.current = false;
              }, 0);
            }
          }}
          onPointerCancel={() => {
            panRef.current = undefined;
            suppressNodeClickRef.current = false;
            setIsPanning(false);
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            followLiveRef.current =
              element.scrollHeight -
                element.scrollTop -
                element.clientHeight <
              80;
          }}
        >
          {layout.nodes.length === 0 ? (
            <div className="reasoning-graph__placeholder muted">
              {live
                ? "Waiting for the first substantive reasoning node…"
                : "No structured reasoning nodes were recorded."}
            </div>
          ) : (
            <svg
              className="reasoning-svg"
              width={layout.width}
              height={layout.height}
              style={{
                width: `${zoom * 100}%`,
              }}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMin meet"
              role="img"
              aria-label="Reasoning graph"
            >
              <defs>
                <marker
                  id="rg-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className="reasoning-arrow" />
                </marker>
              </defs>
              <g className="reasoning-turn-guides" aria-hidden="true">
                {layout.turnBands.map((band) => (
                  <g
                    key={band.turnIndex}
                    className={
                      band.turnIndex === selectedTurn
                        ? "reasoning-turn-guide is-selected"
                        : "reasoning-turn-guide"
                    }
                  >
                    <text x={14} y={band.y + 4}>
                      Turn {band.turnIndex}
                    </text>
                    <line
                      x1={68}
                      y1={band.y}
                      x2={layout.width - 22}
                      y2={band.y}
                    />
                  </g>
                ))}
              </g>
              {layout.edges.map((edge) => {
                const from = layout.nodes.find((n) => n.id === edge.from);
                const to = layout.nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const highlighted =
                  selectedNodeId === edge.from ||
                  selectedNodeId === edge.to ||
                  relatedToMessage(from, to, selectedMessageId);
                const label = edgeLabel(edge.kind);
                return (
                  <Fragment key={`${edge.kind}:${edge.from}->${edge.to}`}>
                    <path
                      d={edgePath(from, to)}
                      className={[
                        "reasoning-edge",
                        `reasoning-edge--${edge.kind}`,
                        highlighted ? "reasoning-edge--hot" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      markerEnd="url(#rg-arrow)"
                    />
                    {label ? (
                      <text
                        className="reasoning-edge__label"
                        x={(from.x + from.width / 2 + to.x + to.width / 2) / 2}
                        y={(from.y + from.height / 2 + to.y + to.height / 2) / 2 - 5}
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    ) : null}
                  </Fragment>
                );
              })}
              {layout.nodes.map((item) => (
                <ReasoningNodeGlyph
                  key={item.id}
                  item={item}
                  selected={
                    selectedNodeId === item.id ||
                    (Boolean(selectedMessageId) &&
                      item.node.sourceMessageId === selectedMessageId)
                  }
                  entering={enteringIds.has(item.id) && live}
                  speaking={
                    live &&
                    speakingAgentId === item.node.createdBy &&
                    item.node.sourceMessageId ===
                      conversation.messages[conversation.messages.length - 1]?.id
                  }
                  isFinal={item.id === FINAL_ID}
                  onSelect={() => {
                    if (suppressNodeClickRef.current) return;
                    if (item.id === FINAL_ID) {
                      const last = conversation.messages[conversation.messages.length - 1];
                      onSelectNode?.(FINAL_ID, last?.id);
                      return;
                    }
                    onSelectNode?.(item.node.id, item.node.sourceMessageId);
                  }}
                />
              ))}
            </svg>
          )}
        </div>

        <ReasoningDetail
          conversation={conversation}
          graph={graph}
          node={selected}
          isFinal={selectedNodeId === FINAL_ID}
          onJumpToMessage={(messageId) => {
            onSelectNode?.(selected?.id ?? selectedNodeId, messageId);
            onOpenSourceTurn?.(messageId, selected?.id ?? selectedNodeId);
          }}
        />
      </div>
    </div>
  );
}

function edgeLabel(kind: string): string | undefined {
  if (kind === "answers") return "answers";
  if (kind === "supports" || kind === "final") return "supports";
  if (kind === "challenges") return "challenges";
  if (kind === "depends_on" || kind === "dependency") return "depends on";
  if (kind === "revises" || kind === "supersedes") return "revises";
  return undefined;
}

function relatedToMessage(
  from: GraphLayoutNode,
  to: GraphLayoutNode,
  messageId?: string,
): boolean {
  if (!messageId) return false;
  return (
    from.node.sourceMessageId === messageId ||
    to.node.sourceMessageId === messageId
  );
}

function edgePath(from: GraphLayoutNode, to: GraphLayoutNode): string {
  if (from.turnIndex === to.turnIndex) {
    const leftToRight = from.x <= to.x;
    const x1 = leftToRight ? from.x + from.width : from.x;
    const x2 = leftToRight ? to.x : to.x + to.width;
    const y1 = from.y + from.height / 2;
    const y2 = to.y + to.height / 2;
    const bend = Math.max(24, Math.abs(x2 - x1) * 0.35);
    return `M ${x1} ${y1} C ${x1 + (leftToRight ? bend : -bend)} ${y1 - 24}, ${x2 + (leftToRight ? -bend : bend)} ${y2 - 24}, ${x2} ${y2}`;
  }

  const downward = from.y < to.y;
  const x1 = from.x + from.width / 2;
  const y1 = downward ? from.y + from.height : from.y;
  const x2 = to.x + to.width / 2;
  const y2 = downward ? to.y : to.y + to.height;
  const bend = Math.min(58, Math.max(28, Math.abs(y2 - y1) * 0.35));
  return `M ${x1} ${y1} C ${x1} ${y1 + (downward ? bend : -bend)}, ${x2} ${y2 + (downward ? -bend : bend)}, ${x2} ${y2}`;
}

function ReasoningLegend() {
  return (
    <ul className="reasoning-legend">
      <li>
        <i className="reasoning-swatch reasoning-swatch--a" /> A
      </li>
      <li>
        <i className="reasoning-swatch reasoning-swatch--b" /> B
      </li>
      <li>
        <i className="reasoning-swatch reasoning-swatch--open" /> open
      </li>
      <li>
        <i className="reasoning-swatch reasoning-swatch--accepted" /> accepted
      </li>
      <li>
        <i className="reasoning-swatch reasoning-swatch--rejected" /> rejected
      </li>
    </ul>
  );
}

function ReasoningNodeGlyph({
  item,
  selected,
  entering,
  speaking,
  isFinal,
  onSelect,
}: {
  item: GraphLayoutNode;
  selected: boolean;
  entering: boolean;
  speaking: boolean;
  isFinal: boolean;
  onSelect: () => void;
}) {
  const { node, x, y, width, height } = item;
  const taskSubject = node.metadata?.taskDefined === true;
  const owner = node.createdBy === "agent_a" ? "A" : "B";
  const title = isFinal
    ? "FINAL ANSWER"
    : taskSubject
      ? String(node.metadata?.subjectLabel ?? node.id)
      : node.id;
  const kind = isFinal ? "answer" : taskSubject ? "issue anchor" : node.type;
  const conf =
    !isFinal && typeof node.confidence === "number"
      ? node.confidence.toFixed(2)
      : undefined;
  const classes = [
    "reasoning-node",
    ownerClass(node.createdBy),
    statusClass(node.status),
    `reasoning-node--${node.type}`,
    selected ? "is-selected" : "",
    entering ? "is-entering" : "",
    speaking ? "is-speaking" : "",
    isFinal ? "reasoning-node--final" : "",
    taskSubject ? "reasoning-node--subject-anchor" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <g
      transform={`translate(${x}, ${y})`}
      data-reasoning-node-id={item.id}
    >
      <g
        className={classes}
        role={taskSubject ? "img" : "button"}
        tabIndex={taskSubject ? undefined : 0}
        onClick={taskSubject ? undefined : onSelect}
        onKeyDown={(event) => {
          if (taskSubject) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <rect width={width} height={height} rx={10} />
        <text className="reasoning-node__id" x={12} y={20}>
          {title} [{isFinal || taskSubject ? "·" : owner}]
        </text>
        <text className="reasoning-node__meta" x={12} y={36}>
          {kind}
          {conf ? ` · ${conf}` : ""}
          {isFinal || taskSubject ? "" : ` · ${node.status}`}
        </text>
        <text className="reasoning-node__text" x={12} y={54}>
          {truncate(node.text, isFinal ? 32 : 26)}
        </text>
      </g>
    </g>
  );
}

function ReasoningDetail({
  conversation,
  graph,
  node,
  isFinal,
  onJumpToMessage,
}: {
  conversation: ProblemConversation;
  graph: ReasoningGraph;
  node?: ReasoningNode;
  isFinal: boolean;
  onJumpToMessage: (messageId: string) => void;
}) {
  if (isFinal && conversation.finalAnswer) {
    const last = conversation.messages[conversation.messages.length - 1];
    return (
      <aside className="reasoning-detail">
        <h2>Final answer</h2>
        <p className="reasoning-detail__text">{conversation.finalAnswer}</p>
        {conversation.finalAnswerSupport?.supportingNodeIds?.length ? (
          <p className="muted">
            Supported by{" "}
            {conversation.finalAnswerSupport.supportingNodeIds.join(", ")}
          </p>
        ) : (
          <p className="muted">No supporting reasoning nodes cited.</p>
        )}
        {conversation.finalAnswerSupport?.errors?.length ? (
          <p className="reasoning-detail__error">
            Supporting-node linkage invalid:{" "}
            {conversation.finalAnswerSupport.errors.join("; ")}
          </p>
        ) : null}
        {last ? (
          <button
            type="button"
            className="reasoning-detail__link"
            onClick={() => onJumpToMessage(last.id)}
          >
            Source turn {last.turnIndex}
          </button>
        ) : null}
      </aside>
    );
  }

  if (!node) {
    return (
      <aside className="reasoning-detail reasoning-detail--empty">
        <p className="muted">
          Select a node to see provenance in the raw conversation.
        </p>
      </aside>
    );
  }

  const events = eventsForNode(graph, node.id);
  const stances = stancesForNode(graph, node.id);
  const source = conversation.messages.find((m) => m.id === node.sourceMessageId);
  const revisedInto = graph.nodes.find((n) => n.supersedes === node.id);
  const subjectId =
    node.type === "final_answer" ? undefined : node.subjectId;
  const subjectLabel =
    graph.subjects?.find((subject) => subject.id === subjectId)?.label ??
    graph.nodes.find(
      (candidate) => candidate.id === subjectId && candidate.type === "issue",
    )?.text;

  return (
    <aside className="reasoning-detail">
      <header className="reasoning-detail__head">
        <h2>
          {node.id}{" "}
          <span className="muted">
            {node.type} · {node.status}
          </span>
        </h2>
        <p className="reasoning-detail__text">“{node.text}”</p>
      </header>
      <dl className="reasoning-detail__meta">
        <div>
          <dt>Created</dt>
          <dd>
            {agentLabel(node.createdBy)}, turn {node.createdAtTurn}
          </dd>
        </div>
        {typeof node.confidence === "number" ? (
          <div>
            <dt>Confidence</dt>
            <dd>{node.confidence.toFixed(2)}</dd>
          </div>
        ) : null}
        {subjectId ? (
          <div>
            <dt>Answers issue</dt>
            <dd>
              {subjectLabel ? `${subjectLabel} · ` : ""}
              {subjectId}
            </dd>
          </div>
        ) : null}
        {node.parents.length > 0 ? (
          <div>
            <dt>Parents</dt>
            <dd>{node.parents.join(", ")}</dd>
          </div>
        ) : null}
        {node.dependencies.length > 0 ? (
          <div>
            <dt>Dependencies</dt>
            <dd>{node.dependencies.join(", ")}</dd>
          </div>
        ) : null}
        {node.supersedes ? (
          <div>
            <dt>Supersedes</dt>
            <dd>{node.supersedes}</dd>
          </div>
        ) : null}
        {revisedInto ? (
          <div>
            <dt>Revised into</dt>
            <dd>{revisedInto.id}</dd>
          </div>
        ) : null}
      </dl>
      {source ? (
        <div className="reasoning-detail__source">
          <h3>Source message</h3>
          <p className="reasoning-detail__quote">
            {truncate(source.content, 280)}
          </p>
          <button
            type="button"
            className="reasoning-detail__link"
            onClick={() => onJumpToMessage(source.id)}
          >
            Show turn {source.turnIndex} in transcript
          </button>
        </div>
      ) : null}
      {stances.length > 0 ? (
        <div>
          <h3>Stances</h3>
          <ul className="reasoning-detail__events">
            {stances.map((stance) => (
              <li key={`${stance.actor}:${stance.kind}`}>
                {agentLabel(stance.actor)} {stance.kind}
                {stance.reason ? ` — ${stance.reason}` : ""}
                <span className="muted"> · turn {stance.turnIndex}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {events.length > 0 ? (
        <div>
          <h3>Event history</h3>
          <ul className="reasoning-detail__events">
            {events.map((event) => (
              <li key={event.id}>
                {agentLabel(event.actor)} {event.intent.action}
                {event.accepted
                  ? event.operation.type === "create"
                    ? ` → ${event.operation.node.id}`
                    : event.operation.type === "revise"
                      ? ` → ${event.operation.replacement.id}`
                      : ""
                  : " (rejected)"}
                <span className="muted"> · turn {event.turnIndex}</span>
                {event.errors.length > 0 ? (
                  <div className="muted">{event.errors.join("; ")}</div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </aside>
  );
}
