import { formatPolicyValue } from "../../communication";
import type { ProblemEvaluation } from "../../evaluation/types";
import type { ExperimentRun, ProblemConversation, ConversationMessage } from "../../experiment/types";
import type { CrosswordSpec } from "../../problems/crossword/types";
import { getProblemById } from "../../problems/registry";
import { CrosswordPreview } from "../crossword/CrosswordBoard";

type Props = {
  runs: ExperimentRun[];
  selectedRun?: ExperimentRun;
  onSelectRun: (runId: string) => void;
  onDeleteRun: (runId: string) => void;
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

function runMetaLine(run: ExperimentRun): string {
  const { config, policy } = run;
  return [
    config.problemCategory,
    config.model,
    `Tₐ ${formatPolicyValue(policy.trustA)} Tᵦ ${formatPolicyValue(policy.trustB)}`,
    `Auth ${formatPolicyValue(policy.authority)}`,
    `F ${formatPolicyValue(policy.familiarity)}`,
  ].join(" · ");
}

function formatPct(value: unknown): string | undefined {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return `${(value * 100).toFixed(1)}%`;
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
  onSelectRun,
  onDeleteRun,
}: Props) {
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
            {runs.map((run) => {
              const title = formatRunFinishTitle(run);
              const active = selectedRun?.id === run.id;
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
                      className="conv-tree__run"
                      onClick={() => onSelectRun(run.id)}
                    >
                      <span className="conv-tree__run-title">
                        {title}
                        <span className="conv-tree__run-status">
                          {run.status}
                        </span>
                      </span>
                      <span className="muted conv-tree__run-meta">
                        {runMetaLine(run)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="conv-tree__delete"
                      aria-label={`Delete run ${title}`}
                      onClick={() => onDeleteRun(run.id)}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="conversation-inspector__transcript">
        {!selectedRun ? (
          <p className="muted empty-state">Select a run.</p>
        ) : selectedRun.conversations.length === 0 ? (
          <p className="muted empty-state">
            No transcripts yet for this run.
          </p>
        ) : (
          <div className="transcript-stack">
            {selectedRun.conversations.map((conversation) => {
              const evaluation = selectedRun.evaluation?.problems.find(
                (p) => p.problemId === conversation.problemId,
              );
              return (
                <TranscriptView
                  key={conversation.problemId}
                  conversation={conversation}
                  evaluation={evaluation}
                  crossword={
                    selectedRun.config.problemCategory === "crossword"
                      ? getProblemById(
                          selectedRun.config.problemCategory,
                          conversation.problemId,
                        )?.crossword
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>

      <aside className="conversation-inspector__results">
        <h2>Run Results</h2>
        {!selectedRun ? (
          <p className="muted empty-state">Select a run.</p>
        ) : (
          <div className="results">
            <RunSpecView run={selectedRun} />
            {selectedRun.status === "failed" ? (
              <>
                <p className="results-error">
                  Run failed
                  {selectedRun.error ? `: ${selectedRun.error}` : "."}
                </p>
                <p className="muted">
                  Real-model failures do not fall back to mock output. Fix the
                  error and re-run.
                </p>
              </>
            ) : selectedRun.status === "cancelled" ? (
              <>
                <p className="results-error">
                  Run cancelled
                  {selectedRun.conversations.length > 0
                    ? ` after ${selectedRun.conversations.length} problem${selectedRun.conversations.length === 1 ? "" : "s"}.`
                    : " before any problem finished."}
                </p>
                {selectedRun.evaluation ? (
                  <EvaluationSummary evaluation={selectedRun.evaluation} />
                ) : (
                  <p className="muted">No completed problems to evaluate.</p>
                )}
              </>
            ) : selectedRun.evaluation ? (
              <EvaluationSummary evaluation={selectedRun.evaluation} />
            ) : (
              <p className="muted empty-state">
                Select a completed run to inspect results.
              </p>
            )}
            <details className="snapshot-details">
              <summary>Snapshotted prompts</summary>
              <pre className="prompt-block__body">
                {JSON.stringify(selectedRun.agentPrompts, null, 2)}
              </pre>
            </details>
          </div>
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
          <>
            <CrosswordPreview
              crossword={crossword}
              predictedGrid={predictedGrid}
              aside={
                evaluation && isCrossword ? (
                  <CrosswordMetrics
                    evaluation={evaluation}
                    messages={conversation.messages}
                  />
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
          {conversation.finalAnswer && !crossword
            ? ` · FINAL_ANSWER: ${conversation.finalAnswer}`
            : ""}
          {evaluation?.label ? ` · ${evaluation.label}` : ""}
          {typeof evaluation?.score === "number" && !isCrossword
            ? ` · score=${evaluation.score}`
            : ""}
        </div>
        {evaluation && !isCrossword ? (
          <ProblemResultDetails evaluation={evaluation} />
        ) : null}
      </header>

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
        <div>Total time: {hasDuration ? formatDuration(totalDurationMs) : "—"}</div>
        <div>
          Total tokens: {hasTokens ? formatTokenCount(totalTokens) : "—"}
        </div>
      </div>
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
          {evaluation.details?.grader === "moral_open_ended"
            ? `stance: ${evaluation.finalAnswer}`
            : `predicted: ${evaluation.finalAnswer}`}
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
  return (
    <div className="results-spec">
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
          <dt>Model</dt>
          <dd className="mono">{config.model}</dd>
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
          <dt>Temperature</dt>
          <dd className="mono">{formatPolicyValue(config.temperature)}</dd>
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
      </dl>
    </div>
  );
}

function EvaluationSummary({
  evaluation,
}: {
  evaluation: NonNullable<ExperimentRun["evaluation"]>;
}) {
  return (
    <dl className="results-summary">
      {Object.entries(evaluation.summary).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd className="mono">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
