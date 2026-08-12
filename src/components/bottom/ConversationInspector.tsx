import { useEffect, useMemo, useState } from "react";
import { formatPolicyValue } from "../../communication";
import { evaluateRun } from "../../evaluation/evaluateRun";
import { extractFinalAnswerFromMessages } from "../../evaluation/graders/answerExtraction";
import { gradeCrosswordPuzzle } from "../../evaluation/graders/crosswordGrader";
import type {
  MultiAgentEvaluation,
  ProblemEvaluation,
} from "../../evaluation/types";
import { resolveRunModel } from "../../experiment/configAccessors";
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
import { InlineEditableText } from "../ui/InlineEditableText";
import { ModelSelect } from "../ui/ModelSelect";
import { ResizableSplit } from "../ui/ResizableSplit";
import { TextPreviewModal } from "../ui/TextPreviewModal";
import { TokenUsagePanel } from "../ui/TokenUsagePanel";

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
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string) => void;
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
  }) => Promise<unknown>;
  onRunAllEvaluations: (options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
  }) => Promise<unknown>;
};

/** Prefer finishedAt; else last message time; else createdAt. */
function runFinishIso(run: ExperimentRun): string {
  if (run.finishedAt) return run.finishedAt;
  let latest: string | undefined;
  for (const conversation of run.conversations) {
    for (const message of conversation.messages) {
      if (
        message.timestamp &&
        (!latest || message.timestamp > latest)
      ) {
        latest = message.timestamp;
      }
    }
  }
  return latest ?? run.createdAt;
}

function formatRunFinishTitle(run: ExperimentRun): string {
  return new Date(runFinishIso(run)).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function displayRunTitle(run: ExperimentRun): string {
  const custom = run.title?.trim();
  return custom && custom.length > 0 ? custom : formatRunFinishTitle(run);
}

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
    if (!runId || (selectedRun?.conversations.length ?? 0) <= 1) return;
    setExpandedRunIds((prev) => {
      if (prev.has(runId)) return prev;
      const next = new Set(prev);
      next.add(runId);
      return next;
    });
    // Only react to selection changes — not conversation growth mid-run —
    // so collapsing a selected run stays collapsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [selectedRun?.id]);

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
      <aside className="conversation-inspector__nav">
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
              const activeProblemId =
                selectedConversation?.problemId ??
                run.conversations[0]?.problemId;
              return (
                <li key={run.id} className="conv-tree__item">
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
                          conversation.problemId === activeProblemId;
                        const problemRunning =
                          conversation.status === "running";
                        return (
                          <li key={conversation.problemId}>
                            <div
                              className={
                                problemActive
                                  ? "conv-tree__problem conv-tree__problem--active"
                                  : "conv-tree__problem"
                              }
                              role="button"
                              tabIndex={0}
                              aria-busy={problemRunning || undefined}
                              onClick={() =>
                                onSelectProblem(conversation.problemId)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  onSelectProblem(conversation.problemId);
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
                                onEditStart={() =>
                                  onSelectProblem(conversation.problemId)
                                }
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

      <aside className="conversation-inspector__results">
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
    </div>
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

function formatMaePct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

function formatMaeScore5(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}/5`;
}

function formatMaeMean(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatMaeScore5Sd(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function MetricTable({
  rows,
  footer,
}: {
  rows: Array<{ label: string; mean: string; sd: string }>;
  footer?: Array<{ label: string; mean: string; sd?: string }>;
}) {
  return (
    <div className="results-metric-table mono">
      <div className="results-metric-table__head muted">
        <span />
        <span>mean</span>
        <span>sd</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="results-metric-table__row">
          <span className="results-metric-table__label">{row.label}</span>
          <span>{row.mean}</span>
          <span>{row.sd}</span>
        </div>
      ))}
      {footer && footer.length > 0 ? (
        <div className="results-metric-table__footer">
          {footer.map((row) => (
            <div key={row.label} className="results-metric-table__row">
              <span className="results-metric-table__label">{row.label}</span>
              <span>{row.mean}</span>
              <span>{row.sd ?? "—"}</span>
            </div>
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
  const evalCostEstimate = useMemo(() => {
    const estimate = estimateExperimentCost({
      runModel: resolveRunModel(run.config),
      evaluationModel: evaluatorModel,
      problemCount: Math.max(1, run.conversations.length),
      maxTurns: run.config.maxTurns,
      evaluationEnabled: true,
    });
    return formatEstimatedUsd(estimate.evaluationUsd);
  }, [run, evaluatorModel]);
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

  const communication = meanSd(marbleEvals.map((m) => m.communicationScore));
  const planning = meanSd(marbleEvals.map((m) => m.planningScore));
  const coordination = meanSd(marbleEvals.map((m) => m.coordinationScore));
  const correction = meanSd(beliefEvals.map((m) => m.errorCorrectionRate));
  const reinforcement = meanSd(
    beliefEvals.map((m) => m.errorReinforcementRate),
  );
  const challenge = meanSd(beliefEvals.map((m) => m.challengeRate));
  const successfulChallenge = meanSd(
    beliefEvals.map((m) => m.successfulChallengeRate),
  );
  const critique = meanSd(beliefEvals.map((m) => m.independentCritiqueRate));
  const deference = meanSd(beliefEvals.map((m) => m.deferenceRate));
  const claims = meanSd(beliefEvals.map((m) => m.claimsIntroduced));
  const incorrect = meanSd(beliefEvals.map((m) => m.incorrectClaims));

  const rows: Array<{ label: string; mean: string; sd: string }> = [];
  if (marbleEvals.length > 0) {
    rows.push(
      {
        label: "Communication",
        mean: formatMaeScore5(communication.mean),
        sd: formatMaeScore5Sd(communication.sd),
      },
      {
        label: "Planning",
        mean: formatMaeScore5(planning.mean),
        sd: formatMaeScore5Sd(planning.sd),
      },
      {
        label: "Coordination",
        mean: formatMaeScore5(coordination.mean),
        sd: formatMaeScore5Sd(coordination.sd),
      },
    );
  }
  if (beliefEvals.length > 0) {
    rows.push(
      {
        label: "Claims",
        mean: formatMaeMean(claims.mean, 1),
        sd: formatMaeMean(claims.sd, 1),
      },
      {
        label: "Incorrect",
        mean: formatMaeMean(incorrect.mean, 1),
        sd: formatMaeMean(incorrect.sd, 1),
      },
      {
        label: "Correction",
        mean: formatMaePct(correction.mean),
        sd: formatMaePct(correction.sd),
      },
      {
        label: "Reinforcement",
        mean: formatMaePct(reinforcement.mean),
        sd: formatMaePct(reinforcement.sd),
      },
      {
        label: "Challenge",
        mean: formatMaePct(challenge.mean),
        sd: formatMaePct(challenge.sd),
      },
      {
        label: "Successful challenge",
        mean: formatMaePct(successfulChallenge.mean),
        sd: formatMaePct(successfulChallenge.sd),
      },
      {
        label: "Critique",
        mean: formatMaePct(critique.mean),
        sd: formatMaePct(critique.sd),
      },
      {
        label: "Deference",
        mean: formatMaePct(deference.mean),
        sd: formatMaePct(deference.sd),
      },
    );
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
              <button
                type="button"
                className="results-mae__run"
                disabled={!canEvaluate}
                onClick={() => {
                  void onRunAllEvaluations({
                    runId: run.id,
                    evaluatorModel,
                    evaluationReasoningEffort,
                  });
                }}
              >
                Run all
              </button>
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

      {rows.length > 0 ? (
        <MetricTable rows={rows} />
      ) : !isBatchRunning ? (
        <p className="muted results-mae__empty">No evaluations yet.</p>
      ) : null}
    </div>
  );
}

function runTotals(run: ExperimentRun): {
  meanDurationMs: number | null;
  meanTokens: number | null;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
  durationSdMs: number | null;
  tokensSd: number | null;
} {
  const durations: number[] = [];
  const tokens: number[] = [];
  for (const conversation of run.conversations) {
    const part = conversationTotals(conversation.messages);
    if (part.hasDuration) durations.push(part.totalDurationMs);
    if (part.hasTokens) tokens.push(part.totalTokens);
  }
  const durationStats = meanSd(durations);
  const tokenStats = meanSd(tokens);
  return {
    meanDurationMs: durationStats.mean,
    meanTokens: tokenStats.mean,
    totalTokens: tokens.reduce((sum, v) => sum + v, 0),
    hasDuration: durations.length > 0,
    hasTokens: tokens.length > 0,
    durationSdMs: durationStats.sd,
    tokensSd: tokenStats.sd,
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
}: {
  rows: Array<{ label: string; mean: string; sd: string }>;
  meanDurationMs: number | null;
  meanTokens: number | null;
  totalTokens: number;
  hasDuration: boolean;
  hasTokens: boolean;
  durationSdMs: number | null;
  tokensSd: number | null;
}) {
  return (
    <MetricTable
      rows={rows}
      footer={[
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
  // Re-grade when stored evaluation is missing/incomplete so crossword metrics
  // (letter/word/completion/crossing) still appear for finished runs.
  const evaluation = useMemo(() => {
    const stored = run.evaluation;
    const hasCrosswordGrades = stored?.problems.some(
      (p) =>
        p.details?.grader === "crossword" &&
        typeof p.details.letterAccuracy === "number",
    );
    if (
      run.config.problemCategory === "crossword" &&
      run.conversations.length > 0 &&
      !hasCrosswordGrades
    ) {
      return evaluateRun(run);
    }
    return stored;
  }, [run]);

  if (!evaluation) return null;

  const {
    meanDurationMs,
    meanTokens,
    totalTokens,
    hasDuration,
    hasTokens,
    durationSdMs,
    tokensSd,
  } = runTotals(run);
  const crosswordProblems = evaluation.problems.filter(
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
    const letterMean =
      letter.mean ??
      (typeof summary.crosswordLetterAccuracy === "number"
        ? summary.crosswordLetterAccuracy
        : null);
    const wordMean =
      word.mean ??
      (typeof summary.crosswordWordAccuracy === "number"
        ? summary.crosswordWordAccuracy
        : null);
    const completionMean =
      completion.mean ??
      (typeof summary.crosswordCompletion === "number"
        ? summary.crosswordCompletion
        : null);
    const crossingMean =
      crossing.mean ??
      (typeof summary.crosswordCrossingConsistency === "number"
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
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
      />
    );
  }

  const moralProblems = evaluation.problems.filter(
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
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
      />
    );
  }

  const proofProblems = evaluation.problems.filter(
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
        ]}
        meanDurationMs={meanDurationMs}
        meanTokens={meanTokens}
        totalTokens={totalTokens}
        hasDuration={hasDuration}
        hasTokens={hasTokens}
        durationSdMs={durationSdMs}
        tokensSd={tokensSd}
      />
    );
  }

  const scores = meanSd(
    evaluation.problems.map((p) =>
      typeof p.score === "number" ? p.score : null,
    ),
  );
  const turns = meanSd(evaluation.problems.map((p) => p.turns));

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
          mean: String(evaluation.problems.length),
          sd: "—",
        },
        {
          label: "Average turns",
          mean:
            turns.mean !== null ? String(Number(turns.mean.toFixed(2))) : "—",
          sd: turns.sd !== null ? String(Number(turns.sd.toFixed(2))) : "—",
        },
      ]}
      meanDurationMs={meanDurationMs}
      meanTokens={meanTokens}
      totalTokens={totalTokens}
      hasDuration={hasDuration}
      hasTokens={hasTokens}
      durationSdMs={durationSdMs}
      tokensSd={tokensSd}
    />
  );
}
