/**
 * Right inspector pane: run spec, task-grade summaries, and batch MAE controls.
 *
 * Per-problem transcripts and analysis tabs live in TranscriptView.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { formatPolicyValue } from "../../communication";
import { evaluateRun } from "../../evaluation/evaluateRun";
import { isIncompleteConversation } from "../../evaluation/evaluators";
import type { MultiAgentEvaluation } from "../../evaluation/types";
import {
  buildAggregatedMaeSections,
  type MaeMetricRow,
  type MaeMetricSection,
} from "../evaluation/aggregateMaeMetrics";
import {
  isSuccessfulMultiAgentEvaluation,
  resolveRunModel,
} from "../../experiment/configAccessors";
import {
  analysisStagesForProblem,
  isRunAnalysisRunning,
} from "../../experiment/evaluationUi";
import type { EvaluationUiState } from "../../experiment/store";
import { formatActualUsd, getRunCostSummary } from "../../experiment/runCost";
import type { ExperimentRun } from "../../experiment/types";
import {
  estimateExperimentCost,
  formatEstimatedUsd,
} from "../../models/cost";
import {
  DEFAULT_EVALUATION_MODEL_ID,
  displayNameForModel,
  formatReasoningEffort,
} from "../../models/modelRegistry";
import { CurrentStep } from "../evaluation/maeSections";
import { OverrideEvaluationConfirm } from "../evaluation/OverrideEvaluationConfirm";
import { ModelSelect } from "../ui/ModelSelect";
import { TokenUsagePanel } from "../ui/TokenUsagePanel";
import {
  conversationTotals,
  formatDuration,
  formatMessageCount,
  formatPct,
  formatPctSd,
  formatTokenCount,
  meanSd,
} from "./format";
import type { InspectorProps } from "./types";

export function RunSpecView({ run }: { run: ExperimentRun }) {
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

export function MetricTableRowView({
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

export function MetricTable({
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

export function RunResultsMultiAgentEval({
  run,
  evaluationUi,
  onRunAllEvaluations,
}: {
  run: ExperimentRun;
  evaluationUi?: EvaluationUiState;
  onRunAllEvaluations: InspectorProps["onRunAllEvaluations"];
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

  const isEvalRunning = isRunAnalysisRunning(run, evaluationUi);
  const canEvaluate =
    (run.status === "completed" ||
      run.status === "cancelled" ||
      run.status === "failed") &&
    !isEvalRunning &&
    evaluationUi?.status !== "running";
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
  const currentProblemId =
    evaluationUi?.runId === run.id && evaluationUi.problemId
      ? evaluationUi.problemId
      : (run.multiAgentEvaluations ?? []).find(
          (evaluation) =>
            evaluation.status === "running" || evaluation.status === "pending",
        )?.problemId;
  const currentProblem = currentProblemId
    ? run.conversations.find((c) => c.problemId === currentProblemId)
    : undefined;
  const currentIndex = Math.max(
    0,
    currentProblemId
      ? run.conversations.findIndex((c) => c.problemId === currentProblemId)
      : (evaluationUi?.runId === run.id ? (evaluationUi.batch?.currentIndex ?? 0) : 0),
  );
  const runningStages = currentProblemId
    ? analysisStagesForProblem(run, currentProblemId, evaluationUi)
    : evaluationUi?.runId === run.id
      ? evaluationUi.stages
      : [];

  const marbleEvals = evals
    .map((e) => e.marble?.normalized)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const interactionEvals = evals
    .map((e) => e.interaction?.normalized)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const beliefEvals = evals
    .map((e) => e.beliefDynamics?.normalized.metrics)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const moralEvals = evals
    .map((e) => e.moralDynamics?.normalized.deterministic)
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const sections = buildAggregatedMaeSections({
    marbleEvals,
    interactionEvals,
    beliefEvals,
    moralEvals,
  });

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
          {!isEvalRunning ? (
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
              {currentIndex + 1}/{evaluationUi?.batch?.total ?? total}
              {currentProblem?.problemTitle
                ? ` · ${currentProblem.problemTitle}`
                : ""}
            </span>
          )}
          {!isEvalRunning && evaluatedCount > 0 ? (
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
      {isEvalRunning ? <CurrentStep stages={runningStages} /> : null}
      {!isEvalRunning &&
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
      ) : !isEvalRunning ? (
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

export function MetricsBlock({
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

export function RunStatisticsRow({ run }: { run: ExperimentRun }) {
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

export function EvaluationSummary({ run }: { run: ExperimentRun }) {
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
