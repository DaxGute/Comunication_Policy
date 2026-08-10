import type { ExperimentRun, ProblemConversation } from "../experiment/types";
import { getProblemById } from "../problems/registry";
import { evaluateBeliefDynamics } from "./belief/evaluator";
import { evaluateMarblePosthoc } from "./marble/evaluator";
import type {
  EvaluationStageState,
  MultiAgentEvaluation,
} from "./types";
import {
  BELIEF_GRADER_SCHEMA_VERSION,
  BELIEF_GRADER_VERSION,
  EVALUATION_SCHEMA_VERSION,
  MARBLE_ADAPTER_VERSION,
  MARBLE_COMMIT,
  MARBLE_VERSION,
} from "./versions";

export type OrchestratorProgress = {
  evaluationId: string;
  stages: EvaluationStageState[];
  status: MultiAgentEvaluation["status"];
  /** Partial evaluation snapshot so the UI can render results as each judge finishes. */
  evaluation: MultiAgentEvaluation;
};

export type OrchestratorOptions = {
  run: ExperimentRun;
  conversation: ProblemConversation;
  evaluatorModel: string;
  /** Retry only failed components from a previous evaluation. */
  retryFrom?: MultiAgentEvaluation;
  signal?: AbortSignal;
  onProgress?: (progress: OrchestratorProgress) => void;
};

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function initialStages(): EvaluationStageState[] {
  return [
    { id: "preparing", label: "Preparing conversation", status: "pending" },
    { id: "marble", label: "MARBLE evaluation", status: "pending" },
    { id: "belief_extraction", label: "Belief extraction", status: "pending" },
    {
      id: "metric_computation",
      label: "Metric computation",
      status: "pending",
    },
    { id: "saving", label: "Saving", status: "pending" },
  ];
}

function setStage(
  stages: EvaluationStageState[],
  id: EvaluationStageState["id"],
  status: EvaluationStageState["status"],
  detail?: string,
): EvaluationStageState[] {
  return stages.map((stage) =>
    stage.id === id ? { ...stage, status, detail } : stage,
  );
}

/**
 * Post-hoc multi-agent evaluation orchestrator.
 * Never mutates the conversation transcript.
 * Task correctness stays on ExperimentRun.evaluation (existing graders).
 */
export async function runMultiAgentEvaluation(
  options: OrchestratorOptions,
): Promise<MultiAgentEvaluation> {
  const { run, conversation, evaluatorModel } = options;
  const evaluationId = options.retryFrom?.id ?? newId("mae");
  let stages = initialStages();

  const conversationId = `${run.id}:${conversation.problemId}`;
  const priorTask = run.evaluation?.problems.find(
    (p) => p.problemId === conversation.problemId,
  );
  const problem = getProblemById(
    run.config.problemCategory,
    conversation.problemId,
  );

  const record: MultiAgentEvaluation = {
    id: evaluationId,
    conversationId,
    problemId: conversation.problemId,
    runId: run.id,
    createdAt: options.retryFrom?.createdAt ?? new Date().toISOString(),
    evaluatorModel,
    status: "running",
    stages,
    componentStatus: {
      marble: "pending",
      belief: "pending",
    },
    errors: [],
    costs: options.retryFrom ? [...options.retryFrom.costs] : [],
    metadata: {
      agentAModel: run.config.model,
      agentBModel: run.config.model,
      trust: (run.policy.trustA + run.policy.trustB) / 2,
      trustA: run.policy.trustA,
      trustB: run.policy.trustB,
      authority: run.policy.authority,
      familiarity: run.policy.familiarity,
      evaluatorModel,
      marbleVersion: MARBLE_VERSION,
      marbleCommit: MARBLE_COMMIT,
      marbleAdapterVersion: MARBLE_ADAPTER_VERSION,
      evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
      beliefGraderVersion: BELIEF_GRADER_VERSION,
      beliefGraderSchemaVersion: BELIEF_GRADER_SCHEMA_VERSION,
      problemSet: run.config.problemCategory,
      problemId: conversation.problemId,
      problemTitle: conversation.problemTitle,
      runId: run.id,
      conversationId,
    },
    marble: options.retryFrom?.marble,
    beliefDynamics: options.retryFrom?.beliefDynamics,
  };

  const emit = () => {
    record.stages = stages;
    options.onProgress?.({
      evaluationId,
      stages: stages.map((stage) => ({ ...stage })),
      status: record.status,
      evaluation: {
        ...record,
        stages: stages.map((stage) => ({ ...stage })),
        errors: [...record.errors],
        costs: [...record.costs],
        componentStatus: { ...record.componentStatus },
      },
    });
  };

  const skipMarble =
    options.retryFrom?.componentStatus.marble === "completed" &&
    Boolean(options.retryFrom.marble);
  const skipBelief =
    options.retryFrom?.componentStatus.belief === "completed" &&
    Boolean(options.retryFrom.beliefDynamics);

  try {
    stages = setStage(stages, "preparing", "running");
    emit();
    void conversation.messages.length;
    stages = setStage(stages, "preparing", "completed");
    emit();

    // MARBLE
    if (skipMarble) {
      stages = setStage(stages, "marble", "skipped", "Reused prior result");
      record.componentStatus.marble = "completed";
    } else {
      stages = setStage(stages, "marble", "running");
      emit();
      try {
        const result = await evaluateMarblePosthoc({
          run,
          conversation,
          evaluatorModel,
          signal: options.signal,
        });
        record.marble = result.artifact;
        record.costs.push(result.cost);
        record.componentStatus.marble = "completed";
        stages = setStage(stages, "marble", "completed");
      } catch (error) {
        record.componentStatus.marble = "failed";
        record.errors.push({
          component: "marble",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
          retryable: true,
        });
        stages = setStage(
          stages,
          "marble",
          "failed",
          record.errors.at(-1)?.message,
        );
      }
    }
    emit();

    // Belief extraction + deterministic metrics
    if (skipBelief) {
      stages = setStage(
        stages,
        "belief_extraction",
        "skipped",
        "Reused prior result",
      );
      stages = setStage(
        stages,
        "metric_computation",
        "skipped",
        "Reused prior result",
      );
      record.componentStatus.belief = "completed";
    } else {
      stages = setStage(stages, "belief_extraction", "running");
      emit();
      try {
        const result = await evaluateBeliefDynamics({
          run,
          conversation,
          problem,
          priorTaskLabel: priorTask?.label,
          priorTaskNotes: priorTask?.notes,
          evaluatorModel,
          signal: options.signal,
        });
        stages = setStage(stages, "belief_extraction", "completed");
        stages = setStage(stages, "metric_computation", "running");
        emit();
        record.beliefDynamics = result.artifact;
        record.costs.push(result.cost);
        record.componentStatus.belief =
          result.artifact.normalized.validationErrors &&
          result.artifact.normalized.validationErrors.length > 0 &&
          result.artifact.normalized.claims.length === 0
            ? "failed"
            : "completed";
        stages = setStage(stages, "metric_computation", "completed");
        if (record.componentStatus.belief === "failed") {
          record.errors.push({
            component: "belief",
            message:
              result.artifact.normalized.validationErrors?.join("; ") ??
              "Belief schema validation failed",
            at: new Date().toISOString(),
            retryable: true,
          });
          stages = setStage(stages, "belief_extraction", "failed");
        }
      } catch (error) {
        record.componentStatus.belief = "failed";
        record.errors.push({
          component: "belief",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
          retryable: true,
        });
        stages = setStage(
          stages,
          "belief_extraction",
          "failed",
          record.errors.at(-1)?.message,
        );
        stages = setStage(stages, "metric_computation", "failed");
      }
    }
    emit();

    stages = setStage(stages, "saving", "running");
    emit();
    record.finishedAt = new Date().toISOString();
    const anyCompleted =
      record.componentStatus.marble === "completed" ||
      record.componentStatus.belief === "completed";
    const anyFailed =
      record.componentStatus.marble === "failed" ||
      record.componentStatus.belief === "failed";
    record.status = anyCompleted ? "completed" : anyFailed ? "failed" : "failed";
    stages = setStage(stages, "saving", "completed");
    record.stages = stages;
    emit();
    return record;
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    record.errors.push({
      component: "belief",
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
      retryable: true,
    });
    record.stages = stages;
    emit();
    return record;
  }
}
