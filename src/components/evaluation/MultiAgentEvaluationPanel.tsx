import { useMemo, useState } from "react";
import type {
  BeliefDynamicsEvaluation,
  EvaluationStageState,
  MarbleEvaluation,
  MultiAgentEvaluation,
} from "../../evaluation/types";
import type { EvaluationUiState } from "../../experiment/store";
import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import { AVAILABLE_MODELS, OPENAI_MODEL_ID } from "../../runtime/models";

type Props = {
  run: ExperimentRun;
  conversation: ProblemConversation;
  evaluationUi?: EvaluationUiState;
  onRunEvaluation: (options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    retryFrom?: MultiAgentEvaluation;
  }) => Promise<unknown>;
};

function latestEvaluation(
  run: ExperimentRun,
  problemId: string,
): MultiAgentEvaluation | undefined {
  const list = (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list[0];
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(0)}%`;
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
  return (
    <section className="mae-section">
      <h4>Belief Dynamics</h4>
      <p className="mae-canon-label">Experiment-specific interaction metrics</p>
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
      <details className="mae-details">
        <summary>Inspect Interaction Events</summary>
        <div className="mae-events">
          {data.claims.map((claim) => (
            <div key={claim.id} className="mae-claim">
              <div className="mae-claim__head">
                <strong>{claim.id}</strong>
                <span className="mono">
                  {claim.correctness.toUpperCase()} · {claim.finalStatus}
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
    run.config.provider === "openai" ? run.config.model : OPENAI_MODEL_ID,
  );
  const latest = useMemo(
    () => latestEvaluation(run, conversation.problemId),
    [run, conversation.problemId],
  );
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
              <label className="mae-panel__model">
                <span>Evaluator Model</span>
                <select
                  value={evaluatorModel}
                  onChange={(e) => setEvaluatorModel(e.target.value)}
                  disabled={!canEvaluate}
                >
                  {AVAILABLE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="mae-panel__run"
                disabled={!canEvaluate}
                onClick={() => {
                  void onRunEvaluation({
                    runId: run.id,
                    problemId: conversation.problemId,
                    evaluatorModel,
                  });
                }}
              >
                Run Evaluation
              </button>
              {latest?.componentStatus.marble === "failed" ? (
                <button
                  type="button"
                  className="mae-panel__retry"
                  onClick={() => {
                    void onRunEvaluation({
                      runId: run.id,
                      problemId: conversation.problemId,
                      evaluatorModel,
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
          Evaluation does not run automatically. Choose an evaluator model and
          click Run Evaluation after the conversation completes.
        </p>
      ) : null}
    </div>
  );
}
