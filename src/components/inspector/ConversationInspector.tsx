/**
 * Bottom-pane conversation inspector: run tree, selected transcript, run results.
 *
 * Transcript rendering lives in TranscriptView; aggregated results live in
 * runResults. This file owns layout, selection, and the run-tree chrome.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatPolicyValue } from "../../communication";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import { resolveRunModel } from "../../experiment/configAccessors";
import { displayRunTitle } from "../../experiment/runTitle";
import { serializeRun } from "../../experiment/serializeConversation";
import { formatActualUsd, getRunCostSummary } from "../../experiment/runCost";
import type { ExperimentRun } from "../../experiment/types";
import { displayNameForModel } from "../../models/modelRegistry";
import { getProblemById } from "../../problems/registry";
import { InlineEditableText } from "../ui/InlineEditableText";
import { ResizableSplit } from "../ui/ResizableSplit";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { RunResultsMultiAgentEval, RunSpecView, RunStatisticsRow } from "./runResults";
import { CopyJsonButton, RunWarningBanner } from "./shared";
import { TranscriptView } from "./TranscriptView";
import type { InspectorProps, ProblemPaneTab } from "./types";

export type { InspectorProps } from "./types";

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

export function ConversationInspector({
  runs,
  selectedRun,
  selectedProblemId,
  inspectorFocus = 0,
  speakingAgentId,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
  onRenameRun,
  onRenameProblem,
  evaluationUi,
  onRunEvaluation,
  onRunAllEvaluations,
}: InspectorProps) {
  const [runJsonOpen, setRunJsonOpen] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const navRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const selectedConversation =
    selectedRun?.conversations.find((c) => c.problemId === selectedProblemId) ??
    // Only fall back when nothing is selected. Never silently switch to
    // conversations[0] while a different problem id is still selected —
    // that made the transcript chase whichever problem was currently running.
    (selectedProblemId ? undefined : selectedRun?.conversations[0]);

  const [problemTab, setProblemTab] = useState<ProblemPaneTab>("conversation");
  const [linkSelection, setLinkSelection] = useState<{
    nodeId?: string;
    messageId?: string;
  }>({});
  const selectedProblemKey = selectedConversation
    ? `${selectedRun?.id}:${selectedConversation.problemId}`
    : `${selectedRun?.id ?? ""}:${selectedProblemId ?? ""}`;

  useEffect(() => {
    setProblemTab("conversation");
    setLinkSelection({});
  }, [selectedProblemKey]);

  // Selecting a multi-problem run expands its problem list once; the user can
  // still collapse it afterward without losing the selection.
  useEffect(() => {
    const runId = selectedRun?.id;
    if (!runId) return;
    if ((selectedRun?.conversations.length ?? 0) > 1) {
      setExpandedRunIds((prev) => {
        if (prev.has(runId)) return prev;
        const next = new Set(prev);
        next.add(runId);
        return next;
      });
    }
    resultsRef.current?.scrollTo({ top: 0 });
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const root = navRef.current;
        if (!root) return;
        const runEl = root.querySelector(
          `[data-run-id="${CSS.escape(runId)}"]`,
        );
        const problemId =
          selectedConversation?.problemId ??
          selectedProblemId ??
          selectedRun.conversations[0]?.problemId;
        const problemEl = problemId
          ? root.querySelector(
              `[data-run-id="${CSS.escape(runId)}"] [data-problem-id="${CSS.escape(problemId)}"]`,
            )
          : null;
        (problemEl ?? runEl)?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // Graph clicks bump inspectorFocus so a collapsed selected run re-opens
    // and the tree / results scroll into view even when the run id is unchanged.
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

  const runJsonText = useMemo(
    () =>
      selectedRun
        ? JSON.stringify(serializeRun(selectedRun), null, 2)
        : "",
    [selectedRun],
  );

  return (
    <>
      <ResizableSplit
        direction="horizontal"
        className="conversation-inspector"
        initialSizes={[24, 48, 28]}
        minSizesPx={[160, 220, 200]}
        storageKey="workbench:inspector"
      >
      <aside className="conversation-inspector__nav overlay-scroll" ref={navRef}>
        <h2>Conversation Inspector</h2>
        <p className="muted">
          Click a title to rename. Delete with × to remove a run from the saved list.
        </p>

        {runs.length === 0 ? (
          <p className="muted empty-state">Run an evaluation to populate.</p>
        ) : (
          <ul className="conv-tree">
            {runs.map((run) => {
              const title = displayRunTitle(run);
              const active = selectedRun?.id === run.id;
              const multiProblem = run.conversations.length > 1;
              const expanded = multiProblem && expandedRunIds.has(run.id);
              const activeProblemIdForRun =
                selectedRun?.id === run.id
                  ? (selectedConversation?.problemId ??
                    (selectedProblemId
                      ? undefined
                      : run.conversations[0]?.problemId))
                  : undefined;
              return (
                <li
                  key={run.id}
                  className="conv-tree__item"
                  data-run-id={run.id}
                >
                  <div
                    className={
                      active
                        ? "conv-tree__run-row conv-tree__run-row--active"
                        : "conv-tree__run-row"
                    }
                  >
                    <div
                      className="conv-tree__run"
                      role="button"
                      tabIndex={0}
                      aria-expanded={multiProblem ? expanded : undefined}
                      onClick={() => {
                        if (active && multiProblem) {
                          toggleRunExpanded(run.id);
                          return;
                        }
                        onSelectRun(run.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (active && multiProblem) {
                            toggleRunExpanded(run.id);
                            return;
                          }
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
                                toggleRunExpanded(run.id);
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
                            run.status === "failed" && run.error
                              ? run.error
                              : undefined
                          }
                        >
                          {(run.status === "running" ||
                            run.status === "queued") &&
                          !multiProblem ? (
                            <span
                              className="conv-tree__problem-spinner"
                              aria-label="Running"
                              title="Running"
                            />
                          ) : null}
                          {run.status}
                        </span>
                      </span>
                      <span className="muted conv-tree__run-meta">
                        {runMetaLine(run)}
                        {multiProblem
                          ? ` · ${run.conversations.length} problems`
                          : ""}
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
                        const problemRunning =
                          conversation.status === "running";
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
                              aria-busy={problemRunning || undefined}
                              onClick={selectThisProblem}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  selectThisProblem();
                                }
                              }}
                            >
                              <span className="conv-tree__problem-index">
                                {index + 1}.
                              </span>
                              <InlineEditableText
                                value={conversation.problemTitle}
                                className="conv-tree__problem-title conv-tree__editable-title"
                                inputClassName="conv-tree__editable-input conv-tree__editable-input--problem"
                                ariaLabel={`Rename problem ${conversation.problemTitle}`}
                                allowEditOnClick={problemActive}
                                onEditStart={selectThisProblem}
                                onCommit={(next) =>
                                  onRenameProblem(
                                    run.id,
                                    conversation.problemId,
                                    next,
                                  )
                                }
                              />
                              {problemRunning ? (
                                <span
                                  className="conv-tree__problem-spinner"
                                  aria-label="Running"
                                  title="Running"
                                />
                              ) : conversation.stoppedReason === "error" ? (
                                <span
                                  className="conv-tree__problem-warn"
                                  aria-label="Failed"
                                  title={
                                    conversation.error ?? "Problem failed"
                                  }
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
            })}
          </ul>
        )}
      </aside>

      <div className="conversation-inspector__transcript overlay-scroll">
        {!selectedRun ? (
          <p className="muted empty-state">Select a run.</p>
        ) : (
          <>
            {selectedConversation?.stoppedReason === "error" ? (
              <RunWarningBanner
                title="Problem failed"
                message={
                  selectedConversation.error ??
                  selectedRun.error ??
                  "This problem failed. Partial progress is kept."
                }
              />
            ) : null}
            {!selectedConversation ? (
              <p className="muted empty-state">
                No transcripts yet for this run.
              </p>
            ) : (
              <TranscriptView
                key={selectedProblemKey}
                conversation={selectedConversation}
                run={selectedRun}
                tab={problemTab}
                onTabChange={setProblemTab}
                speakingAgentId={speakingAgentId}
                selectedMessageId={linkSelection.messageId}
                selectedNodeId={linkSelection.nodeId}
                onSelectMessage={(messageId) => {
                  setLinkSelection((prev) => ({
                    nodeId: prev.messageId === messageId ? prev.nodeId : undefined,
                    messageId,
                  }));
                }}
                onSelectNode={(nodeId, messageId) => {
                  setLinkSelection({ nodeId, messageId });
                }}
                onOpenConversationTurn={(messageId, nodeId) => {
                  setLinkSelection({ nodeId, messageId });
                  setProblemTab("conversation");
                }}
                onViewReasoning={(messageId) => {
                  setLinkSelection((prev) => ({
                    nodeId: prev.messageId === messageId ? prev.nodeId : undefined,
                    messageId,
                  }));
                  setProblemTab("graph");
                }}
                evaluation={selectedRun.evaluation?.problems.find(
                  (p) => p.problemId === selectedConversation.problemId,
                )}
                evaluationUi={evaluationUi}
                onRunEvaluation={onRunEvaluation}
                onRenameProblem={onRenameProblem}
                crossword={
                  selectedRun.config.problemCategory === "crossword"
                    ? getProblemById(
                        selectedRun.config.problemCategory,
                        selectedConversation.problemId,
                      )?.crossword
                    : undefined
                }
              />
            )}
          </>
        )}
      </div>

      <aside className="conversation-inspector__results overlay-scroll" ref={resultsRef}>
        <div className="results-header">
          <h2>Run Results</h2>
          {selectedRun ? (
            <CopyJsonButton
              label="Copy Run JSON"
              onClick={() => setRunJsonOpen(true)}
            />
          ) : null}
        </div>
        {!selectedRun ? (
          <p className="muted empty-state">Select a run.</p>
        ) : (
          <div className="results">
            <RunSpecView run={selectedRun} />
            {selectedRun.status === "failed" ? (
              <>
                <RunWarningBanner
                  title="Unresolved failure"
                  message={
                    selectedRun.error ??
                    "One or more problems failed during the run."
                  }
                />
                {selectedRun.conversations.length > 0 ? (
                  <RunStatisticsRow run={selectedRun} />
                ) : (
                  <p className="muted">
                    No problem progress was recorded before the failure.
                  </p>
                )}
              </>
            ) : selectedRun.status === "cancelled" ? (
              <>
                <RunWarningBanner
                  title="Run cancelled"
                  message={
                    selectedRun.conversations.length > 0
                      ? `Stopped after ${selectedRun.conversations.length} problem${selectedRun.conversations.length === 1 ? "" : "s"}. Partial progress is kept.`
                      : "Cancelled before any problem finished."
                  }
                />
                {selectedRun.conversations.length > 0 ? (
                  <RunStatisticsRow run={selectedRun} />
                ) : (
                  <p className="muted">No completed problems to evaluate.</p>
                )}
              </>
            ) : selectedRun.evaluation ||
              selectedRun.conversations.length > 0 ? (
              <RunStatisticsRow run={selectedRun} />
            ) : (
              <p className="muted empty-state">
                Select a completed run to inspect results.
              </p>
            )}
            {selectedRun.conversations.length > 0 ? (
              <RunResultsMultiAgentEval
                run={selectedRun}
                evaluationUi={evaluationUi}
                onRunAllEvaluations={onRunAllEvaluations}
              />
            ) : null}
          </div>
        )}
      </aside>
      </ResizableSplit>

      {runJsonOpen && selectedRun ? (
        <TextPreviewModal
          title="Run JSON"
          text={runJsonText}
          onClose={() => setRunJsonOpen(false)}
        />
      ) : null}
    </>
  );
}
