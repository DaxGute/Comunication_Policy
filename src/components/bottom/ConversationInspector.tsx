import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { formatPolicyValue } from "../../communication";
import { evaluateRun } from "../../evaluation/evaluateRun";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import { extractFinalAnswerFromMessages } from "../../evaluation/graders/answerExtraction";
import { gradeCrosswordPuzzle } from "../../evaluation/graders/crosswordGrader";
import type {
  MultiAgentEvaluation,
  ProblemEvaluation,
} from "../../evaluation/types";
import {
  buildAggregatedMaeSections,
  type MaeMetricRow,
  type MaeMetricSection,
} from "../evaluation/aggregateMaeMetrics";
import {
  isSuccessfulMultiAgentEvaluation,
  resolveRunModel,
} from "../../experiment/configAccessors";
import { displayRunTitle } from "../../experiment/runTitle";
import type { EvaluationUiState } from "../../experiment/store";
import {
  serializeConversation,
  serializeRun,
} from "../../experiment/serializeConversation";
import {
  formatActualUsd,
  getRunCostSummary,
} from "../../experiment/runCost";
import type { ExperimentRun, ProblemConversation, ConversationMessage } from "../../experiment/types";
import {
  estimateExperimentCost,
  formatEstimatedUsd,
} from "../../models/cost";
import {
  DEFAULT_EVALUATION_MODEL_ID,
  displayNameForModel,
  formatReasoningEffort,
} from "../../models/modelRegistry";
import type { CrosswordSpec } from "../../problems/crossword/types";
import { getProblemById } from "../../problems/registry";
import { CrosswordPreview } from "../crossword/CrosswordBoard";
import { MultiAgentEvaluationPanel } from "../evaluation/MultiAgentEvaluationPanel";
import { OverrideEvaluationConfirm } from "../evaluation/OverrideEvaluationConfirm";
import { InlineEditableText } from "../ui/InlineEditableText";
import { ModelSelect } from "../ui/ModelSelect";
import { ResizableSplit } from "../ui/ResizableSplit";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { TokenUsagePanel } from "../ui/TokenUsagePanel";
import {
  formatModelRequestForAudit,
  resolveModelRequest,
} from "../../runtime/renderModelRequest";

function gridHasLetters(grid?: string): boolean {
  return Boolean(grid && /[A-Za-z]/.test(grid));
}

/** Prefer stored crossword grade; otherwise grade live from the transcript. */
function resolveCrosswordDetails(
  crossword: CrosswordSpec | undefined,
  conversation: ProblemConversation,
  evaluation?: ProblemEvaluation,
): ProblemEvaluation["details"] | undefined {
  if (!crossword) return undefined;
  if (
    evaluation?.details?.grader === "crossword" &&
    typeof evaluation.details.letterAccuracy === "number"
  ) {
    return evaluation.details;
  }
  const predicted =
    extractFinalAnswerFromMessages(conversation.messages) ??
    conversation.finalAnswer;
  const grade = gradeCrosswordPuzzle({
    predicted,
    spec: crossword,
  });
  return {
    grader: "crossword",
    letterAccuracy: grade.letterAccuracy,
    wordAccuracy: grade.wordAccuracy,
    completion: grade.completion,
    crossingConsistency: grade.crossingConsistency,
    exactSolve: grade.exactSolve,
    fillableCells: grade.fillableCells,
    correctLetters: grade.correctLetters,
    filledCells: grade.filledCells,
    totalClues: grade.totalClues,
    correctWords: grade.correctWords,
    crossingsCompared: grade.crossingsCompared,
    crossingsAgreeing: grade.crossingsAgreeing,
    predictedGrid: grade.predictedGrid.join("\n"),
  };
}

type Props = {
  runs: ExperimentRun[];
  selectedRun?: ExperimentRun;
  selectedProblemId?: string;
  /** Bumped when a run is chosen from the scatter plot so the inspector reveals it. */
  inspectorFocus?: number;
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string, runId?: string) => void;
  onDeleteRun: (runId: string) => void;
  onRenameRun: (runId: string, title: string) => void;
  onRenameProblem: (runId: string, problemId: string, title: string) => void;
  evaluationUi?: EvaluationUiState;
  onRunEvaluation: (options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
    retryFrom?: MultiAgentEvaluation;
    overrideExisting?: boolean;
  }) => Promise<unknown>;
  onRunAllEvaluations: (options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
    overrideExisting?: boolean;
  }) => Promise<unknown>;
};

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

function formatPct(value: unknown): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return `${(value * 100).toFixed(1)}%`;
}

function formatPctSd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function numericValues(values: Array<number | null | undefined>): number[] {
  return values.filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v),
  );
}

/** Sample mean and standard deviation (n−1). SD is null when n < 2. */
function meanSd(values: Array<number | null | undefined>): {
  mean: number | null;
  sd: number | null;
} {
  const nums = numericValues(values);
  if (nums.length === 0) return { mean: null, sd: null };
  const mean = nums.reduce((sum, v) => sum + v, 0) / nums.length;
  if (nums.length < 2) return { mean, sd: null };
  const variance =
    nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nums.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 1000).toFixed(0)}s`;
}

function formatTokenCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function RunWarningBanner({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="run-warning-banner" role="status">
      <strong className="run-warning-banner__title">{title}</strong>
      <p className="run-warning-banner__message">{message}</p>
    </div>
  );
}

function messageStatsLabel(message: {
  durationMs?: number;
  usage?: { totalTokens: number };
}): string | undefined {
  const parts: string[] = [];
  if (typeof message.usage?.totalTokens === "number") {
    parts.push(`${formatTokenCount(message.usage.totalTokens)} tok`);
  }
  if (typeof message.durationMs === "number") {
    parts.push(formatDuration(message.durationMs));
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** Aggregate wall time and tokens across all turns in a conversation. */
function conversationTotals(messages: ConversationMessage[]): {
  totalDurationMs: number;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
} {
  let totalDurationMs = 0;
  let totalTokens = 0;
  let hasDuration = false;
  let hasTokens = false;
  for (const message of messages) {
    if (typeof message.durationMs === "number") {
      totalDurationMs += message.durationMs;
      hasDuration = true;
    }
    if (typeof message.usage?.totalTokens === "number") {
      totalTokens += message.usage.totalTokens;
      hasTokens = true;
    }
  }
  return { totalDurationMs, totalTokens, hasDuration, hasTokens };
}

export function ConversationInspector({
  runs,
  selectedRun,
  selectedProblemId,
  inspectorFocus = 0,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
  onRenameRun,
  onRenameProblem,
  evaluationUi,
  onRunEvaluation,
  onRunAllEvaluations,
}: Props) {
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
      <aside className="conversation-inspector__nav" ref={navRef}>
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
                                  title="Reached max turns without finishing"
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

      <div className="conversation-inspector__transcript">
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
                key={`${selectedRun.id}:${selectedConversation.problemId}`}
                conversation={selectedConversation}
                run={selectedRun}
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

      <aside className="conversation-inspector__results" ref={resultsRef}>
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

function CopyJsonButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="transcript__copy-json"
      onClick={onClick}
      aria-label={label}
    >
      <svg
        className="transcript__copy-json-icon"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <rect
          x="5.5"
          y="5.5"
          width="8"
          height="8"
          rx="1.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path
          d="M10.5 5.5V4.25A1.25 1.25 0 0 0 9.25 3H4.25A1.25 1.25 0 0 0 3 4.25v5A1.25 1.25 0 0 0 4.25 10.5H5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      {label}
    </button>
  );
}

function TranscriptView({
  conversation,
  run,
  evaluation,
  evaluationUi,
  onRunEvaluation,
  onRenameProblem,
  crossword,
}: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  evaluation?: ProblemEvaluation;
  evaluationUi?: Props["evaluationUi"];
  onRunEvaluation: Props["onRunEvaluation"];
  onRenameProblem: Props["onRenameProblem"];
  crossword?: CrosswordSpec;
}) {
  const [convoJsonOpen, setConvoJsonOpen] = useState(false);
  const [auditTurn, setAuditTurn] = useState<number | null>(null);
  const crosswordDetails = useMemo(
    () => resolveCrosswordDetails(crossword, conversation, evaluation),
    [conversation, crossword, evaluation],
  );
  const isCrossword = Boolean(crossword) || evaluation?.details?.grader === "crossword";
  const isMoral = evaluation?.details?.grader === "moral_open_ended";
  const isProof = evaluation?.details?.grader === "proof_collaborative";
  const predictedGrid = useMemo(() => {
    const fromDetails =
      typeof crosswordDetails?.predictedGrid === "string"
        ? crosswordDetails.predictedGrid
        : undefined;
    if (gridHasLetters(fromDetails)) return fromDetails;
    const fromEval =
      typeof evaluation?.details?.predictedGrid === "string"
        ? evaluation.details.predictedGrid
        : undefined;
    return gridHasLetters(fromEval) ? fromEval : fromDetails ?? fromEval;
  }, [crosswordDetails?.predictedGrid, evaluation?.details?.predictedGrid]);

  const convoJsonText = useMemo(
    () => JSON.stringify(serializeConversation(conversation, run), null, 2),
    [conversation, run],
  );

  const problemEvals = (run.multiAgentEvaluations ?? []).filter(
    (e) => e.problemId === conversation.problemId,
  );
  const latestProblemEval = [...problemEvals].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const hasProblemTokenUsage =
    !!conversation.conversationUsage ||
    !!latestProblemEval?.usage ||
    typeof conversation.conversationCostUsd === "number" ||
    typeof latestProblemEval?.costUsd === "number";
  const problemTokenUsage = (
    <TokenUsagePanel
      conversationUsage={conversation.conversationUsage}
      conversationCostUsd={conversation.conversationCostUsd}
      evaluationUsage={latestProblemEval?.usage}
      evaluationCostUsd={latestProblemEval?.costUsd}
      totalCostUsd={
        typeof conversation.conversationCostUsd === "number" ||
        typeof latestProblemEval?.costUsd === "number"
          ? (conversation.conversationCostUsd ?? 0) +
            (latestProblemEval?.costUsd ?? 0)
          : null
      }
    />
  );

  return (
    <div className="transcript">
      <header className="transcript__header">
        <div className="transcript__title-row">
          <InlineEditableText
            as="h3"
            value={conversation.problemTitle}
            className="transcript__editable-title"
            inputClassName="transcript__editable-input"
            ariaLabel={`Rename problem ${conversation.problemTitle}`}
            onCommit={(next) =>
              onRenameProblem(run.id, conversation.problemId, next)
            }
          />
          <CopyJsonButton
            label="Copy Convo JSON"
            onClick={() => setConvoJsonOpen(true)}
          />
        </div>
        {crossword ? (
          <>
            <CrosswordPreview
              crossword={crossword}
              predictedGrid={predictedGrid}
              aside={
                crosswordDetails || hasProblemTokenUsage ? (
                  <div className="results-stats-row">
                    {crosswordDetails ? (
                      <CrosswordMetrics
                        evaluation={{ details: crosswordDetails }}
                        messages={conversation.messages}
                      />
                    ) : null}
                    {problemTokenUsage}
                  </div>
                ) : undefined
              }
            />
            <details className="transcript__agent-text">
              <summary>Agent-facing puzzle text</summary>
              <pre className="transcript__problem mono">
                {conversation.problemText}
              </pre>
            </details>
          </>
        ) : (
          <pre className="transcript__problem mono">
            {conversation.problemText}
          </pre>
        )}
        <div className="transcript__meta muted">
          stopped: {conversation.stoppedReason}
          {conversation.stoppedReason === "error" && conversation.error
            ? ` · ${conversation.error}`
            : ""}
          {conversation.finalAnswer && !crossword
            ? ` · FINAL_ANSWER: ${
                conversation.finalAnswer.length > 160
                  ? `${conversation.finalAnswer.slice(0, 157).trimEnd()}…`
                  : conversation.finalAnswer
              }`
            : ""}
          {evaluation?.label ? ` · ${evaluation.label}` : ""}
          {typeof evaluation?.score === "number" &&
          !isCrossword &&
          !isMoral &&
          !isProof
            ? ` · score=${evaluation.score}`
            : ""}
          {isMoral || isProof ? " · not objectively scored" : ""}
        </div>
        {!crossword &&
        (hasProblemTokenUsage ||
          (evaluation && (isMoral || isProof))) ? (
          <div className="results-stats-row">
            {evaluation && isMoral ? (
              <MoralOpenMetrics
                evaluation={evaluation}
                messages={conversation.messages}
              />
            ) : null}
            {evaluation && isProof ? (
              <ProofOpenMetrics
                evaluation={evaluation}
                messages={conversation.messages}
              />
            ) : null}
            {problemTokenUsage}
          </div>
        ) : null}
        {evaluation && isMoral ? (
          <MoralResultDetails evaluation={evaluation} />
        ) : null}
        {evaluation && isProof ? (
          <ProofResultDetails evaluation={evaluation} />
        ) : null}
        {evaluation && !isCrossword && !isMoral && !isProof ? (
          <ProblemResultDetails evaluation={evaluation} />
        ) : null}
      </header>

      <MultiAgentEvaluationPanel
        run={run}
        conversation={conversation}
        evaluationUi={evaluationUi}
        onRunEvaluation={onRunEvaluation}
      />

      <ol className="transcript__messages">
        {conversation.messages.map((message) => {
          const agentLabel =
            message.agentId === "agent_a" ? "Agent A" : "Agent B";
          const stats = messageStatsLabel(message);
          return (
            <li
              key={message.id}
              className={
                message.agentId === "agent_a"
                  ? "transcript__msg transcript__msg--a"
                  : "transcript__msg transcript__msg--b"
              }
            >
              <details className="transcript__msg-fold" open>
                <summary className="transcript__msg-head">
                  <span className="transcript__msg-head-main">
                    <svg
                      className="transcript__msg-chevron"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 4.5 6 7.5 9 4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <strong>
                      Turn {message.turnIndex} · {agentLabel}
                    </strong>
                  </span>
                  <span className="transcript__msg-head-meta muted mono">
                    {stats ? <span>{stats}</span> : null}
                    {message.timestamp ? (
                      <span>
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="transcript__msg-audit"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setAuditTurn(message.turnIndex);
                      }}
                    >
                      Model request
                    </button>
                  </span>
                </summary>
                <pre className="transcript__msg-body">{message.content}</pre>
              </details>
            </li>
          );
        })}
      </ol>

      {convoJsonOpen ? (
        <TextPreviewModal
          title="Conversation JSON"
          text={convoJsonText}
          onClose={() => setConvoJsonOpen(false)}
        />
      ) : null}
      {auditTurn !== null ? (
        <ModelRequestAuditModal
          conversation={conversation}
          run={run}
          turnIndex={auditTurn}
          onClose={() => setAuditTurn(null)}
        />
      ) : null}
    </div>
  );
}

function ModelRequestAuditModal({
  conversation,
  run,
  turnIndex,
  onClose,
}: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  turnIndex: number;
  onClose: () => void;
}) {
  const message = conversation.messages.find((m) => m.turnIndex === turnIndex);
  const speaker =
    message?.agentId === "agent_a"
      ? "Agent A"
      : message?.agentId === "agent_b"
        ? "Agent B"
        : "unknown";
  const text = message
    ? formatModelRequestForAudit(
        resolveModelRequest({ message, conversation, run }),
      )
    : "No message for this turn.";
  const stored = Boolean(message?.modelRequest && message.modelRequest.length > 0);

  return (
    <TextPreviewModal
      title={`Model request · turn ${turnIndex} · ${speaker}${stored ? "" : " · reconstructed"}`}
      text={text}
      onClose={onClose}
    />
  );
}

function CrosswordMetrics({
  evaluation,
  messages,
}: {
  evaluation: Pick<ProblemEvaluation, "details">;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);

  return (
    <div className="results-crossword-metrics mono">
      <div>
        Letter accuracy:{" "}
        {formatPct(evaluation.details?.letterAccuracy) ?? "—"}
      </div>
      <div>
        Word accuracy: {formatPct(evaluation.details?.wordAccuracy) ?? "—"}
      </div>
      <div>
        Completion: {formatPct(evaluation.details?.completion) ?? "—"}
      </div>
      <div>
        Crossing consistency:{" "}
        {formatPct(evaluation.details?.crossingConsistency) ?? "n/a"}
      </div>
      <div>
        Exact solve: {evaluation.details?.exactSolve === true ? "Yes" : "No"}
      </div>
      <div className="results-crossword-metrics__summary">
        <div>
          Time:{" "}
          {hasDuration ? formatDuration(totalDurationMs) : "—"}
        </div>
        <div>
          Tokens:{" "}
          {hasTokens ? formatTokenCount(totalTokens) : "—"}
        </div>
      </div>
    </div>
  );
}

function MoralOpenMetrics({
  evaluation,
  messages,
}: {
  evaluation: ProblemEvaluation;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);
  const tension =
    typeof evaluation.details?.exploredTensionSignals === "number"
      ? evaluation.details.exploredTensionSignals
      : undefined;

  return (
    <div className="results-open-metrics mono">
      <div>
        Stance reached:{" "}
        {evaluation.details?.stanceReached === true ? "Yes" : "No"}
      </div>
      <div>Tension signals: {tension !== undefined ? tension : "—"}</div>
      <div>Gold answer: none (open-ended)</div>
      <div className="results-open-metrics__summary">
        <div>Time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>Tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}</div>
      </div>
    </div>
  );
}

function MoralResultDetails({ evaluation }: { evaluation: ProblemEvaluation }) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          stance: {evaluation.finalAnswer}
        </div>
      ) : (
        <div className="muted">No joint stance recorded.</div>
      )}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

function ProofOpenMetrics({
  evaluation,
  messages,
}: {
  evaluation: ProblemEvaluation;
  messages: ConversationMessage[];
}) {
  const { totalDurationMs, totalTokens, hasDuration, hasTokens } =
    conversationTotals(messages);
  const markers =
    typeof evaluation.details?.proofMarkerCount === "number"
      ? evaluation.details.proofMarkerCount
      : undefined;
  const reference =
    typeof evaluation.details?.referenceProofPreview === "string"
      ? evaluation.details.referenceProofPreview
      : undefined;

  return (
    <div className="results-open-metrics mono">
      <div>
        Proof submitted:{" "}
        {evaluation.details?.proofSubmitted === true ? "Yes" : "No"}
      </div>
      <div>
        Proof-structure signals: {markers !== undefined ? markers : "—"}
      </div>
      <div>Objective score: none (collaborative proof)</div>
      {reference ? (
        <div className="results-open-metrics__reference">
          Reference (inspect only): {reference}
        </div>
      ) : null}
      <div className="results-open-metrics__summary">
        <div>Time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>Tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}</div>
      </div>
    </div>
  );
}

function ProofResultDetails({ evaluation }: { evaluation: ProblemEvaluation }) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          joint proof: {evaluation.finalAnswer}
        </div>
      ) : (
        <div className="muted">No joint proof recorded.</div>
      )}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

function ProblemResultDetails({
  evaluation,
}: {
  evaluation: ProblemEvaluation;
}) {
  return (
    <div className="transcript__result-details">
      {evaluation.finalAnswer ? (
        <div className="mono results-answer">
          predicted: {evaluation.finalAnswer}
          {typeof evaluation.details?.goldNormalized === "string"
            ? ` · gold: ${evaluation.details.goldNormalized}`
            : ""}
        </div>
      ) : null}
      {evaluation.notes ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

function RunSpecView({ run }: { run: ExperimentRun }) {
  const { config, policy } = run;
  const costSummary = useMemo(() => getRunCostSummary(run), [run]);

  return (
    <details className="results-spec">
      <summary>Run settings</summary>
      <div className="results-models">
        <h4 className="token-usage__title">Models</h4>
        <div className="results-models__grid">
          <div className="results-models__card">
            <h4>Conversation</h4>
            <p>{displayNameForModel(resolveRunModel(config))}</p>
            <p className="muted">
              Reasoning: {formatReasoningEffort(config.runReasoningEffort)}
            </p>
          </div>
          <div className="results-models__card">
            <h4>Evaluation</h4>
            <p>{displayNameForModel(config.evaluationModel)}</p>
            <p className="muted">
              Reasoning:{" "}
              {formatReasoningEffort(config.evaluationReasoningEffort)}
            </p>
          </div>
        </div>
      </div>
      <dl className="results-summary">
        <div>
          <dt>Problem</dt>
          <dd className="mono">{config.problemCategory}</dd>
        </div>
        <div>
          <dt>Problems</dt>
          <dd className="mono">{config.problemCount}</dd>
        </div>
        <div>
          <dt>Conversation model</dt>
          <dd className="mono">{resolveRunModel(config)}</dd>
        </div>
        <div>
          <dt>Evaluation model</dt>
          <dd className="mono">{config.evaluationModel}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd className="mono">{config.provider}</dd>
        </div>
        <div>
          <dt>Max turns</dt>
          <dd className="mono">{config.maxTurns}</dd>
        </div>
        <div>
          <dt>Trust A→B</dt>
          <dd className="mono">{formatPolicyValue(policy.trustA)}</dd>
        </div>
        <div>
          <dt>Trust B→A</dt>
          <dd className="mono">{formatPolicyValue(policy.trustB)}</dd>
        </div>
        <div>
          <dt>Authority</dt>
          <dd className="mono">{formatPolicyValue(policy.authority)}</dd>
        </div>
        <div>
          <dt>Familiarity</dt>
          <dd className="mono">{formatPolicyValue(policy.familiarity)}</dd>
        </div>
        {costSummary.hasConversationUsage || costSummary.evaluationsRan ? (
          <div>
            <dt>
              {costSummary.usageIncomplete
                ? "Total recorded cost"
                : "Total actual cost"}
            </dt>
            <dd className="mono">
              {formatActualUsd(costSummary.actualTotalCost)}
            </dd>
          </div>
        ) : null}
      </dl>
    </details>
  );
}

function MetricTableRowView({
  row,
}: {
  row: MaeMetricRow | { label: string; sub?: string; mean: string; sd: string };
}) {
  return (
    <div className="results-metric-table__row">
      <span className="results-metric-table__label">
        <span className="results-metric-table__label-text">{row.label}</span>
        {row.sub ? (
          <span className="results-metric-table__sub muted" title={row.sub}>
            {row.sub}
          </span>
        ) : null}
      </span>
      <span>{row.mean}</span>
      <span>{row.sd}</span>
    </div>
  );
}

function MetricTable({
  rows,
  sections,
  footer,
}: {
  rows?: Array<{ label: string; sub?: string; mean: string; sd: string }>;
  sections?: MaeMetricSection[];
  footer?: Array<{ label: string; mean: string; sd?: string }>;
}) {
  const resolved: MaeMetricSection[] =
    sections ?? (rows && rows.length > 0 ? [{ title: "", rows }] : []);
  return (
    <div className="results-metric-table mono">
      <div className="results-metric-table__head muted">
        <span />
        <span>mean</span>
        <span>sd</span>
      </div>
      {resolved.map((section, sectionIdx) => (
        <Fragment key={section.title || `section-${sectionIdx}`}>
          {section.title ? (
            <div className="results-metric-table__group muted">
              {section.title}
            </div>
          ) : null}
          {section.rows.map((row) => (
            <MetricTableRowView key={row.label} row={row} />
          ))}
        </Fragment>
      ))}
      {footer && footer.length > 0 ? (
        <div className="results-metric-table__footer">
          {footer.map((row) => (
            <MetricTableRowView
              key={row.label}
              row={{ label: row.label, mean: row.mean, sd: row.sd ?? "—" }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function latestEvalsByProblem(run: ExperimentRun): MultiAgentEvaluation[] {
  const byProblem = new Map<string, MultiAgentEvaluation>();
  for (const evaluation of run.multiAgentEvaluations ?? []) {
    if (!run.conversations.some((c) => c.problemId === evaluation.problemId)) {
      continue;
    }
    const prev = byProblem.get(evaluation.problemId);
    if (!prev || evaluation.createdAt > prev.createdAt) {
      byProblem.set(evaluation.problemId, evaluation);
    }
  }
  return [...byProblem.values()];
}

function RunResultsMultiAgentEval({
  run,
  evaluationUi,
  onRunAllEvaluations,
}: {
  run: ExperimentRun;
  evaluationUi?: EvaluationUiState;
  onRunAllEvaluations: Props["onRunAllEvaluations"];
}) {
  const [evaluatorModel, setEvaluatorModel] = useState(
    run.config.evaluationModel || DEFAULT_EVALUATION_MODEL_ID,
  );
  const [evaluationReasoningEffort, setEvaluationReasoningEffort] = useState(
    run.config.evaluationReasoningEffort,
  );
  const [confirmingOverride, setConfirmingOverride] = useState(false);

  useEffect(() => {
    setConfirmingOverride(false);
  }, [run.id]);

  const isBatchRunning =
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    Boolean(evaluationUi.batch);
  const isAnyEvalRunning =
    evaluationUi?.status === "running" && evaluationUi.runId === run.id;
  const canEvaluate =
    (run.status === "completed" ||
      run.status === "cancelled" ||
      run.status === "failed") &&
    !isAnyEvalRunning;
  const total = run.conversations.length;
  const evals = latestEvalsByProblem(run);
  const evaluatedCount = evals.length;
  const successfulCount = evals.filter(isSuccessfulMultiAgentEvaluation).length;
  const remainingCount = Math.max(0, total - successfulCount);
  const allSucceeded = total > 0 && successfulCount === total;
  const evalCostEstimate = useMemo(() => {
    const problemCount = confirmingOverride || allSucceeded
      ? Math.max(1, total)
      : Math.max(1, remainingCount);
    const estimate = estimateExperimentCost({
      runModel: resolveRunModel(run.config),
      evaluationModel: evaluatorModel,
      problemCount,
      maxTurns: run.config.maxTurns,
      evaluationEnabled: true,
    });
    return formatEstimatedUsd(estimate.evaluationUsd);
  }, [
    run,
    evaluatorModel,
    confirmingOverride,
    allSucceeded,
    total,
    remainingCount,
  ]);
  const currentProblem =
    isBatchRunning && evaluationUi?.problemId
      ? run.conversations.find((c) => c.problemId === evaluationUi.problemId)
      : undefined;

  const marbleEvals = evals
    .map((e) => e.marble?.normalized)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const beliefEvals = evals
    .map((e) => e.beliefDynamics?.normalized.metrics)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const sections = buildAggregatedMaeSections({ marbleEvals, beliefEvals });

  function startBatch(overrideExisting?: boolean) {
    void onRunAllEvaluations({
      runId: run.id,
      evaluatorModel,
      evaluationReasoningEffort,
      overrideExisting,
    });
  }

  return (
    <div className="results-mae">
      <div className="results-mae__bar">
        <span className="results-mae__title">Multi-agent eval</span>
        <div className="results-mae__controls">
          <span className="results-mae__estimate muted">
            Estimated evaluation cost{" "}
            <span className="mono">{evalCostEstimate}</span>
          </span>
          {!isBatchRunning ? (
            <>
              <div className="results-mae__model-wrap">
                <ModelSelect
                  label="Evaluation model"
                  purpose="evaluation"
                  value={evaluatorModel}
                  onChange={setEvaluatorModel}
                  reasoningEffort={evaluationReasoningEffort}
                  onReasoningEffortChange={setEvaluationReasoningEffort}
                  disabled={!canEvaluate}
                  hideLabel
                />
              </div>
              {confirmingOverride ? null : (
                <button
                  type="button"
                  className="results-mae__run"
                  disabled={!canEvaluate}
                  onClick={() => {
                    if (allSucceeded) {
                      setConfirmingOverride(true);
                      return;
                    }
                    startBatch();
                  }}
                >
                  {allSucceeded ? "Re-run all" : "Run all"}
                </button>
              )}
            </>
          ) : (
            <span className="muted results-mae__status">
              {(evaluationUi?.batch?.currentIndex ?? 0) + 1}/
              {evaluationUi?.batch?.total ?? total}
              {currentProblem?.problemTitle
                ? ` · ${currentProblem.problemTitle}`
                : ""}
            </span>
          )}
          {!isBatchRunning && evaluatedCount > 0 ? (
            <span className="muted results-mae__status">
              {evaluatedCount}/{total} avg
            </span>
          ) : null}
        </div>
      </div>
      {confirmingOverride ? (
        <OverrideEvaluationConfirm
          message={
            total === 1
              ? "This run already has a completed evaluation. Type yes to override it."
              : `All ${total} problems already have completed evaluations. Type yes to override them.`
          }
          onConfirm={() => {
            setConfirmingOverride(false);
            startBatch(true);
          }}
          onCancel={() => setConfirmingOverride(false)}
        />
      ) : null}
      {!isBatchRunning &&
      !confirmingOverride &&
      successfulCount > 0 &&
      remainingCount > 0 ? (
        <p className="muted results-mae__skip-note">
          {successfulCount} already evaluated
          {successfulCount === 1 ? " problem" : " problems"} will be skipped.
          Re-run a problem individually to override it.
        </p>
      ) : null}

      {sections.length > 0 ? (
        <MetricTable sections={sections} />
      ) : !isBatchRunning ? (
        <p className="muted results-mae__empty">No evaluations yet.</p>
      ) : null}
    </div>
  );
}

function formatMessageCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function runTotals(run: ExperimentRun): {
  meanDurationMs: number | null;
  meanTokens: number | null;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
  durationSdMs: number | null;
  tokensSd: number | null;
  meanMessages: number | null;
  messagesSd: number | null;
} {
  const durations: number[] = [];
  const tokens: number[] = [];
  const messageCounts: number[] = [];
  for (const conversation of run.conversations) {
    if (isIncompleteConversation(conversation)) continue;
    messageCounts.push(conversation.messages.length);
    const part = conversationTotals(conversation.messages);
    if (part.hasDuration) durations.push(part.totalDurationMs);
    if (part.hasTokens) tokens.push(part.totalTokens);
  }
  const durationStats = meanSd(durations);
  const tokenStats = meanSd(tokens);
  const messageStats = meanSd(messageCounts);
  return {
    meanDurationMs: durationStats.mean,
    meanTokens: tokenStats.mean,
    totalTokens: tokens.reduce((sum, v) => sum + v, 0),
    hasDuration: durations.length > 0,
    hasTokens: tokens.length > 0,
    durationSdMs: durationStats.sd,
    tokensSd: tokenStats.sd,
    meanMessages: messageStats.mean,
    messagesSd: messageStats.sd,
  };
}

function MetricsBlock({
  rows,
  meanDurationMs,
  meanTokens,
  totalTokens,
  hasDuration,
  hasTokens,
  durationSdMs,
  tokensSd,
  meanMessages,
  messagesSd,
}: {
  rows: Array<{ label: string; mean: string; sd: string }>;
  meanDurationMs: number | null;
  meanTokens: number | null;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
  durationSdMs: number | null;
  tokensSd: number | null;
  meanMessages: number | null;
  messagesSd: number | null;
}) {
  return (
    <MetricTable
      rows={rows}
      footer={[
        {
          label: "Avg run length (msgs)",
          mean:
            meanMessages !== null ? formatMessageCount(meanMessages) : "—",
          sd: messagesSd !== null ? formatMessageCount(messagesSd) : "—",
        },
        {
          label: "Time",
          mean:
            hasDuration && meanDurationMs !== null
              ? formatDuration(meanDurationMs)
              : "—",
          sd: durationSdMs !== null ? formatDuration(durationSdMs) : "—",
        },
        {
          label: "Tokens",
          mean:
            hasTokens && meanTokens !== null
              ? formatTokenCount(meanTokens)
              : "—",
          sd: tokensSd !== null ? formatTokenCount(tokensSd) : "—",
        },
        {
          label: "Total tokens",
          mean: hasTokens ? formatTokenCount(totalTokens) : "—",
          sd: "—",
        },
      ]}
    />
  );
}

function RunStatisticsRow({ run }: { run: ExperimentRun }) {
  const costSummary = useMemo(() => getRunCostSummary(run), [run]);

  return (
    <div className="results-stats-row">
      <EvaluationSummary run={run} />
      <TokenUsagePanel
        conversationUsage={
          costSummary.hasConversationUsage
            ? costSummary.conversationUsage
            : null
        }
        conversationCostUsd={
          costSummary.hasConversationUsage
            ? costSummary.actualConversationCost
            : null
        }
        evaluationUsage={
          costSummary.evaluationsRan ? costSummary.evaluationUsage : null
        }
        evaluationCostUsd={
          costSummary.evaluationsRan ? costSummary.actualEvaluationCost : null
        }
        totalCostUsd={
          costSummary.hasConversationUsage || costSummary.evaluationsRan
            ? costSummary.actualTotalCost
            : null
        }
        usageIncomplete={costSummary.usageIncomplete}
        evaluationsRan={costSummary.evaluationsRan}
      />
    </div>
  );
}

function EvaluationSummary({ run }: { run: ExperimentRun }) {
  // Re-grade when stored evaluation is missing crossword metrics or does not
  // yet exclude max-turn (incomplete) problems from aggregates.
  const evaluation = useMemo(() => {
    const stored = run.evaluation;
    const hasCrosswordGrades = stored?.problems.some(
      (p) =>
        p.details?.grader === "crossword" &&
        typeof p.details.letterAccuracy === "number",
    );
    const accountsForIncomplete =
      typeof stored?.summary.incompleteProblems === "number";
    if (
      run.conversations.length > 0 &&
      (!accountsForIncomplete ||
        (run.config.problemCategory === "crossword" && !hasCrosswordGrades))
    ) {
      return evaluateRun(run);
    }
    return stored;
  }, [run]);

  if (!evaluation) return null;

  const incompleteIds = new Set(
    run.conversations
      .filter(isIncompleteConversation)
      .map((c) => c.problemId),
  );
  const incompleteCount = incompleteIds.size;
  const graded = evaluation.problems.filter(
    (p) => !incompleteIds.has(p.problemId),
  );
  const incompleteRow = {
    label: "Incomplete",
    mean: String(incompleteCount),
    sd: "—",
  };

  const {
    meanDurationMs,
    meanTokens,
    totalTokens,
    hasDuration,
    hasTokens,
    durationSdMs,
    tokensSd,
    meanMessages,
    messagesSd,
  } = runTotals(run);
  const crosswordProblems = graded.filter(
    (p) => p.details?.grader === "crossword",
  );
  const showCrossword =
    crosswordProblems.length > 0 || run.config.problemCategory === "crossword";

  if (showCrossword) {
    const letter = meanSd(
      crosswordProblems.map((p) =>
        typeof p.details?.letterAccuracy === "number"
          ? p.details.letterAccuracy
          : null,
      ),
    );
    const word = meanSd(
      crosswordProblems.map((p) =>
        typeof p.details?.wordAccuracy === "number"
          ? p.details.wordAccuracy
          : null,
      ),
    );
    const completion = meanSd(
      crosswordProblems.map((p) =>
        typeof p.details?.completion === "number" ? p.details.completion : null,
      ),
    );
    const crossing = meanSd(
      crosswordProblems.map((p) =>
        typeof p.details?.crossingConsistency === "number"
          ? p.details.crossingConsistency
          : null,
      ),
    );
    const summary = evaluation.summary;
    const useStored =
      typeof summary.incompleteProblems === "number";
    const letterMean =
      letter.mean ??
      (useStored && typeof summary.crosswordLetterAccuracy === "number"
        ? summary.crosswordLetterAccuracy
        : null);
    const wordMean =
      word.mean ??
      (useStored && typeof summary.crosswordWordAccuracy === "number"
        ? summary.crosswordWordAccuracy
        : null);
    const completionMean =
      completion.mean ??
      (useStored && typeof summary.crosswordCompletion === "number"
        ? summary.crosswordCompletion
        : null);
    const crossingMean =
      crossing.mean ??
      (useStored && typeof summary.crosswordCrossingConsistency === "number"
        ? summary.crosswordCrossingConsistency
        : null);

    return (
      <MetricsBlock
        rows={[
          {
            label: "Letter accuracy",
            mean: formatPct(letterMean) ?? "—",
            sd: formatPctSd(letter.sd),
          },
          {
            label: "Word accuracy",
            mean: formatPct(wordMean) ?? "—",
            sd: formatPctSd(word.sd),
          },
          {
            label: "Completion",
            mean: formatPct(completionMean) ?? "—",
            sd: formatPctSd(completion.sd),
          },
          {
            label: "Crossing consistency",
            mean: formatPct(crossingMean) ?? "n/a",
            sd: formatPctSd(crossing.sd),
          },
          incompleteRow,
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
        meanMessages={meanMessages}
        messagesSd={messagesSd}
      />
    );
  }

  const moralProblems = graded.filter(
    (p) => p.details?.grader === "moral_open_ended",
  );
  if (moralProblems.length > 0) {
    const stance = meanSd(
      moralProblems.map((p) => (p.details?.stanceReached === true ? 1 : 0)),
    );
    const tension = meanSd(
      moralProblems.map((p) =>
        typeof p.details?.exploredTensionSignals === "number"
          ? p.details.exploredTensionSignals
          : null,
      ),
    );
    return (
      <MetricsBlock
        rows={[
          {
            label: "Stance rate",
            mean: formatPct(stance.mean) ?? "—",
            sd: formatPctSd(stance.sd),
          },
          {
            label: "Stances reached",
            mean: String(
              moralProblems.filter((p) => p.details?.stanceReached === true)
                .length,
            ),
            sd: "—",
          },
          {
            label: "Mean tension signals",
            mean:
              tension.mean !== null
                ? String(Number(tension.mean.toFixed(2)))
                : "—",
            sd:
              tension.sd !== null
                ? String(Number(tension.sd.toFixed(2)))
                : "—",
          },
          incompleteRow,
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
        meanMessages={meanMessages}
        messagesSd={messagesSd}
      />
    );
  }

  const proofProblems = graded.filter(
    (p) =>
      p.details?.grader === "proof_collaborative" ||
      p.details?.grader === "proof",
  );
  if (proofProblems.length > 0) {
    const submit = meanSd(
      proofProblems.map((p) => (p.label === "proof_submitted" ? 1 : 0)),
    );
    return (
      <MetricsBlock
        rows={[
          {
            label: "Proof submit rate",
            mean: formatPct(submit.mean) ?? "—",
            sd: formatPctSd(submit.sd),
          },
          {
            label: "Proofs submitted",
            mean: String(
              proofProblems.filter((p) => p.label === "proof_submitted").length,
            ),
            sd: "—",
          },
          incompleteRow,
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
        meanMessages={meanMessages}
        messagesSd={messagesSd}
      />
    );
  }

  const scores = meanSd(
    graded.map((p) => (typeof p.score === "number" ? p.score : null)),
  );

  return (
    <MetricsBlock
      rows={[
        {
          label: "Score",
          mean:
            scores.mean !== null
              ? (formatPct(scores.mean) ?? String(scores.mean))
              : "—",
          sd:
            scores.sd !== null
              ? (formatPct(scores.sd) ?? String(Number(scores.sd.toFixed(2))))
              : "—",
        },
        {
          label: "Problems completed",
          mean: String(graded.length),
          sd: "—",
        },
        incompleteRow,
      ]}
      meanDurationMs={meanDurationMs}
      meanTokens={meanTokens}
      totalTokens={totalTokens}
      hasDuration={hasDuration}
      hasTokens={hasTokens}
      durationSdMs={durationSdMs}
      tokensSd={tokensSd}
      meanMessages={meanMessages}
      messagesSd={messagesSd}
    />
  );
}
