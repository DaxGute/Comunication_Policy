/**
 * Bottom-pane conversation inspector: run tree, selected transcript, run results.
 *
 * Transcript rendering lives in TranscriptView; aggregated results live in
 * runResults. This file owns layout, selection, and the run-tree chrome.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProblemById } from "../../problems/registry";
import { ResizableSplit } from "../ui/ResizableSplit";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { serializeRun } from "../../experiment/serializeConversation";
import { RunResultsMultiAgentEval, RunSpecView, RunStatisticsRow } from "./runResults";
import { CopyJsonButton, RunWarningBanner } from "./shared";
import { RunTreeNav } from "./RunTreeNav";
import { TranscriptView } from "./TranscriptView";
import type { InspectorProps, ProblemPaneTab } from "./types";

export type { InspectorProps } from "./types";

export const ConversationInspector = memo(function ConversationInspector({
  runs,
  runTree,
  selectedRun,
  selectedProblemId,
  inspectorFocus = 0,
  speakingAgentId,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
  onRenameRun,
  onRenameProblem,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveTreeItem,
  evaluationUi,
  onRunEvaluation,
  onRunAllEvaluations,
}: InspectorProps) {
  const [runJsonOpen, setRunJsonOpen] = useState(false);
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

  // Scroll the selected run (and problem, if visible) into view. Expansion is
  // only via the chevron — selecting a run must not open its problem list.
  useEffect(() => {
    const runId = selectedRun?.id;
    if (!runId) return;
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
    // Graph clicks bump inspectorFocus so the tree / results scroll into view
    // even when the run id is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectedRun?.id, inspectorFocus]);

  const runJsonText = useMemo(
    () =>
      runJsonOpen && selectedRun
        ? JSON.stringify(serializeRun(selectedRun), null, 2)
        : "",
    [runJsonOpen, selectedRun],
  );

  const handleSelectMessage = useCallback((messageId: string) => {
    setLinkSelection((prev) => ({
      nodeId: prev.messageId === messageId ? prev.nodeId : undefined,
      messageId,
    }));
  }, []);
  const handleSelectNode = useCallback(
    (nodeId: string | undefined, messageId?: string) => {
      setLinkSelection({ nodeId, messageId });
    },
    [],
  );
  const handleOpenConversationTurn = useCallback(
    (messageId: string, nodeId?: string) => {
      setLinkSelection({ nodeId, messageId });
      setProblemTab("conversation");
    },
    [],
  );
  const handleViewReasoning = useCallback((messageId: string) => {
    setLinkSelection((prev) => ({
      nodeId: prev.messageId === messageId ? prev.nodeId : undefined,
      messageId,
    }));
    setProblemTab("graph");
  }, []);

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
        <RunTreeNav
          runs={runs}
          runTree={runTree}
          selectedRun={selectedRun}
          selectedProblemId={selectedProblemId}
          inspectorFocus={inspectorFocus}
          evaluationUi={evaluationUi}
          onSelectRun={onSelectRun}
          onSelectProblem={onSelectProblem}
          onDeleteRun={onDeleteRun}
          onRenameRun={onRenameRun}
          onRenameProblem={onRenameProblem}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onMoveTreeItem={onMoveTreeItem}
        />
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
                onSelectMessage={handleSelectMessage}
                onSelectNode={handleSelectNode}
                onOpenConversationTurn={handleOpenConversationTurn}
                onViewReasoning={handleViewReasoning}
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
});
