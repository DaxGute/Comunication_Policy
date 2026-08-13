import { useEffect, useMemo, useState } from "react";
import type {
  BeliefDirectionalFraction,
  BeliefDynamicsEvaluation,
  BeliefEvent,
  BeliefFraction,
  EvaluationStageState,
  MarbleEvaluation,
  MultiAgentEvaluation,
} from "../../evaluation/types";
import {
  isSuccessfulMultiAgentEvaluation,
  latestEvaluationForProblem,
  resolveRunModel,
} from "../../experiment/configAccessors";
import type { EvaluationUiState } from "../../experiment/store";
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import {
  estimateExperimentCost,
  formatEstimatedUsd,
} from "../../models/cost";
import {
  DEFAULT_EVALUATION_MODEL_ID,
  formatReasoningEffort,
} from "../../models/modelRegistry";
import {
  AUTHORITY_DIRECTIONAL,
  CROSS_POLICY_FRACTIONS,
  FAMILIARITY_FRACTIONS,
  SHOW_CROSS_POLICY_AND_TRUTH,
  TRUST_DIRECTIONAL,
  TRUTH_SPLITS,
} from "./aggregateMaeMetrics";
import { ModelSelect } from "../ui/ModelSelect";
import { OverrideEvaluationConfirm } from "./OverrideEvaluationConfirm";

type Props = {
  run: ExperimentRun;
  conversation: ProblemConversation;
  evaluationUi?: EvaluationUiState;
  onRunEvaluation: (options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: MultiAgentEvaluation["reasoningEffort"];
    retryFrom?: MultiAgentEvaluation;
    overrideExisting?: boolean;
  }) => Promise<unknown>;
};

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return `${(value * 100).toFixed(0)}%`;
}

function formatFrac(value: BeliefFraction | undefined): string {
  if (!value || value.rate === null || value.denominator === 0) return "N/A";
  return `${formatPct(value.rate)} · ${value.numerator}/${value.denominator}`;
}

function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return String(value);
}

function hasDefinedRate(value: BeliefFraction | undefined): boolean {
  return Boolean(value && value.rate !== null && value.denominator > 0);
}

function MetricRow({
  label,
  value,
  hint,
  sub,
}: {
  label: string;
  value?: string;
  hint?: string;
  sub?: string;
}) {
  return (
    <div className="mae-metric-row">
      <div className="mae-metric-row__head">
        <dt>
          <span className="mae-metric-row__label">{label}</span>
          {sub ? (
            <span className="mae-metric-row__sub muted mono" title={sub}>
              {sub}
            </span>
          ) : null}
          {hint ? (
            <span className="mae-metric-row__sub muted" title={hint}>
              {hint}
            </span>
          ) : null}
        </dt>
        {value ? <dd className="mono">{value}</dd> : null}
      </div>
    </div>
  );
}

function DirectionalRow({
  label,
  data,
  hint,
}: {
  label: string;
  data: BeliefDirectionalFraction | undefined;
  hint?: string;
}) {
  if (!data) return null;
  const showDir =
    hasDefinedRate(data.aToB) || hasDefinedRate(data.bToA);
  return (
    <MetricRow
      label={label}
      value={formatFrac(data.overall)}
      hint={hint}
      sub={
        showDir
          ? `A→B ${formatFrac(data.aToB)}  B→A ${formatFrac(data.bToA)}`
          : undefined
      }
    />
  );
}

function TruthSplitRow({
  label,
  correct,
  incorrect,
}: {
  label: string;
  correct: BeliefFraction | undefined;
  incorrect: BeliefFraction | undefined;
}) {
  if (!hasDefinedRate(correct) && !hasDefinedRate(incorrect)) return null;
  return (
    <MetricRow
      label={label}
      sub={`correct ${formatFrac(correct)}  incorrect ${formatFrac(incorrect)}`}
    />
  );
}

function eventFlags(event: BeliefEvent): string[] {
  const flags: string[] = [];
  if (event.hasEvidence) flags.push("evidence");
  if (event.isNovel) flags.push("novel");
  if (event.isRepetition) flags.push("repeat");
  if (event.isRedundantRederivation) flags.push("re-derive");
  if (event.reusesEstablishedInfo) flags.push("reuse");
  if (event.isCoordination) flags.push("coordination");
  if (event.usesShorthand || event.referenceStyle === "shorthand") {
    flags.push("shorthand");
  }
  if (event.referenceResolved === false) flags.push("unresolved-ref");
  if (typeof event.expressedConfidence === "number") {
    flags.push(`conf ${event.expressedConfidence.toFixed(2)}`);
  }
  return flags;
}

function formatScore5(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)} / 5`;
}

function currentStage(
  stages: EvaluationStageState[],
): EvaluationStageState | undefined {
  return (
    stages.find((stage) => stage.status === "running") ??
    stages.find((stage) => stage.status === "failed") ??
    stages.at(-1)
  );
}

function CurrentStep({ stages }: { stages: EvaluationStageState[] }) {
  const stage = currentStage(stages);
  if (!stage) {
    return (
      <div className="mae-current-step">
        <span className="mae-current-step__label">Starting evaluation…</span>
        <span className="mae-current-step__bar" aria-hidden="true" />
      </div>
    );
  }

  const isFailed = stage.status === "failed";
  return (
    <div
      className={`mae-current-step${isFailed ? " mae-current-step--failed" : ""}`}
    >
      <span className="mae-current-step__label">{stage.label}</span>
      {!isFailed ? (
        <span className="mae-current-step__bar" aria-hidden="true" />
      ) : null}
      {stage.detail ? (
        <span className="mae-current-step__detail muted">{stage.detail}</span>
      ) : null}
    </div>
  );
}

function MarbleSection({ data }: { data: MarbleEvaluation }) {
  return (
    <section className="mae-section">
      <h4>MultiAgentBench / MARBLE</h4>
      <p className="mae-canon-label">Standardized coordination metrics</p>
      <dl className="mae-metrics">
        <div>
          <dt>Communication</dt>
          <dd className="mono">{formatScore5(data.communicationScore)}</dd>
        </div>
        <div>
          <dt>Planning</dt>
          <dd className="mono">{formatScore5(data.planningScore)}</dd>
        </div>
        <div>
          <dt>Coordination</dt>
          <dd className="mono">{formatScore5(data.coordinationScore)}</dd>
        </div>
      </dl>
      <details className="mae-details">
        <summary>MARBLE adapter notes</summary>
        <ul>
          {data.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="muted mono">
          commit {data.marbleCommit?.slice(0, 8)} · adapter {data.adapterVersion}
        </p>
      </details>
    </section>
  );
}

function BeliefSection({ data }: { data: BeliefDynamicsEvaluation }) {
  const m = data.metrics;
  const trust = m.trust;
  const authority = m.authority;
  const familiarity = m.familiarity;
  const crossPolicy = m.crossPolicy;
  const truth = m.truthConditioned;
  return (
    <section className="mae-section">
      <h4>Belief Dynamics</h4>
      <p className="mae-canon-label">
        Trajectory metrics from claims/events — policy sliders were not shown to
        the evaluator
      </p>
      {!trust || !authority || !familiarity || !crossPolicy ? (
        <dl className="mae-metrics">
          <div>
            <dt>Claims introduced</dt>
            <dd className="mono">{m.claimsIntroduced}</dd>
          </div>
          <div>
            <dt>Incorrect claims</dt>
            <dd className="mono">{m.incorrectClaims}</dd>
          </div>
          <div>
            <dt>Correction rate</dt>
            <dd className="mono">{formatPct(m.errorCorrectionRate)}</dd>
          </div>
          <div>
            <dt>Reinforcement rate</dt>
            <dd className="mono">{formatPct(m.errorReinforcementRate)}</dd>
          </div>
          <div>
            <dt>Challenges</dt>
            <dd className="mono">{m.challenges}</dd>
          </div>
          <div>
            <dt>Successful challenges</dt>
            <dd className="mono">{m.successfulChallenges}</dd>
          </div>
          <div>
            <dt>Independent critique</dt>
            <dd className="mono">{formatPct(m.independentCritiqueRate)}</dd>
          </div>
          <div>
            <dt>Deference</dt>
            <dd className="mono">{formatPct(m.deferenceRate)}</dd>
          </div>
          <div>
            <dt>Correct convergence</dt>
            <dd className="mono">{m.correctConvergenceCount}</dd>
          </div>
          <div>
            <dt>Erroneous convergence</dt>
            <dd className="mono">{m.erroneousConvergenceCount}</dd>
          </div>
        </dl>
      ) : (
        <>
          <div className="mae-metric-group">
            <h5>Trust Behavior</h5>
            <dl className="mae-metric-list">
              {TRUST_DIRECTIONAL.map((spec) => (
                <DirectionalRow
                  key={spec.label}
                  label={spec.label}
                  data={spec.pick(trust)}
                  hint={spec.hint}
                />
              ))}
            </dl>
          </div>

          <div className="mae-metric-group">
            <h5>Authority Behavior</h5>
            <dl className="mae-metric-list">
              {AUTHORITY_DIRECTIONAL.map((spec) => (
                <DirectionalRow
                  key={spec.label}
                  label={spec.label}
                  data={spec.pick(authority)}
                  hint={spec.hint}
                />
              ))}
              <MetricRow
                label="Incorrect high-influence persistence"
                value={formatFrac(
                  authority.incorrectHighInfluencePersistence,
                )}
              />
              <MetricRow
                label="Evidence-over-authority"
                value={formatFrac(authority.evidenceOverAuthority)}
              />
              <MetricRow
                label="Decision concentration"
                value={
                  authority.decisionConcentration.herfindahl === null
                    ? "N/A"
                    : `HHI ${authority.decisionConcentration.herfindahl.toFixed(2)}${
                        authority.decisionConcentration.dominantAgent
                          ? ` · ${authority.decisionConcentration.dominantAgent}`
                          : ""
                      }`
                }
                sub={`A share ${formatFrac(authority.decisionConcentration.agent_aShare)}  B share ${formatFrac(authority.decisionConcentration.agent_bShare)}`}
              />
              <MetricRow
                label="Initiative concentration"
                value={
                  authority.initiativeConcentration.herfindahl === null
                    ? "N/A"
                    : `HHI ${authority.initiativeConcentration.herfindahl.toFixed(2)}`
                }
              />
              <MetricRow
                label="Final-answer ownership"
                value={`A ${formatFrac(authority.finalAnswerOwnership.agent_aShare)} · B ${formatFrac(authority.finalAnswerOwnership.agent_bShare)}`}
              />
              <MetricRow
                label="Speaking A"
                value={`${formatCount(authority.speakingDominance.agent_a.tokens)} tok · ${authority.speakingDominance.agent_a.claimsIntroduced} claims · ${authority.speakingDominance.agent_a.proposals} proposals`}
                hint="Descriptive only — authority is taken from disagreement/deference, not token share"
              />
              <MetricRow
                label="Speaking B"
                value={`${formatCount(authority.speakingDominance.agent_b.tokens)} tok · ${authority.speakingDominance.agent_b.claimsIntroduced} claims · ${authority.speakingDominance.agent_b.proposals} proposals`}
                sub={
                  authority.speakingDominance.tokenShareA !== null
                    ? `A token share ${formatPct(authority.speakingDominance.tokenShareA)}`
                    : undefined
                }
              />
            </dl>
          </div>

          <div className="mae-metric-group">
            <h5>Familiarity Behavior</h5>
            <dl className="mae-metric-list">
              {FAMILIARITY_FRACTIONS.map((spec) => (
                <MetricRow
                  key={spec.label}
                  label={spec.label}
                  value={formatFrac(spec.pick(familiarity))}
                />
              ))}
              <MetricRow
                label="Repair cost"
                value={
                  familiarity.repairCost.episodes === 0
                    ? "N/A"
                    : `${formatCount(familiarity.repairCost.meanTurns)} turns · ${formatCount(familiarity.repairCost.meanTokens)} tok · ${familiarity.repairCost.resolved}/${familiarity.repairCost.episodes} resolved`
                }
              />
            </dl>
          </div>

          {SHOW_CROSS_POLICY_AND_TRUTH ? (
            <div className="mae-metric-group">
              <h5>Cross-Policy Dynamics</h5>
              <dl className="mae-metric-list">
                {CROSS_POLICY_FRACTIONS.map((spec) => (
                  <MetricRow
                    key={spec.label}
                    label={spec.label}
                    value={formatFrac(spec.pick(crossPolicy))}
                  />
                ))}
                <MetricRow
                  label="Novel contribution balance"
                  value={`A ${formatFrac(crossPolicy.novelContributionBalance.agent_aShare)} · B ${formatFrac(crossPolicy.novelContributionBalance.agent_bShare)}`}
                />
                <MetricRow
                  label="Turns to convergence"
                  value={formatCount(crossPolicy.turnsToConvergence)}
                />
                <MetricRow
                  label="Correct / erroneous convergence"
                  value={`${m.correctConvergenceCount} / ${m.erroneousConvergenceCount}`}
                />
              </dl>
            </div>
          ) : null}

          {SHOW_CROSS_POLICY_AND_TRUTH && m.hasCheckableClaims && truth ? (
            <div className="mae-metric-group">
              <h5>Truth-conditioned splits</h5>
              <dl className="mae-metric-list">
                {TRUTH_SPLITS.map((spec) => {
                  const split = spec.pick(truth);
                  return (
                    <TruthSplitRow
                      key={spec.label}
                      label={spec.label}
                      correct={split.correct}
                      incorrect={split.incorrect}
                    />
                  );
                })}
                <MetricRow
                  label="Abandonment of correct claims"
                  value={formatFrac(truth.abandonmentOfCorrect)}
                />
                <MetricRow
                  label="Correction of incorrect claims"
                  value={formatFrac(truth.correctionOfIncorrect)}
                />
              </dl>
            </div>
          ) : null}
        </>
      )}
      <details className="mae-details">
        <summary>Inspect Interaction Events</summary>
        <div className="mae-events">
          {data.claims.map((claim) => (
            <div key={claim.id} className="mae-claim">
              <div className="mae-claim__head">
                <strong>{claim.id}</strong>
                <span className="mono">
                  {(claim.kind ?? "claim").toUpperCase()} ·{" "}
                  {claim.correctness.toUpperCase()} · {claim.finalStatus}
                  {claim.survivedIntoFinalAnswer ? " · final" : ""}
                </span>
              </div>
              <p>{claim.text}</p>
              {claim.evidence ? (
                <p className="muted">Evidence: {claim.evidence}</p>
              ) : null}
              <ul>
                {claim.events.map((event, idx) => (
                  <li key={`${claim.id}-${idx}-${event.turn}`}>
                    <span className="mono">
                      TURN {event.turn} · {event.agent} · {event.action.toUpperCase()}
                    </span>
                    {event.evidence ? (
                      <div className="muted">{event.evidence}</div>
                    ) : null}
                    {eventFlags(event).length > 0 ? (
                      <div className="mae-tag">{eventFlags(event).join(" · ")}</div>
                    ) : null}
                    {event.resultingBeliefChange === true ? (
                      <div className="mae-tag">successful change</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

function EvaluationResults({
  evaluation,
}: {
  evaluation: MultiAgentEvaluation;
}) {
  return (
    <div className="mae-panel__results">
      <p className="muted mono">
        {evaluation.evaluatorModel}
        {evaluation.reasoningEffort
          ? ` · reasoning ${formatReasoningEffort(evaluation.reasoningEffort)}`
          : ""}
      </p>
      {evaluation.componentStatus.marble === "failed" ? (
        <section className="mae-section mae-section--error">
          <h4>MultiAgentBench / MARBLE</h4>
          <p>
            {evaluation.errors.find((e) => e.component === "marble")?.message ??
              "MARBLE evaluation failed."}
          </p>
        </section>
      ) : evaluation.marble ? (
        <MarbleSection data={evaluation.marble.normalized} />
      ) : null}
      {evaluation.componentStatus.belief === "failed" ? (
        <section className="mae-section mae-section--error">
          <h4>Belief Dynamics</h4>
          <p>
            {evaluation.errors.find((e) => e.component === "belief")?.message ??
              "Belief evaluation failed."}
          </p>
        </section>
      ) : evaluation.beliefDynamics ? (
        <BeliefSection data={evaluation.beliefDynamics.normalized} />
      ) : null}
    </div>
  );
}

export function MultiAgentEvaluationPanel({
  run,
  conversation,
  evaluationUi,
  onRunEvaluation,
}: Props) {
  const [evaluatorModel, setEvaluatorModel] = useState(
    run.config.evaluationModel || DEFAULT_EVALUATION_MODEL_ID,
  );
  const [evaluationReasoningEffort, setEvaluationReasoningEffort] = useState(
    run.config.evaluationReasoningEffort,
  );
  const [confirmingOverride, setConfirmingOverride] = useState(false);
  const evalCostEstimate = useMemo(() => {
    const estimate = estimateExperimentCost({
      runModel: resolveRunModel(run.config),
      evaluationModel: evaluatorModel,
      problemCount: 1,
      maxTurns: run.config.maxTurns,
      evaluationEnabled: true,
    });
    return formatEstimatedUsd(estimate.evaluationUsd);
  }, [run.config, evaluatorModel]);
  const latest = useMemo(
    () => latestEvaluationForProblem(run, conversation.problemId),
    [run, conversation.problemId],
  );
  const alreadySucceeded = isSuccessfulMultiAgentEvaluation(latest);

  useEffect(() => {
    setConfirmingOverride(false);
  }, [run.id, conversation.problemId]);
  const isThisRunning =
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    evaluationUi.problemId === conversation.problemId;
  const isBatchElsewhere =
    evaluationUi?.status === "running" &&
    evaluationUi.runId === run.id &&
    Boolean(evaluationUi.batch) &&
    evaluationUi.problemId !== conversation.problemId;

  const canEvaluate =
    (run.status === "completed" ||
      run.status === "cancelled" ||
      run.status === "failed") &&
    evaluationUi?.status !== "running";

  const displayEvaluation = isThisRunning
    ? evaluationUi?.partial
    : latest;

  return (
    <div className="mae-panel">
      <header className="mae-panel__header">
        <div className="mae-panel__header-row">
          <div>
            <h3>Multi-Agent Evaluation</h3>
          </div>
          {!isThisRunning ? (
            <div className="mae-panel__controls">
              <span className="mae-panel__estimate muted">
                Estimated evaluation cost{" "}
                <span className="mono">{evalCostEstimate}</span>
              </span>
              <div className="mae-panel__model">
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
                  className="mae-panel__run"
                  disabled={!canEvaluate}
                  onClick={() => {
                    if (alreadySucceeded) {
                      setConfirmingOverride(true);
                      return;
                    }
                    void onRunEvaluation({
                      runId: run.id,
                      problemId: conversation.problemId,
                      evaluatorModel,
                      evaluationReasoningEffort,
                    });
                  }}
                >
                  {alreadySucceeded ? "Re-run Evaluation" : "Run Evaluation"}
                </button>
              )}
              {latest?.componentStatus.marble === "failed" ? (
                <button
                  type="button"
                  className="mae-panel__retry"
                  onClick={() => {
                    void onRunEvaluation({
                      runId: run.id,
                      problemId: conversation.problemId,
                      evaluatorModel,
                      evaluationReasoningEffort,
                      retryFrom: latest,
                    });
                  }}
                >
                  Retry failed components
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {isThisRunning ? (
          <p className="muted">Running with {evaluationUi?.evaluatorModel}</p>
        ) : isBatchElsewhere ? (
          <p className="muted">Waiting for batch evaluation…</p>
        ) : confirmingOverride ? (
          <OverrideEvaluationConfirm
            message="This problem already has a completed evaluation. Type yes to override it with a new run."
            onConfirm={() => {
              setConfirmingOverride(false);
              void onRunEvaluation({
                runId: run.id,
                problemId: conversation.problemId,
                evaluatorModel,
                evaluationReasoningEffort,
                overrideExisting: true,
              });
            }}
            onCancel={() => setConfirmingOverride(false)}
          />
        ) : null}
      </header>

      {isThisRunning ? <CurrentStep stages={evaluationUi?.stages ?? []} /> : null}

      {displayEvaluation &&
      (displayEvaluation.marble ||
        displayEvaluation.beliefDynamics ||
        displayEvaluation.componentStatus.marble === "failed" ||
        displayEvaluation.componentStatus.belief === "failed") ? (
        <EvaluationResults evaluation={displayEvaluation} />
      ) : !isThisRunning && !isBatchElsewhere ? (
        <p className="muted">
          Evaluation does not run automatically. Choose an evaluation model and
          click Run Evaluation after the conversation completes.
        </p>
      ) : null}
    </div>
  );
}
