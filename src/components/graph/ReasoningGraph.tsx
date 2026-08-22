/**
 * Reasoning Graph Inspector: subject lanes, revises + derived_from DAG,
 * and source-utterance linking.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentId } from "../../agents/types";
import { agentLabel } from "../../agents/identity";
import type { ProblemConversation } from "../../experiment/types";
import type { InformationAssignment } from "../../information/types";
import {
  checkGraphInvariants,
  computeCanonicalReasoningMetrics,
  computePersistenceDiagnostics,
  coverageForTurn,
  deriveReasoningAnalysis,
  describeRejectedAttempt,
  eventsForVersion,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  graphUsesConsiderationLanes,
  liveLabel,
  propositionCommitment,
  subjectDisplayTitle,
  versionPublicRef,
  versionsInCreationOrder,
  type CollaborationDiagnostics,
  type GraphLayoutNode,
  type MoralSynthesisDiagnostics,
  type PropositionVersion,
  type ReasoningGraph,
  type ReasoningGraphLayoutOptions,
  type TurnPersistenceCoverage,
} from "../../reasoning";
import { formatTurnMemoryForAudit } from "../../runtime/renderModelRequest";
import { TextPreviewModal } from "../ui/TextPreviewModal";

type Props = {
  conversation?: ProblemConversation;
  speakingAgentId?: AgentId;
  selectedNodeId?: string;
  selectedMessageId?: string;
  compact?: boolean;
  onSelectNode?: (nodeId: string | undefined, messageId?: string) => void;
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

function freezeTurnLabel(freezeType?: string): string {
  switch (freezeType) {
    case "local_loop":
      return "Freeze · local loop";
    case "semantic_stall_repeated_state":
      return "Freeze · repeated state";
    case "semantic_stall_state_cycle":
      return "Freeze · state cycle";
    case "semantic_stall_no_state_change":
      return "Freeze · no state change";
    default:
      return "Freeze detected";
  }
}

function graphFromConversation(
  conversation: ProblemConversation,
): ReasoningGraph {
  return hydrateReasoningGraph({
    reasoningSchemaVersion: conversation.reasoningSchemaVersion,
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningVersions: conversation.reasoningVersions,
    reasoningEvents: conversation.reasoningEvents,
  });
}

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function versionHitFromTarget(
  target: EventTarget | null,
): { nodeId: string; messageId?: string } | undefined {
  if (!(target instanceof Element)) return undefined;
  const el = target.closest("[data-version-id]");
  const nodeId = el?.getAttribute("data-version-id")?.trim();
  if (!nodeId) return undefined;
  const messageId = el?.getAttribute("data-message-id")?.trim();
  return { nodeId, messageId: messageId || undefined };
}

function versionHitFromPointer(
  event: { target: EventTarget | null; clientX: number; clientY: number },
): { nodeId: string; messageId?: string } | undefined {
  return (
    versionHitFromTarget(event.target) ??
    versionHitFromTarget(document.elementFromPoint(event.clientX, event.clientY))
  );
}

function turnHitFromTarget(target: EventTarget | null): number | undefined {
  if (!(target instanceof Element)) return undefined;
  const el = target.closest("[data-turn-index]");
  const raw = el?.getAttribute("data-turn-index")?.trim();
  if (!raw) return undefined;
  const turn = Number(raw);
  return Number.isFinite(turn) ? turn : undefined;
}

function turnHitFromPointer(
  event: { target: EventTarget | null; clientX: number; clientY: number },
): number | undefined {
  return (
    turnHitFromTarget(event.target) ??
    turnHitFromTarget(document.elementFromPoint(event.clientX, event.clientY))
  );
}

function laneProvenance(lane: {
  source?: string;
  createdBy?: string;
  createdAtTurn?: number;
  subjectId?: string;
}): string {
  if (lane.subjectId?.toLowerCase().startsWith("moral:") || lane.source === "agent") {
    const who =
      lane.createdBy === "agent_a" || lane.createdBy === "agent_b"
        ? agentLabel(lane.createdBy)
        : "an agent";
    const when =
      typeof lane.createdAtTurn === "number" ? ` · Turn ${lane.createdAtTurn}` : "";
    return `Created by ${who}${when}`;
  }
  if (lane.source === "task") return "From puzzle / task definition";
  return "";
}

export function ReasoningGraphView({
  conversation,
  speakingAgentId,
  selectedNodeId,
  selectedMessageId,
  compact,
  onSelectNode,
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
        nodeId?: string;
        messageId?: string;
        turnIndex?: number;
      }
    | undefined
  >(undefined);
  const [isPanning, setIsPanning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pickedNodeId, setPickedNodeId] = useState<string | undefined>();
  const live = conversation?.status === "running";

  const graph = useMemo(
    () =>
      conversation
        ? graphFromConversation(conversation)
        : {
            schemaVersion: 2 as const,
            subjects: [],
            versions: [],
            events: [],
          },
    [conversation],
  );
  const considerationGraph = graphUsesConsiderationLanes(graph);
  const displayedSubjects = graph.subjects;
  const displayedVersionCount = graph.versions.length;
  const laneNouns = considerationGraph ? "considerations" : "subjects";

  useEffect(() => {
    prevIdsRef.current = new Set();
    setZoom(1);
    followLiveRef.current = true;
    setPickedNodeId(undefined);
  }, [conversation?.problemId]);

  useEffect(() => {
    if (!expanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  const layoutOptions = useMemo<ReasoningGraphLayoutOptions>(() => {
    const turns = (conversation?.messages ?? []).map((message) => {
      const coverage = coverageForTurn(graph, message.turnIndex, message);
      return {
        turnIndex: message.turnIndex,
        agentId: message.agentId,
        persistentChange: coverage.persistentChange,
      };
    });
    return {
      turns: turns.length > 0 ? turns : undefined,
    };
  }, [conversation, graph]);

  const layout = useMemo(
    () => layoutReasoningGraph(graph, layoutOptions),
    [graph, layoutOptions],
  );
  const metrics = useMemo(
    () => computeCanonicalReasoningMetrics(graph),
    [graph],
  );
  const integrity = useMemo(() => checkGraphInvariants(graph), [graph]);
  const rejected = useMemo(
    () => graph.events.filter((event) => !event.accepted),
    [graph],
  );
  const selectedTurn = useMemo(() => {
    if (!conversation || !selectedMessageId) return undefined;
    return conversation.messages.find((message) => message.id === selectedMessageId)
      ?.turnIndex;
  }, [conversation, selectedMessageId]);
  const persistence = useMemo(
    () =>
      computePersistenceDiagnostics(
        graph,
        (conversation?.messages ?? []).map((message) => ({
          id: message.id,
          turnIndex: message.turnIndex,
          content: message.content,
        })),
      ),
    [conversation, graph],
  );
  const turnCoverage = useMemo(() => {
    if (!conversation || selectedTurn === undefined) return undefined;
    const message = conversation.messages.find(
      (item) => item.turnIndex === selectedTurn,
    );
    return coverageForTurn(graph, selectedTurn, message);
  }, [conversation, graph, selectedTurn]);

  const enteringIds = useMemo(() => {
    const prev = prevIdsRef.current;
    const next = new Set(layout.nodes.map((n) => n.id));
    const entering = new Set<string>();
    const firstPaint = prev.size === 0;
    if (live && !firstPaint) {
      for (const node of layout.nodes) {
        if (!prev.has(node.id)) entering.add(node.id);
      }
    }
    prevIdsRef.current = next;
    return entering;
  }, [layout, live]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !live || enteringIds.size === 0 || !followLiveRef.current) {
      return;
    }
    const newest = [...layout.nodes]
      .reverse()
      .find((node) => enteringIds.has(node.id));
    if (!newest) return;
    canvas.scrollTo({
      left: Math.max(0, newest.x * zoom - canvas.clientWidth / 4),
      top: Math.max(0, newest.y * zoom - canvas.clientHeight / 3),
      behavior: "smooth",
    });
  }, [enteringIds, layout, live, zoom]);

  useEffect(() => {
    if (!selectedNodeId) setPickedNodeId(undefined);
  }, [selectedMessageId, selectedNodeId]);

  const focusedNodeId = selectedNodeId ?? pickedNodeId;
  const selectedVersion = focusedNodeId
    ? (layout.nodes.find((node) => node.id === focusedNodeId)?.version ??
      graph.versions.find((version) => version.id === focusedNodeId))
    : undefined;
  const detailOpen = Boolean(selectedVersion) || selectedTurn !== undefined;
  const freezeDetectedTurn =
    conversation?.reasoningDiagnostics?.solverProgress?.freezeDetectedTurn;
  const freezeType =
    conversation?.reasoningDiagnostics?.solverProgress?.freezeType;

  const selectVersion = (nodeId: string | undefined, messageId?: string) => {
    setPickedNodeId(nodeId);
    onSelectNode?.(nodeId, messageId);
  };

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom)));
  };

  const frameClass = [
    "reasoning-graph",
    considerationGraph ? "reasoning-graph--considerations" : "",
    compact && !expanded ? "reasoning-graph--compact" : "",
    expanded ? "reasoning-graph--expanded" : "",
    detailOpen ? "reasoning-graph--detail-open" : "reasoning-graph--canvas-only",
  ]
    .filter(Boolean)
    .join(" ");

  const emptyState = (message: string) => (
    <div className={frameClass}>
      <p className="reasoning-graph__placeholder">{message}</p>
    </div>
  );

  if (!conversation) {
    return emptyState("No conversation selected.");
  }

  if (graph.schemaVersion === 1 || conversation.reasoningSchemaVersion === 1) {
    return emptyState(
      "This run used the retired dense graph. Transcript and raw events remain inspectable; they are not converted into versioned proposition state.",
    );
  }

  const empty = layout.nodes.length === 0;

  const frame = (
    <div ref={graphRef} className={frameClass}>
      <header className="reasoning-graph__header">
        <div className="reasoning-graph__title-block">
          <h3>{considerationGraph ? "Considerations" : "Reasoning Graph"}</h3>
          <p className="muted">
            {considerationGraph
              ? "Each lane is one independently revisable consideration."
              : `${graph.versions.length} version${graph.versions.length === 1 ? "" : "s"} · ${graph.subjects.length} subject${graph.subjects.length === 1 ? "" : "s"}`}
          </p>
          {considerationGraph ? (
            <p className="muted">
              {displayedVersionCount} version{displayedVersionCount === 1 ? "" : "s"}
              {" · "}
              {displayedSubjects.length} {laneNouns}
            </p>
          ) : null}
        </div>
        <div className="reasoning-graph__controls">
          <div className="reasoning-graph__zoom-controls">
            <button
              type="button"
              className="reasoning-graph__tool"
              aria-label="Zoom out"
              onClick={() => changeZoom(zoom - ZOOM_STEP)}
            >
              −
            </button>
            <span className="reasoning-graph__zoom-level">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              className="reasoning-graph__tool"
              aria-label="Zoom in"
              onClick={() => changeZoom(zoom + ZOOM_STEP)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className="reasoning-graph__expand"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <ExpandIcon expanded={expanded} />
            {expanded ? "Close" : "Expand"}
          </button>
        </div>
      </header>

      {integrity.length > 0 ? (
        <div className="reasoning-graph__integrity" role="status">
          Graph integrity: {integrity.map((item) => item.detail).join(" · ")}
        </div>
      ) : null}

      {considerationGraph && conversation ? (
        <section className="reasoning-final-answer" aria-label="Final answer">
          <h4>Final answer</h4>
          {conversation.finalAnswer?.trim() ||
          conversation.stoppedReason === "final_answer" ? (
            <>
              <p className="reasoning-final-answer__meta">
                {conversation.stoppedReason === "final_answer" &&
                graph.finalAnswer?.turn != null
                  ? `Turn ${graph.finalAnswer.turn}`
                  : "Recorded"}
                {" · "}
                {(() => {
                  const basisCount = conversation.finalBasisVersionIds?.length ?? 0;
                  if (!conversation.finalBasisDeclared) {
                    return "Basis not explicitly declared";
                  }
                  if (basisCount === 0) return "Basis declared empty";
                  return `${basisCount} consideration${basisCount === 1 ? "" : "s"} in basis`;
                })()}
              </p>
              <p className="reasoning-final-answer__text">
                {conversation.finalAnswer?.trim() ||
                  "Final answer marker recorded without extractable text."}
              </p>
            </>
          ) : (
            <p className="reasoning-final-answer__text muted">
              Final answer not yet recorded.
            </p>
          )}
        </section>
      ) : null}

      <div className="reasoning-graph__body">
        <div
          ref={canvasRef}
          className={[
            "reasoning-graph__canvas",
            isPanning ? "is-panning" : "",
            zoom !== 1 ? "is-zoomed" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const canvas = canvasRef.current;
            if (!canvas) return;
            followLiveRef.current = false;
            suppressNodeClickRef.current = false;
            const hit = versionHitFromPointer(event);
            const turnIndex = turnHitFromPointer(event);
            panRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              scrollLeft: canvas.scrollLeft,
              scrollTop: canvas.scrollTop,
              moved: false,
              nodeId: hit?.nodeId,
              messageId: hit?.messageId,
              turnIndex,
            };
            // Capture so pointerup still lands here, but do not treat this as a
            // pan yet — capturing immediately used to swallow the node click.
            canvas.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const pan = panRef.current;
            const canvas = canvasRef.current;
            if (!pan || pan.pointerId !== event.pointerId || !canvas) return;
            const dx = event.clientX - pan.startX;
            const dy = event.clientY - pan.startY;
            if (!pan.moved && Math.abs(dx) + Math.abs(dy) > 6) {
              pan.moved = true;
              setIsPanning(true);
            }
            if (!pan.moved) return;
            canvas.scrollLeft = pan.scrollLeft - dx;
            canvas.scrollTop = pan.scrollTop - dy;
          }}
          onPointerUp={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            const { moved, nodeId, messageId, turnIndex } = pan;
            panRef.current = undefined;
            canvasRef.current?.releasePointerCapture(event.pointerId);
            if (moved) {
              setIsPanning(false);
              suppressNodeClickRef.current = true;
              return;
            }
            if (nodeId) {
              suppressNodeClickRef.current = true;
              selectVersion(nodeId, messageId);
              return;
            }
            if (turnIndex !== undefined && conversation) {
              const message = conversation.messages.find(
                (item) => item.turnIndex === turnIndex,
              );
              if (message) {
                suppressNodeClickRef.current = true;
                selectVersion(undefined, message.id);
              }
              return;
            }
            if (detailOpen) {
              suppressNodeClickRef.current = true;
              selectVersion(undefined);
            }
          }}
          onPointerCancel={(event) => {
            const pan = panRef.current;
            if (!pan || pan.pointerId !== event.pointerId) return;
            panRef.current = undefined;
            setIsPanning(false);
            canvasRef.current?.releasePointerCapture(event.pointerId);
          }}
        >
          {empty && layout.lanes.length === 0 && layout.turnBands.length === 0 ? (
            <p className="reasoning-graph__placeholder">
              {considerationGraph ||
              (conversation?.problemText &&
                /Discuss this ethical|Discussion question:/i.test(
                  conversation.problemText,
                ))
                ? "No considerations yet. Lanes appear when an agent SETs a new consideration."
                : "No proposition versions yet. Zero-mutation turns are valid; the graph fills when agents SET or REVISE."}
            </p>
          ) : (
            <svg
              className="reasoning-svg"
              width={layout.width * zoom}
              height={layout.height * zoom}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMinYMin meet"
              style={{
                width: layout.width * zoom,
                height: layout.height * zoom,
              }}
            >
              {layout.lanes.map((lane) => (
                <g
                  key={lane.subjectId}
                  className="reasoning-lane"
                >
                  <rect
                    x={8}
                    y={lane.y}
                    width={layout.width - 16}
                    height={lane.height}
                    rx={8}
                  />
                  <text x={18} y={lane.y + 20}>
                    {truncate(lane.label, considerationGraph ? 32 : 22)}
                  </text>
                  {laneProvenance(lane) ? (
                    <text className="reasoning-lane__origin" x={18} y={lane.y + 36}>
                      {truncate(laneProvenance(lane), 34)}
                    </text>
                  ) : null}
                </g>
              ))}
              {layout.turnBands.map((band) => {
                const isFreezeTurn =
                  freezeDetectedTurn !== undefined &&
                  band.turnIndex === freezeDetectedTurn;
                const secondaryLabel = isFreezeTurn
                  ? freezeTurnLabel(freezeType)
                  : band.persistentChange === false
                    ? "No persistent change"
                    : undefined;
                return (
                  <g
                    key={band.turnIndex}
                    className={[
                      "reasoning-turn-guide",
                      band.persistentChange === false
                        ? "reasoning-turn-guide--empty"
                        : "",
                      isFreezeTurn ? "reasoning-turn-guide--freeze" : "",
                      selectedTurn === band.turnIndex
                        ? "reasoning-turn-guide--selected"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <line
                      x1={band.x + band.width / 2}
                      y1={48}
                      x2={band.x + band.width / 2}
                      y2={layout.height - 8}
                    />
                    <rect
                      className="reasoning-turn-guide__hit"
                      data-turn-index={band.turnIndex}
                      x={band.x - 8}
                      y={4}
                      width={band.width + 16}
                      height={44}
                      rx={6}
                      style={{ pointerEvents: "all", cursor: "pointer" }}
                    />
                    <text x={band.x} y={18}>
                      Turn {band.turnIndex}
                      {band.agentId ? ` · ${agentLabel(band.agentId)}` : ""}
                    </text>
                    {secondaryLabel ? (
                      <text
                        className={
                          isFreezeTurn
                            ? "reasoning-turn-guide__freeze"
                            : "reasoning-turn-guide__empty"
                        }
                        x={band.x}
                        y={34}
                      >
                        {secondaryLabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {layout.edges.map((edge) => {
                if (edge.kind === "final_synthesis") return null;
                const from = layout.nodes.find((node) => node.id === edge.from);
                const to = layout.nodes.find((node) => node.id === edge.to);
                if (!from || !to) return null;
                const x1 = from.x + from.width;
                const y1 = from.y + from.height / 2;
                const x2 = to.x;
                const y2 = to.y + to.height / 2;
                const midX = (x1 + x2) / 2;
                const path =
                  edge.kind === "derived_from"
                    ? `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`
                    : `M ${x1} ${y1} L ${x2} ${y2}`;
                return (
                  <g
                    key={`${edge.kind}:${edge.from}->${edge.to}`}
                    className={[
                      "reasoning-edge",
                      edge.kind === "derived_from"
                        ? "reasoning-edge--derived-from"
                        : "reasoning-edge--revises",
                    ].join(" ")}
                  >
                    <path d={path} markerEnd="url(#reasoning-arrow)" />
                    <title>
                      {edge.kind === "revises"
                        ? `Revises ${edge.from} → ${edge.to} · turn ${edge.turnIndex ?? "?"}`
                        : `Derived from ${edge.from} → ${edge.to} · declared by ${edge.declaredBy ? agentLabel(edge.declaredBy as AgentId) : "?"} at turn ${edge.turnIndex ?? "?"}`}
                    </title>
                  </g>
                );
              })}
              <defs>
                <marker
                  id="reasoning-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {layout.nodes.map((item) => (
                <VersionNode
                  key={item.id}
                  item={item}
                  graph={graph}
                  selected={item.id === focusedNodeId}
                  speaking={
                    Boolean(speakingAgentId) &&
                    item.version.agentId === speakingAgentId
                  }
                  entering={enteringIds.has(item.id)}
                  inFinalBasis={
                    conversation?.finalBasisVersionIds?.includes(item.id) === true
                  }
                  onSelect={() => {
                    if (suppressNodeClickRef.current) {
                      suppressNodeClickRef.current = false;
                      return;
                    }
                    selectVersion(item.id, item.version.sourceMessageId);
                  }}
                />
              ))}
            </svg>
          )}
        </div>
        {detailOpen ? (
          <aside className="reasoning-detail">
            {selectedVersion ? (
              <VersionDetail
                graph={graph}
                version={selectedVersion}
                consideration={considerationGraph}
                assignment={conversation.informationAssignment}
              />
            ) : selectedTurn !== undefined ? (
              <MemoryAtTurn
                graph={graph}
                conversation={conversation}
                turn={selectedTurn}
                coverage={turnCoverage}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      <div className="reasoning-graph__footer">
        <MetricsStrip
          laneNoun={laneNouns}
          subjectCount={displayedSubjects.length}
          versionCount={displayedVersionCount}
          metrics={metrics}
          rejectedCount={rejected.length}
          persistence={persistence}
          moralSynthesis={conversation?.reasoningDiagnostics?.moralSynthesis}
          collaboration={conversation?.reasoningDiagnostics?.collaboration}
        />
        <InferredAnalysis graph={graph} />
        {rejected.length > 0 ? (
          <RejectedList
            events={
              selectedTurn !== undefined
                ? rejected.filter((event) => event.turnIndex === selectedTurn)
                : rejected
            }
            selectedTurn={selectedTurn}
          />
        ) : null}
      </div>
    </div>
  );

  if (!expanded) return frame;

  return (
    <>
      <div className="reasoning-graph reasoning-graph--placeholder" aria-hidden>
        <p className="muted">Graph open in modal.</p>
      </div>
      {createPortal(
        <div
          className="reasoning-graph-modal"
          role="presentation"
          onClick={() => setExpanded(false)}
        >
          <div
            className="reasoning-graph-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Reasoning graph"
            onClick={(event) => event.stopPropagation()}
          >
            {frame}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function ExpandIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {expanded ? (
        <path d="M5 3H3v2M11 3h2v2M3 11v2h2M13 11v2h-2" />
      ) : (
        <path d="M6 3H3v3M10 3h3v3M3 10v3h3M13 10v3h-3" />
      )}
    </svg>
  );
}

function VersionNode({
  item,
  graph,
  selected,
  speaking,
  entering,
  inFinalBasis,
  onSelect,
}: {
  item: GraphLayoutNode;
  graph: ReasoningGraph;
  selected: boolean;
  speaking: boolean;
  entering: boolean;
  inFinalBasis?: boolean;
  onSelect: () => void;
}) {
  const version = item.version;
  const ownerClass =
    version.agentId === "agent_a" ? "reasoning-node--a" : "reasoning-node--b";
  const statusClass =
    version.status === "superseded"
      ? "reasoning-node--superseded"
      : version.status === "removed"
        ? "reasoning-node--rejected"
        : "reasoning-node--accepted";
  const commitment = propositionCommitment(version);
  const commitmentClass =
    commitment === "tentative"
      ? "reasoning-node--tentative"
      : "reasoning-node--committed";
  const ordinal =
    versionsInCreationOrder(graph.versions, version.subjectId).findIndex(
      (itemVersion) => itemVersion.id === version.id,
    ) + 1;
  const subjectLabel = subjectDisplayTitle(
    item.subject ?? { id: version.subjectId },
  );
  return (
    <g
      className={[
        "reasoning-node",
        ownerClass,
        statusClass,
        commitmentClass,
        selected ? "is-selected" : "",
        speaking ? "is-speaking" : "",
        entering ? "is-entering" : "",
        version.status === "active" ? "is-active" : "",
        inFinalBasis ? "is-final-basis" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-version-id={version.id}
      data-message-id={version.sourceMessageId ?? ""}
      transform={`translate(${item.x} ${item.y})`}
      style={{ pointerEvents: "all" }}
      onClick={onSelect}
    >
      <rect width={item.width} height={item.height} rx={6} />
      <text className="reasoning-node__id" x={12} y={16}>
        {truncate(subjectLabel, 22)}
      </text>
      <text className="reasoning-node__meta" x={12} y={32}>
        {agentLabel(version.agentId)} · t{version.turn} · v{ordinal || "?"}
      </text>
      <text className="reasoning-node__meta" x={12} y={46}>
        {liveLabel(version.status)}
        {version.status === "active" ? " [ACTIVE]" : ""}
        {inFinalBasis ? " · final" : ""}
        {" · "}
        {commitment}
      </text>
      <text className="reasoning-node__text" x={12} y={64}>
        {truncate(version.content, 24)}
      </text>
    </g>
  );
}

function VersionDetail({
  graph,
  version,
  consideration,
  assignment,
}: {
  graph: ReasoningGraph;
  version: PropositionVersion;
  consideration?: boolean;
  assignment?: InformationAssignment;
}) {
  const events = eventsForVersion(graph, version.id);
  const subject = graph.subjects.find((item) => item.id === version.subjectId);
  const sourceIds = version.sourceInformationIds ?? [];
  const derivedIds = version.derivedFromVersionIds ?? [];
  const ownershipLabel = (id: string): string => {
    if (!assignment) return "";
    if (assignment.sharedUnitIds.includes(id)) return " [shared]";
    if (assignment.agentAOnlyUnitIds.includes(id)) return " [private to A]";
    if (assignment.agentBOnlyUnitIds.includes(id)) return " [private to B]";
    return "";
  };
  return (
    <>
      <h3>{versionPublicRef(graph, version)}</h3>
      <dl className="reasoning-detail__meta">
        <div>
          <dt>{consideration ? "Consideration" : "Subject"}</dt>
          <dd>{subjectDisplayTitle(subject ?? { id: version.subjectId })}</dd>
        </div>
        <div>
          <dt>Lane provenance</dt>
          <dd>
            {subject
              ? laneProvenance({
                  source: subject.source,
                  createdBy: subject.createdBy,
                  createdAtTurn: subject.createdAtTurn,
                  subjectId: subject.id,
                }) || "—"
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>{agentLabel(version.agentId)}</dd>
        </div>
        <div>
          <dt>Turn</dt>
          <dd>{version.turn}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            {liveLabel(version.status)} · {propositionCommitment(version)}
          </dd>
        </div>
        <div>
          <dt>Content</dt>
          <dd>{version.content}</dd>
        </div>
        <div>
          <dt>Source task information</dt>
          <dd>
            {sourceIds.length > 0
              ? sourceIds
                  .map((id) => `${id}${ownershipLabel(id)}`)
                  .join(", ")
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Derived from graph</dt>
          <dd>{derivedIds.length > 0 ? derivedIds.join(", ") : "—"}</dd>
        </div>
      </dl>
      {events.length > 0 ? (
        <details className="reasoning-detail__debug">
          <summary>Mutation event JSON</summary>
          <pre className="mono">{JSON.stringify(events, null, 2)}</pre>
        </details>
      ) : null}
    </>
  );
}

function MemoryAtTurn({
  graph,
  conversation,
  turn,
  coverage,
}: {
  graph: ReasoningGraph;
  conversation: ProblemConversation;
  turn: number;
  coverage?: TurnPersistenceCoverage;
}) {
  const [memoryOpen, setMemoryOpen] = useState(false);
  const message = conversation.messages.find((item) => item.turnIndex === turn);
  const mutations = message?.reasoningMutations ?? [];
  const speaker = message ? agentLabel(message.agentId) : "unknown";
  const mutationSummary =
    mutations.length > 0
      ? mutations.map((mutation) => mutation.type).join(", ")
      : "No persistent mutations";
  return (
    <section className="reasoning-memory" aria-label={`Turn ${turn} audit`}>
      <header className="reasoning-memory__header">
        <div>
          <h3>
            Turn {turn}
            {message ? ` · ${agentLabel(message.agentId)}` : ""}
          </h3>
          <p className="muted">
            utterance → structured persistence → resulting memory
            {coverage && !coverage.persistentChange
              ? " · NO PERSISTENT CHANGE"
              : ""}
            {coverage?.persistenceReview ? " · PERSISTENCE REVIEW" : ""}
          </p>
        </div>
        <button
          type="button"
          className="transcript__msg-audit"
          onClick={() => setMemoryOpen(true)}
        >
          Memory
        </button>
      </header>
      {message?.content ? (
        <blockquote className="reasoning-detail__quote">
          {message.content}
        </blockquote>
      ) : (
        <p className="muted">No utterance for this turn.</p>
      )}
      <p className="reasoning-memory__mutations muted">{mutationSummary}</p>
      {coverage && coverage.rejected > 0 ? (
        <div className="reasoning-memory__rejected">
          <p>Attempted this turn</p>
          <ul>
            {graph.events
              .filter(
                (event) => event.turnIndex === turn && !event.accepted,
              )
              .map((event) => (
                <li key={event.id}>{describeRejectedAttempt(event)}</li>
              ))}
          </ul>
        </div>
      ) : null}
      {coverage ? (
        <dl className="reasoning-memory__coverage">
          <div>
            <dt>Mutations emitted</dt>
            <dd>{coverage.emitted}</dd>
          </div>
          <div>
            <dt>Accepted</dt>
            <dd>{coverage.accepted}</dd>
          </div>
          <div>
            <dt>Rejected</dt>
            <dd>{coverage.rejected}</dd>
          </div>
          <div>
            <dt>
              {graphUsesConsiderationLanes(graph)
                ? "Considerations changed"
                : "Subjects changed"}
            </dt>
            <dd>
              {coverage.subjectsChanged.length > 0
                ? coverage.subjectsChanged.join(", ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt>Basis</dt>
            <dd>
              {coverage.basisRefs.length > 0 ? coverage.basisRefs.join(", ") : "—"}
            </dd>
          </div>
        </dl>
      ) : null}
      {memoryOpen ? (
        <TextPreviewModal
          title={`Memory · turn ${turn} · ${speaker}`}
          text={formatTurnMemoryForAudit({ graph, conversation, turn })}
          onClose={() => setMemoryOpen(false)}
        />
      ) : null}
    </section>
  );
}

function MetricsStrip({
  laneNoun,
  subjectCount,
  versionCount,
  metrics,
  rejectedCount,
  persistence,
  moralSynthesis,
  collaboration,
}: {
  laneNoun: string;
  subjectCount: number;
  versionCount: number;
  metrics: ReturnType<typeof computeCanonicalReasoningMetrics>;
  rejectedCount: number;
  persistence: ReturnType<typeof computePersistenceDiagnostics>;
  moralSynthesis?: MoralSynthesisDiagnostics;
  collaboration?: CollaborationDiagnostics;
}) {
  return (
    <ul className="reasoning-graph__metrics">
      <li>
        {laneNoun.charAt(0).toUpperCase() + laneNoun.slice(1)} {subjectCount}
      </li>
      <li>Versions {versionCount}</li>
      <li>SET {persistence.setCount}</li>
      <li>REVISE {persistence.reviseCount}</li>
      <li>REMOVE {persistence.removeCount}</li>
      <li>
        Persistent turns {persistence.turnsWithPersistentChange}/
        {persistence.turnsWithPersistentChange +
          persistence.turnsWithoutPersistentChange}
      </li>
      {collaboration ? (
        <>
          <li>Turns {collaboration.turnCount}</li>
          <li>Handoffs {collaboration.handoffCount}</li>
          <li>
            Graph-change turns {collaboration.materialGraphChangeTurns}
          </li>
          <li>
            A/B change turns {collaboration.aChangeTurns}/
            {collaboration.bChangeTurns}
          </li>
          <li>
            Convergence attempts/resets {collaboration.convergenceAttempts}/
            {collaboration.convergenceResets}
          </li>
          <li>
            Created A/B {collaboration.distinctConsiderationsCreatedA}/
            {collaboration.distinctConsiderationsCreatedB}
          </li>
          <li>
            Revisions A/B {collaboration.revisionsA}/{collaboration.revisionsB}
          </li>
          {collaboration.turnScopes && collaboration.turnScopes.length > 0 ? (
            <li>
              Turn-1 touched{" "}
              {collaboration.turnScopes.find((scope) => scope.turnIndex === 1)
                ?.considerationsTouched ?? "—"}
              {" · "}
              mean touch/turn{" "}
              {(
                collaboration.turnScopes.reduce(
                  (sum, scope) => sum + scope.considerationsTouched,
                  0,
                ) / collaboration.turnScopes.length
              ).toFixed(1)}
              {" · "}
              mean msg chars{" "}
              {(
                collaboration.turnScopes.reduce(
                  (sum, scope) => sum + scope.messageChars,
                  0,
                ) / collaboration.turnScopes.length
              ).toFixed(0)}
            </li>
          ) : null}
        </>
      ) : null}
      {moralSynthesis ? (
        <>
          <li>
            Final basis {moralSynthesis.finalBasisCount}
            {moralSynthesis.finalBasisDeclared ? "" : " (undeclared)"}
          </li>
          <li>
            Ref coverage{" "}
            {moralSynthesis.referenceConsiderationCoverage === null
              ? "—"
              : `${(moralSynthesis.referenceConsiderationCoverage * 100).toFixed(0)}%`}
          </li>
          <li>Novel {moralSynthesis.novelConsiderationCount}</li>
          <li>Unused active {moralSynthesis.unusedActiveConsiderationCount}</li>
        </>
      ) : null}
      <li>
        Tentative/committed {persistence.tentativeStateCount}/
        {persistence.committedStateCount}
      </li>
      <li>
        Graph/transcript{" "}
        {persistence.graphToTranscriptRatio === null
          ? "—"
          : persistence.graphToTranscriptRatio.toFixed(2)}
      </li>
      <li>Mean chars {persistence.meanPropositionChars.toFixed(0)}</li>
      <li>Max chars {persistence.maxPropositionChars}</li>
      <li>Rejected {rejectedCount}</li>
      <li>Basis coverage {(metrics.basisCoverageRate * 100).toFixed(0)}%</li>
      <li>Review flags {persistence.persistenceReviewTurnCount}</li>
    </ul>
  );
}

function InferredAnalysis({ graph }: { graph: ReasoningGraph }) {
  const analysis = deriveReasoningAnalysis(graph);
  return (
    <details className="reasoning-graph__inferred">
      <summary>Inferred (not canonical)</summary>
      <ul>
        <li>Likely synthesis {analysis.likelySynthesisCount}</li>
        <li>Likely A→B deference {analysis.likelyDeferenceAB}</li>
        <li>Likely B→A deference {analysis.likelyDeferenceBA}</li>
        <li>Partner overwrites {analysis.likelyDisagreementRevisions}</li>
      </ul>
    </details>
  );
}

function RejectedList({
  events,
  selectedTurn,
}: {
  events: ReasoningGraph["events"];
  selectedTurn?: number;
}) {
  if (events.length === 0) {
    return <p className="muted">No rejected mutations.</p>;
  }
  return (
    <details className="reasoning-graph__rejected" open>
      <summary>
        Rejected events ({events.length})
        {selectedTurn !== undefined ? ` · turn ${selectedTurn}` : ""}
      </summary>
      <ul>
        {events.map((event) => (
          <li key={event.id}>{describeRejectedAttempt(event)}</li>
        ))}
      </ul>
    </details>
  );
}
