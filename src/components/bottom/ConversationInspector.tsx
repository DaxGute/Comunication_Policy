import { useEffect, useState } from "react";
import { formatPolicyValue } from "../../communication";
import type { ProblemEvaluation } from "../../evaluation/types";
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { CrosswordSpec } from "../../problems/crossword/types";
import { getProblemById } from "../../problems/registry";
import { CrosswordPreview } from "../crossword/CrosswordBoard";

type Props = {
  runs: ExperimentRun[];
  selectedRun?: ExperimentRun;
  selectedProblemId?: string;
  onSelectRun: (runId: string) => void;
  onSelectProblem: (problemId: string) => void;
  onDeleteRun: (runId: string) => void;
};

function runSummaryLine(run: ExperimentRun): string | undefined {
  const s = run.evaluation?.summary;
  if (!s) return undefined;
  if (typeof s.crosswordLetterAccuracy === "number") {
    return `letter ${s.crosswordLetterAccuracy} · exact ${s.crosswordExactSolveRate}`;
  }
  if (typeof s.stanceRate === "number") {
    return `stance rate ${s.stanceRate} (${s.stancesReached}/${s.moralDilemmas})`;
  }
  if (typeof s.proofAccuracy === "number") {
    return `accuracy ${s.proofAccuracy} (${s.proofCorrect}/${s.proofProblems})`;
  }
  if (typeof s.problemsCompleted === "number") {
    return `${s.problemsCompleted} problems · avg turns ${s.averageTurns ?? "—"}`;
  }
  return undefined;
}

function formatPct(value: unknown): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return `${(value * 100).toFixed(1)}%`;
}

export function ConversationInspector({
  runs,
  selectedRun,
  selectedProblemId,
  onSelectRun,
  onSelectProblem,
  onDeleteRun,
}: Props) {
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(
    () => new Set(selectedRun ? [selectedRun.id] : []),
  );

  useEffect(() => {
    const id = selectedRun?.id;
    if (!id) return;
    setExpandedRunIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [selectedRun?.id]);

  const conversation = selectedRun?.conversations.find(
    (c) => c.problemId === selectedProblemId,
  );
  const problemEvaluation = selectedRun?.evaluation?.problems.find(
    (p) => p.problemId === selectedProblemId,
  );

  function toggleRunExpanded(runId: string) {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  return (
    <div className="conversation-inspector">
      <aside className="conversation-inspector__nav">
        <h2>Conversation Inspector</h2>
        <p className="muted">
          Runs, transcripts, and stats are saved locally. Delete a run with ×.
        </p>

        {runs.length === 0 ? (
          <p className="muted empty-state">Run an evaluation to populate.</p>
        ) : (
          <ul className="conv-tree">
            {runs.map((run, index) => {
              const runNumber = runs.length - index;
              const stats = runSummaryLine(run);
              const active = selectedRun?.id === run.id;
              const expanded = expandedRunIds.has(run.id);
              return (
                <li key={run.id}>
                  <div
                    className={
                      active
                        ? "conv-tree__run-row conv-tree__run-row--active"
                        : "conv-tree__run-row"
                    }
                  >
                    <button
                      type="button"
                      className="conv-tree__expand"
                      aria-expanded={expanded}
                      aria-label={
                        expanded
                          ? `Collapse Run #${runNumber}`
                          : `Expand Run #${runNumber}`
                      }
                      onClick={() => toggleRunExpanded(run.id)}
                    >
                      <svg
                        className="conv-tree__chevron"
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
                    </button>
                    <button
                      type="button"
                      className="conv-tree__run"
                      onClick={() => {
                        onSelectRun(run.id);
                        setExpandedRunIds((prev) => {
                          if (prev.has(run.id)) return prev;
                          const next = new Set(prev);
                          next.add(run.id);
                          return next;
                        });
                      }}
                    >
                      <span className="conv-tree__run-title">
                        Run #{runNumber}
                        <span className="conv-tree__run-status">
                          {run.status}
                        </span>
                      </span>
                      <span className="muted conv-tree__run-meta">
                        {run.config.problemCategory} · Tₐ
                        {formatPolicyValue(run.policy.trustA)} Tᵦ
                        {formatPolicyValue(run.policy.trustB)} Auth
                        {formatPolicyValue(run.policy.authority)} F
                        {formatPolicyValue(run.policy.familiarity)}
                      </span>
                      {stats ? (
                        <span className="muted conv-tree__run-stats">
                          {stats}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="conv-tree__delete"
                      aria-label={`Delete Run #${runNumber}`}
                      onClick={() => onDeleteRun(run.id)}
                    >
                      ×
                    </button>
                  </div>
                  {expanded ? (
                    <ul className="conv-tree__problems">
                      {run.conversations.map((c, pIndex) => (
                        <li key={c.problemId}>
                          <button
                            type="button"
                            className={
                              selectedProblemId === c.problemId && active
                                ? "conv-tree__problem conv-tree__problem--active"
                                : "conv-tree__problem"
                            }
                            onClick={() => {
                              if (!active) onSelectRun(run.id);
                              onSelectProblem(c.problemId);
                            }}
                          >
                            Problem {pIndex + 1} — {c.problemTitle}
                            <span className="muted">
                              {" "}
                              ({c.messages.length} msgs)
                            </span>
                          </button>
                        </li>
                      ))}
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
        ) : !conversation ? (
          <p className="muted empty-state">
            Select a problem to inspect its transcript.
          </p>
        ) : (
          <TranscriptView
            conversation={conversation}
            evaluation={problemEvaluation}
            crossword={
              selectedRun.config.problemCategory === "crossword"
                ? getProblemById(
                    selectedRun.config.problemCategory,
                    conversation.problemId,
                  )?.crossword
                : undefined
            }
          />
        )}
      </div>

      <aside className="conversation-inspector__results">
        <h2>Run Results</h2>
        {selectedRun?.status === "failed" ? (
          <div className="results">
            <p className="results-error">
              Run failed
              {selectedRun.error ? `: ${selectedRun.error}` : "."}
            </p>
            <p className="muted">
              Real-model failures do not fall back to mock output. Fix the
              error and re-run.
            </p>
            <details className="snapshot-details">
              <summary>Snapshotted policy & prompts</summary>
              <pre className="prompt-block__body">
                {JSON.stringify(
                  {
                    policy: selectedRun.policy,
                    config: selectedRun.config,
                    agentPrompts: selectedRun.agentPrompts,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        ) : selectedRun?.status === "cancelled" ? (
          <div className="results">
            <p className="results-error">
              Run cancelled
              {selectedRun.conversations.length > 0
                ? ` after ${selectedRun.conversations.length} problem${selectedRun.conversations.length === 1 ? "" : "s"}.`
                : " before any problem finished."}
            </p>
            {selectedRun.evaluation ? (
              <ResultsView run={selectedRun} />
            ) : (
              <p className="muted">No completed problems to evaluate.</p>
            )}
          </div>
        ) : !selectedRun?.evaluation ? (
          <p className="muted empty-state">
            Select a completed run to inspect results.
          </p>
        ) : (
          <ResultsView run={selectedRun} />
        )}
      </aside>
    </div>
  );
}

function TranscriptView({
  conversation,
  evaluation,
  crossword,
}: {
  conversation: ProblemConversation;
  evaluation?: ProblemEvaluation;
  crossword?: CrosswordSpec;
}) {
  const isCrossword = evaluation?.details?.grader === "crossword";
  const predictedGrid =
    typeof evaluation?.details?.predictedGrid === "string"
      ? evaluation.details.predictedGrid
      : undefined;

  return (
    <div className="transcript">
      <header className="transcript__header">
        <h3>{conversation.problemTitle}</h3>
        {crossword ? (
          <CrosswordPreview
            crossword={crossword}
            predictedGrid={predictedGrid}
          />
        ) : (
          <pre className="transcript__problem mono">
            {conversation.problemText}
          </pre>
        )}
        <div className="transcript__meta muted">
          stopped: {conversation.stoppedReason}
          {conversation.finalAnswer && !crossword
            ? ` · FINAL_ANSWER: ${conversation.finalAnswer}`
            : ""}
          {evaluation?.label ? ` · ${evaluation.label}` : ""}
          {typeof evaluation?.score === "number" && !isCrossword
            ? ` · score=${evaluation.score}`
            : ""}
        </div>
        {evaluation ? <ProblemResultDetails evaluation={evaluation} /> : null}
      </header>

      <ol className="transcript__messages">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.agentId === "agent_a"
                ? "transcript__msg transcript__msg--a"
                : "transcript__msg transcript__msg--b"
            }
          >
            <div className="transcript__msg-head">
              <strong>
                Turn {message.turnIndex} ·{" "}
                {message.agentId === "agent_a" ? "Agent A" : "Agent B"}
              </strong>
              {message.timestamp ? (
                <span className="muted mono">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              ) : null}
            </div>
            <pre className="transcript__msg-body">{message.content}</pre>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ProblemResultDetails({
  evaluation,
}: {
  evaluation: ProblemEvaluation;
}) {
  const isCrossword = evaluation.details?.grader === "crossword";

  return (
    <div className="transcript__result-details">
      {isCrossword ? (
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
            Exact solve:{" "}
            {evaluation.details?.exactSolve === true ? "Yes" : "No"}
          </div>
        </div>
      ) : null}
      {evaluation.finalAnswer && !isCrossword ? (
        <div className="mono results-answer">
          {evaluation.details?.grader === "moral_open_ended"
            ? `stance: ${evaluation.finalAnswer}`
            : `predicted: ${evaluation.finalAnswer}`}
          {typeof evaluation.details?.goldNormalized === "string"
            ? ` · gold: ${evaluation.details.goldNormalized}`
            : ""}
        </div>
      ) : null}
      {evaluation.notes && !isCrossword ? (
        <div className="muted">{evaluation.notes}</div>
      ) : null}
    </div>
  );
}

function ResultsView({ run }: { run: ExperimentRun }) {
  const { evaluation } = run;
  if (!evaluation) return null;

  return (
    <div className="results">
      <dl className="results-summary">
        {Object.entries(evaluation.summary).map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className="mono">{String(value)}</dd>
          </div>
        ))}
      </dl>
      <ul className="results-problems">
        {evaluation.problems.map((p) => {
          const isCrossword = p.details?.grader === "crossword";
          return (
            <li key={p.problemId}>
              <strong>{p.problemTitle}</strong>
              <div className="muted">
                turns={p.turns}
                {p.label ? ` · ${p.label}` : ""}
                {typeof p.score === "number" && !isCrossword
                  ? ` · score=${p.score}`
                  : ""}
              </div>
              {isCrossword ? (
                <div className="results-crossword-metrics mono">
                  <div>
                    Letter accuracy:{" "}
                    {formatPct(p.details?.letterAccuracy) ?? "—"}
                  </div>
                  <div>
                    Word accuracy: {formatPct(p.details?.wordAccuracy) ?? "—"}
                  </div>
                  <div>
                    Completion: {formatPct(p.details?.completion) ?? "—"}
                  </div>
                  <div>
                    Crossing consistency:{" "}
                    {formatPct(p.details?.crossingConsistency) ?? "n/a"}
                  </div>
                  <div>
                    Exact solve: {p.details?.exactSolve === true ? "Yes" : "No"}
                  </div>
                </div>
              ) : null}
              {p.finalAnswer ? (
                <div className="mono results-answer">
                  {p.details?.grader === "moral_open_ended"
                    ? `stance: ${p.finalAnswer}`
                    : `predicted: ${p.finalAnswer}`}
                  {typeof p.details?.goldNormalized === "string"
                    ? ` · gold: ${p.details.goldNormalized}`
                    : ""}
                </div>
              ) : null}
              {typeof p.details?.predictedGrid === "string" ? (
                <pre className="results-grid mono">{p.details.predictedGrid}</pre>
              ) : null}
              {p.notes && !isCrossword ? (
                <div className="muted">{p.notes}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <details className="snapshot-details">
        <summary>Snapshotted policy & prompts</summary>
        <pre className="prompt-block__body">
          {JSON.stringify(
            {
              policy: run.policy,
              config: run.config,
              agentPrompts: run.agentPrompts,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
