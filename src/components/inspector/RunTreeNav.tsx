/**
 * Inspector left-nav: nested folders + runs, with HTML5 drag-and-drop.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { formatPolicyValue } from "../../communication";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import { resolveRunModel } from "../../experiment/configAccessors";
import { isProblemAnalysisRunning } from "../../experiment/evaluationUi";
import {
  loadExpandedFolderIds,
  saveExpandedFolderIds,
} from "../../experiment/persistence";
import {
  ancestorFolderIds,
  countDescendantRuns,
  isValidMove,
  type DraggedTreeItem,
  type DropTarget,
  type RunTree,
  type RunTreeFolder,
  type RunTreeNode,
} from "../../experiment/runTree";
import { displayRunTitle } from "../../experiment/runTitle";
import { formatActualUsd, getRunCostSummary } from "../../experiment/runCost";
import type { EvaluationUiState } from "../../experiment/store";
import type { ExperimentRun } from "../../experiment/types";
import { displayNameForModel } from "../../models/modelRegistry";
import { InlineEditableText } from "../ui/InlineEditableText";
import { InspectorBusySpinner } from "./shared";

const DRAG_PREFIX = "run-tree:";
const EXPAND_ON_HOVER_MS = 450;

function runMetaLine(run: ExperimentRun): string {
  const { config, policy } = run;
  const parts = [
    config.problemCategory,
    displayNameForModel(resolveRunModel(config)),
    `Tₐ ${formatPolicyValue(policy.trustA)} Tᵦ ${formatPolicyValue(policy.trustB)}`,
    `Auth ${formatPolicyValue(policy.authority)}`,
    `F ${formatPolicyValue(policy.familiarity)}`,
  ];
  const summary = getRunCostSummary(run);
  if (summary.hasConversationUsage || summary.evaluationsRan) {
    parts.push(formatActualUsd(summary.actualTotalCost));
  }
  return parts.join(" · ");
}

function encodeDrag(item: DraggedTreeItem): string {
  return DRAG_PREFIX + JSON.stringify(item);
}

function decodeDrag(raw: string | undefined): DraggedTreeItem | null {
  if (!raw || !raw.startsWith(DRAG_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(DRAG_PREFIX.length)) as DraggedTreeItem;
    if (parsed.kind === "run" && typeof parsed.runId === "string") return parsed;
    if (parsed.kind === "folder" && typeof parsed.folderId === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function sameDrop(a: DropTarget | null, b: DropTarget | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dropClass(current: DropTarget | null, candidate: DropTarget): string {
  if (!sameDrop(current, candidate)) return "";
  if (candidate.placement === "inside") return " conv-tree__item--drop-inside";
  if (candidate.placement === "before") return " conv-tree__item--drop-before";
  if (candidate.placement === "after") return " conv-tree__item--drop-after";
  return " conv-tree__item--drop-end";
}

function placementFromRow(
  event: DragEvent,
  kind: "run" | "folder",
): "before" | "after" | "inside" {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = (event.clientY - rect.top) / Math.max(1, rect.height);
  if (kind === "folder") {
    if (y < 0.28) return "before";
    if (y > 0.72) return "after";
    return "inside";
  }
  return y < 0.5 ? "before" : "after";
}

export type RunTreeNavProps = {
  runs: ExperimentRun[];
  runTree: RunTree;
  selectedRun?: ExperimentRun;
  selectedProblemId?: string;
  inspectorFocus?: number;
  evaluationUi?: EvaluationUiState;
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string, runId?: string) => void;
  onDeleteRun: (runId: string) => void;
  onRenameRun: (runId: string, title: string) => void;
  onRenameProblem: (runId: string, problemId: string, title: string) => void;
  onCreateFolder: () => string;
  onRenameFolder: (folderId: string, title: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onMoveTreeItem: (dragged: DraggedTreeItem, target: DropTarget) => void;
};

export function RunTreeNav({
  runs,
  runTree,
  selectedRun,
  selectedProblemId,
  inspectorFocus = 0,
  evaluationUi,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
  onRenameRun,
  onRenameProblem,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveTreeItem,
}: RunTreeNavProps) {
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<ReadonlySet<string>>(
    () => new Set(loadExpandedFolderIds()),
  );
  const [editingFolderId, setEditingFolderId] = useState<string | undefined>();
  const [dragging, setDragging] = useState<DraggedTreeItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const hoverExpandTimer = useRef<number | undefined>(undefined);
  const runsById = new Map(runs.map((run) => [run.id, run]));

  useEffect(() => {
    saveExpandedFolderIds(expandedFolderIds);
  }, [expandedFolderIds]);

  useEffect(() => {
    const runId = selectedRun?.id;
    if (!runId) return;
    const ancestors = ancestorFolderIds(runTree, runId);
    if (ancestors.length === 0) return;
    setExpandedFolderIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // inspectorFocus: expand ancestors when the scatter plot re-selects a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectedRun?.id, inspectorFocus]);

  const toggleRunExpanded = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const clearHoverExpand = () => {
    if (hoverExpandTimer.current !== undefined) {
      window.clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = undefined;
    }
  };

  const handleDragStart = (event: DragEvent, item: DraggedTreeItem) => {
    event.dataTransfer.setData("text/plain", encodeDrag(item));
    event.dataTransfer.effectAllowed = "move";
    setDragging(item);
  };

  const handleDragEnd = () => {
    clearHoverExpand();
    setDragging(null);
    setDropTarget(null);
  };

  const draggedItem = (event: DragEvent): DraggedTreeItem | null =>
    dragging ?? decodeDrag(event.dataTransfer.getData("text/plain"));

  const applyDropTarget = (target: DropTarget | null) => {
    setDropTarget((prev) => (sameDrop(prev, target) ? prev : target));
  };

  const handleDrop = (event: DragEvent, target: DropTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const item = draggedItem(event);
    clearHoverExpand();
    setDragging(null);
    setDropTarget(null);
    if (!item) return;
    onMoveTreeItem(item, target);
    if (target.placement === "inside") {
      setExpandedFolderIds((prev) => {
        if (prev.has(target.folderId)) return prev;
        const next = new Set(prev);
        next.add(target.folderId);
        return next;
      });
    }
  };

  const createFolder = () => {
    const folderId = onCreateFolder();
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
    setEditingFolderId(folderId);
  };

  const empty = runTree.root.length === 0 && runs.length === 0;

  return (
    <>
      <div className="conversation-inspector__nav-header">
        <h2>Conversation Inspector</h2>
        <button
          type="button"
          className="conv-tree__new-folder"
          onClick={createFolder}
        >
          New folder
        </button>
      </div>
      <p className="muted">
        Click a title to rename. Drag runs or folders to reorganize. Delete with ×.
      </p>

      {empty ? (
        <p className="muted empty-state">Run an evaluation to populate.</p>
      ) : (
        <TreeList
          nodes={runTree.root}
          parentFolderId={null}
          runsById={runsById}
          selectedRun={selectedRun}
          selectedProblemId={selectedProblemId}
          expandedRunIds={expandedRunIds}
          expandedFolderIds={expandedFolderIds}
          editingFolderId={editingFolderId}
          dragging={dragging}
          dropTarget={dropTarget}
          runTree={runTree}
          evaluationUi={evaluationUi}
          onSelectRun={onSelectRun}
          onSelectProblem={onSelectProblem}
          onDeleteRun={onDeleteRun}
          onRenameRun={onRenameRun}
          onRenameProblem={onRenameProblem}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onToggleRun={toggleRunExpanded}
          onToggleFolder={toggleFolderExpanded}
          onEditingFolderDone={() => setEditingFolderId(undefined)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDrop={handleDrop}
          onHoverTarget={(target, folderIdToExpand) => {
            applyDropTarget(target);
            if (!folderIdToExpand) {
              clearHoverExpand();
              return;
            }
            if (expandedFolderIds.has(folderIdToExpand)) return;
            if (hoverExpandTimer.current !== undefined) return;
            hoverExpandTimer.current = window.setTimeout(() => {
              hoverExpandTimer.current = undefined;
              setExpandedFolderIds((prev) => {
                if (prev.has(folderIdToExpand)) return prev;
                const next = new Set(prev);
                next.add(folderIdToExpand);
                return next;
              });
            }, EXPAND_ON_HOVER_MS);
          }}
          draggedItem={draggedItem}
        />
      )}
    </>
  );
}

type TreeListProps = {
  nodes: RunTreeNode[];
  parentFolderId: string | null;
  runsById: Map<string, ExperimentRun>;
  selectedRun?: ExperimentRun;
  selectedProblemId?: string;
  expandedRunIds: ReadonlySet<string>;
  expandedFolderIds: ReadonlySet<string>;
  editingFolderId?: string;
  dragging: DraggedTreeItem | null;
  dropTarget: DropTarget | null;
  runTree: RunTree;
  evaluationUi?: EvaluationUiState;
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string, runId?: string) => void;
  onDeleteRun: (runId: string) => void;
  onRenameRun: (runId: string, title: string) => void;
  onRenameProblem: (runId: string, problemId: string, title: string) => void;
  onRenameFolder: (folderId: string, title: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onToggleRun: (runId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onEditingFolderDone: () => void;
  onDragStart: (event: DragEvent, item: DraggedTreeItem) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent, target: DropTarget) => void;
  onHoverTarget: (target: DropTarget | null, expandFolderId?: string) => void;
  draggedItem: (event: DragEvent) => DraggedTreeItem | null;
};

function TreeList({
  nodes,
  parentFolderId,
  runTree,
  dragging,
  ...rest
}: TreeListProps) {
  const endTarget: DropTarget = { placement: "end", parentFolderId };
  const isRoot = parentFolderId == null;
  const hover = (target: DropTarget, expandFolderId?: string) => {
    if (dragging && !isValidMove(runTree, dragging, target)) {
      rest.onHoverTarget(null);
      return;
    }
    rest.onHoverTarget(target, expandFolderId);
  };
  return (
    <ul
      className={
        (isRoot ? "conv-tree" : "conv-tree__children") +
        (sameDrop(rest.dropTarget, endTarget) ? " conv-tree--drop-end" : "")
      }
      onDragOver={(event) => {
        if (!rest.draggedItem(event)) return;
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        hover(endTarget);
      }}
      onDrop={(event) => {
        if (event.target !== event.currentTarget) return;
        rest.onDrop(event, endTarget);
      }}
      onDragLeave={(event) => {
        if (event.target === event.currentTarget) rest.onHoverTarget(null);
      }}
    >
      {nodes.map((node) =>
        node.type === "folder" ? (
          <FolderItem
            key={node.id}
            folder={node}
            runTree={runTree}
            dragging={dragging}
            {...rest}
          />
        ) : (
          <RunItem
            key={node.runId}
            runId={node.runId}
            runTree={runTree}
            dragging={dragging}
            {...rest}
          />
        ),
      )}
    </ul>
  );
}

function FolderItem({
  folder,
  expandedFolderIds,
  editingFolderId,
  dragging,
  dropTarget,
  runTree,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onEditingFolderDone,
  onDragStart,
  onDragEnd,
  onDrop,
  onHoverTarget,
  draggedItem,
  ...rest
}: { folder: RunTreeFolder } & Omit<
  TreeListProps,
  "nodes" | "parentFolderId"
>) {
  const expanded = expandedFolderIds.has(folder.id);
  const item: DraggedTreeItem = { kind: "folder", folderId: folder.id };
  const isDragging =
    dragging?.kind === "folder" && dragging.folderId === folder.id;
  const runCount = countDescendantRuns(folder);
  const before: DropTarget = { placement: "before", item };
  const after: DropTarget = { placement: "after", item };
  const inside: DropTarget = { placement: "inside", folderId: folder.id };

  return (
    <li
      className={
        "conv-tree__item conv-tree__item--folder" +
        (isDragging ? " conv-tree__item--dragging" : "") +
        dropClass(dropTarget, before) +
        dropClass(dropTarget, after) +
        dropClass(dropTarget, inside)
      }
      data-folder-id={folder.id}
    >
      <div
        className="conv-tree__folder-row"
        draggable
        onDragStart={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.closest(
              "input, button, .conv-tree__editable-title, .conv-tree__delete",
            )
          ) {
            event.preventDefault();
            return;
          }
          onDragStart(event, item);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          const dragged = draggedItem(event);
          if (!dragged) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          if (dragged.kind === "folder" && dragged.folderId === folder.id) {
            onHoverTarget(null);
            return;
          }
          const placement = placementFromRow(event, "folder");
          const target =
            placement === "inside" ? inside : placement === "before" ? before : after;
          if (dragged && !isValidMove(runTree, dragged, target)) {
            onHoverTarget(null);
            return;
          }
          onHoverTarget(
            target,
            placement === "inside" ? folder.id : undefined,
          );
        }}
        onDrop={(event) => {
          const placement = placementFromRow(event, "folder");
          const target =
            placement === "inside" ? inside : placement === "before" ? before : after;
          onDrop(event, target);
        }}
      >
        <div
          className="conv-tree__folder"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          onClick={() => onToggleFolder(folder.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleFolder(folder.id);
            }
          }}
        >
          <span className="conv-tree__run-title">
            <span className="conv-tree__run-title-text">
              <button
                type="button"
                className={
                  expanded
                    ? "conv-tree__chevron conv-tree__chevron--open"
                    : "conv-tree__chevron"
                }
                aria-label={
                  expanded
                    ? `Collapse folder ${folder.title}`
                    : `Expand folder ${folder.title}`
                }
                aria-expanded={expanded}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFolder(folder.id);
                }}
              >
                ▸
              </button>
              <FolderGlyph />
              <InlineEditableText
                value={folder.title}
                className="conv-tree__editable-title"
                inputClassName="conv-tree__editable-input"
                ariaLabel={`Rename folder ${folder.title}`}
                autoEdit={editingFolderId === folder.id}
                onEditStart={() => {
                  /* keep folder selected for rename; do not toggle */
                }}
                onCommit={(next) => onRenameFolder(folder.id, next)}
                onEditEnd={onEditingFolderDone}
              />
            </span>
            <span className="conv-tree__folder-count">
              {runCount} {runCount === 1 ? "run" : "runs"}
            </span>
          </span>
        </div>
        <button
          type="button"
          className="conv-tree__delete"
          aria-label={`Remove folder ${folder.title}`}
          title="Remove folder (runs stay in the list)"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteFolder(folder.id);
          }}
        >
          ×
        </button>
      </div>
      {expanded ? (
        <TreeList
          nodes={folder.children}
          parentFolderId={folder.id}
          expandedFolderIds={expandedFolderIds}
          editingFolderId={editingFolderId}
          dragging={dragging}
          dropTarget={dropTarget}
          runTree={runTree}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onToggleFolder={onToggleFolder}
          onEditingFolderDone={onEditingFolderDone}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
          onHoverTarget={onHoverTarget}
          draggedItem={draggedItem}
          {...rest}
        />
      ) : null}
    </li>
  );
}

function RunItem({
  runId,
  runsById,
  selectedRun,
  selectedProblemId,
  expandedRunIds,
  dragging,
  dropTarget,
  runTree,
  evaluationUi,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
  onRenameRun,
  onRenameProblem,
  onToggleRun,
  onDragStart,
  onDragEnd,
  onDrop,
  onHoverTarget,
  draggedItem,
}: { runId: string } & Omit<TreeListProps, "nodes" | "parentFolderId">) {
  const run = runsById.get(runId);
  if (!run) return null;
  const title = displayRunTitle(run);
  const active = selectedRun?.id === run.id;
  const multiProblem = run.conversations.length > 1;
  const expanded = multiProblem && expandedRunIds.has(run.id);
  const item: DraggedTreeItem = { kind: "run", runId: run.id };
  const isDragging = dragging?.kind === "run" && dragging.runId === run.id;
  const before: DropTarget = { placement: "before", item };
  const after: DropTarget = { placement: "after", item };
  const selectedConversation =
    selectedRun?.conversations.find((c) => c.problemId === selectedProblemId) ??
    (selectedProblemId ? undefined : selectedRun?.conversations[0]);
  const activeProblemIdForRun =
    selectedRun?.id === run.id
      ? (selectedConversation?.problemId ??
        (selectedProblemId ? undefined : run.conversations[0]?.problemId))
      : undefined;

  return (
    <li
      className={
        "conv-tree__item" +
        (isDragging ? " conv-tree__item--dragging" : "") +
        dropClass(dropTarget, before) +
        dropClass(dropTarget, after)
      }
      data-run-id={run.id}
    >
      <div
        className={
          active
            ? "conv-tree__run-row conv-tree__run-row--active"
            : "conv-tree__run-row"
        }
        draggable
        onDragStart={(event) => {
          const target = event.target as HTMLElement;
          if (
            target.closest(
              "input, button, .conv-tree__editable-title, .conv-tree__delete",
            )
          ) {
            event.preventDefault();
            return;
          }
          onDragStart(event, item);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          const dragged = draggedItem(event);
          if (!dragged) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          if (dragged.kind === "run" && dragged.runId === run.id) {
            onHoverTarget(null);
            return;
          }
          const placement = placementFromRow(event, "run");
          const target = placement === "before" ? before : after;
          if (dragged && !isValidMove(runTree, dragged, target)) {
            onHoverTarget(null);
            return;
          }
          onHoverTarget(target);
        }}
        onDrop={(event) => {
          const placement = placementFromRow(event, "run");
          onDrop(event, placement === "before" ? before : after);
        }}
      >
        <div
          className="conv-tree__run"
          role="button"
          tabIndex={0}
          aria-expanded={multiProblem ? expanded : undefined}
          onClick={() => {
            onSelectRun(run.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectRun(run.id);
            }
          }}
        >
          <span className="conv-tree__run-title">
            <span className="conv-tree__run-title-text">
              {multiProblem ? (
                <button
                  type="button"
                  className={
                    expanded
                      ? "conv-tree__chevron conv-tree__chevron--open"
                      : "conv-tree__chevron"
                  }
                  aria-label={
                    expanded
                      ? `Collapse problems for ${title}`
                      : `Expand problems for ${title}`
                  }
                  aria-expanded={expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleRun(run.id);
                  }}
                >
                  ▸
                </button>
              ) : null}
              <InlineEditableText
                value={title}
                className="conv-tree__editable-title"
                inputClassName="conv-tree__editable-input"
                ariaLabel={`Rename run ${title}`}
                onEditStart={() => onSelectRun(run.id)}
                onCommit={(next) => onRenameRun(run.id, next)}
              />
            </span>
            <span
              className={
                run.status === "failed"
                  ? "conv-tree__run-status conv-tree__run-status--failed"
                  : "conv-tree__run-status"
              }
              title={
                run.status === "failed" && run.error ? run.error : undefined
              }
            >
              {!multiProblem &&
              (run.status === "running" || run.status === "queued") ? (
                <InspectorBusySpinner kind="run" />
              ) : !multiProblem &&
                run.conversations[0] &&
                isProblemAnalysisRunning(
                  run,
                  run.conversations[0].problemId,
                  evaluationUi,
                ) ? (
                <InspectorBusySpinner kind="analysis" />
              ) : null}
              {run.status}
            </span>
          </span>
          <span className="muted conv-tree__run-meta">
            {runMetaLine(run)}
            {multiProblem ? ` · ${run.conversations.length} problems` : ""}
          </span>
        </div>
        <button
          type="button"
          className="conv-tree__delete"
          aria-label={`Delete run ${title}`}
          title="Delete run"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRun(run.id);
          }}
        >
          ×
        </button>
      </div>
      {expanded ? (
        <ul className="conv-tree__problems">
          {run.conversations.map((conversation, index) => {
            const problemActive =
              conversation.problemId === activeProblemIdForRun;
            const problemRunning = conversation.status === "running";
            const problemAnalyzing = isProblemAnalysisRunning(
              run,
              conversation.problemId,
              evaluationUi,
            );
            const selectThisProblem = () =>
              onSelectProblem(conversation.problemId, run.id);
            return (
              <li key={conversation.problemId}>
                <div
                  className={
                    problemActive
                      ? "conv-tree__problem conv-tree__problem--active"
                      : "conv-tree__problem"
                  }
                  data-problem-id={conversation.problemId}
                  role="button"
                  tabIndex={0}
                  aria-busy={problemRunning || problemAnalyzing || undefined}
                  onClick={selectThisProblem}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectThisProblem();
                    }
                  }}
                >
                  <span className="conv-tree__problem-index">{index + 1}.</span>
                  <InlineEditableText
                    value={conversation.problemTitle}
                    className="conv-tree__problem-title conv-tree__editable-title"
                    inputClassName="conv-tree__editable-input conv-tree__editable-input--problem"
                    ariaLabel={`Rename problem ${conversation.problemTitle}`}
                    allowEditOnClick={problemActive}
                    onEditStart={selectThisProblem}
                    onCommit={(next) =>
                      onRenameProblem(run.id, conversation.problemId, next)
                    }
                  />
                  {problemRunning ? (
                    <InspectorBusySpinner kind="run" />
                  ) : problemAnalyzing ? (
                    <InspectorBusySpinner kind="analysis" />
                  ) : conversation.stoppedReason === "error" ? (
                    <span
                      className="conv-tree__problem-warn"
                      aria-label="Failed"
                      title={conversation.error ?? "Problem failed"}
                    >
                      !
                    </span>
                  ) : isIncompleteConversation(conversation) ? (
                    <span
                      className="conv-tree__problem-incomplete"
                      aria-label="Incomplete"
                      title={
                        conversation.stoppedReason ===
                        "reasoning_protocol_stalled"
                          ? "Canonical solver state stalled"
                          : "Reached max turns without finishing"
                      }
                    >
                      ○
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function FolderGlyph() {
  return (
    <svg
      className="conv-tree__folder-icon"
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        d="M2.25 4.25A1.25 1.25 0 0 1 3.5 3h3.1c.3 0 .58.14.76.38L8.1 4.4c.18.24.46.38.76.38H12.5A1.25 1.25 0 0 1 13.75 6v5.75A1.25 1.25 0 0 1 12.5 13H3.5A1.25 1.25 0 0 1 2.25 11.75Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}
