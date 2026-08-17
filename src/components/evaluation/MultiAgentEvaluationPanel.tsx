/**
 * Per-problem multi-agent evaluation controls and progressive results.
 *
 * Metric section rendering is in maeSections.tsx. Task graders are separate
 * (evaluateRun) and shown in the inspector results pane.
 */
import { useEffect, useMemo, useState } from "react";
import type { MultiAgentEvaluation } from "../../evaluation/types";
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
import { ModelSelect } from "../ui/ModelSelect";
import { BeliefSection, CurrentStep, MarbleSection } from "./maeSections";
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
