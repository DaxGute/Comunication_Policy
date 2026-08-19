/**
 * Coordinates post-hoc multi-agent evaluation.
 *
 * Every task type uses MARBLE + the universal interaction evaluator.
 * Belief/moral records on retryFrom are preserved for legacy loads; they are
 * not recomputed. Task graders (crossword/moral/proof) live in evaluateRun.
 */
import { resolveRunModel } from "../experiment/configAccessors";
import type { ExperimentRun, ProblemConversation } from "../experiment/types";
import { calculateModelCost } from "../models/cost";
import type { ReasoningEffort } from "../models/modelRegistry";
import { emptyUsage, normalizeUsage, sumUsage } from "../models/usage";
import { getProblemById } from "../problems/registry";
import { evaluateMarblePosthoc } from "./marble/evaluator";
import { deriveCrossSourcePatterns } from "./interaction/patterns";
import { evaluateConversation } from "./posthoc/evaluateConversation";
import {
  postHocProfileFor,
  profileIncludes,
  type PostHocProfile,
} from "./posthoc/registry";
import type {
  EvaluationStageState,
  MultiAgentEvaluation,
} from "./types";
import {
  BELIEF_GRADER_SCHEMA_VERSION,
  BELIEF_GRADER_VERSION,
  EVALUATION_SCHEMA_VERSION,
  INTERACTION_EVALUATOR_VERSION,
  INTERACTION_SCHEMA_VERSION,
  MARBLE_ADAPTER_VERSION,
  MARBLE_COMMIT,
  MARBLE_VERSION,
  MORAL_DYNAMICS_SCHEMA_VERSION,
  MORAL_DYNAMICS_VERSION,
  MORAL_JUDGE_VERSION,
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
  reasoningEffort?: ReasoningEffort;
  /** Retry only failed components from a previous evaluation. */
  retryFrom?: MultiAgentEvaluation;
  signal?: AbortSignal;
  onProgress?: (progress: OrchestratorProgress) => void;
  /** Injected model client (server direct OpenAI). */
  client?: import("../runtime/modelClient").ModelClient;
  /** Injected MARBLE invoker (server Python bridge). */
  invokeMarble?: (
    request: unknown,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>;
};

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function initialStages(profile: PostHocProfile): EvaluationStageState[] {
  const stages: EvaluationStageState[] = [
    { id: "preparing", label: "Preparing conversation", status: "pending" },
  ];
  if (profileIncludes(profile, "marble")) {
    stages.push({ id: "marble", label: "MARBLE evaluation", status: "pending" });
  }
  if (profileIncludes(profile, "interaction")) {
    stages.push({
      id: "interaction",
      label: "Interaction dynamics",
      status: "pending",
    });
  }
  stages.push({ id: "saving", label: "Saving", status: "pending" });
  return stages;
}

function setStage(
  stages: EvaluationStageState[],
  id: EvaluationStageState["id"],
  status: EvaluationStageState["status"],
  detail?: string,
): EvaluationStageState[] {
  if (!stages.some((stage) => stage.id === id)) return stages;
  return stages.map((stage) =>
    stage.id === id ? { ...stage, status, detail } : stage,
  );
}

function finalizeEvaluationUsage(record: MultiAgentEvaluation): void {
  const usage = sumUsage(
    record.costs.map((c) =>
      normalizeUsage({
        inputTokens: c.inputTokens,
        cachedInputTokens: c.cachedInputTokens,
        outputTokens: c.outputTokens,
        totalTokens: c.totalTokens,
      }),
    ),
  );
  const hasTokens = record.costs.some(
    (c) =>
      typeof c.inputTokens === "number" ||
      typeof c.outputTokens === "number" ||
      typeof c.totalTokens === "number",
  );
  record.usage = hasTokens ? usage : emptyUsage();

  let pricedTotal: number | null = null;
  for (const cost of record.costs) {
    let callCost =
      typeof cost.estimatedCostUsd === "number"
        ? cost.estimatedCostUsd
        : null;
    if (
      callCost === null &&
      (typeof cost.inputTokens === "number" ||
        typeof cost.outputTokens === "number" ||
        typeof cost.totalTokens === "number")
    ) {
      const callUsage =
        normalizeUsage({
          inputTokens: cost.inputTokens,
          cachedInputTokens: cost.cachedInputTokens,
          outputTokens: cost.outputTokens,
          totalTokens: cost.totalTokens,
        }) ?? emptyUsage();
      callCost = calculateModelCost(cost.model, callUsage);
      if (typeof callCost === "number") {
        cost.estimatedCostUsd = callCost;
      }
    }
    if (typeof callCost === "number") {
      pricedTotal = (pricedTotal ?? 0) + callCost;
    }
  }
  record.costUsd = pricedTotal;
}

function priceCost(cost: MultiAgentEvaluation["costs"][number]): void {
  if (
    cost.estimatedCostUsd == null &&
    (typeof cost.inputTokens === "number" ||
      typeof cost.outputTokens === "number")
  ) {
    cost.estimatedCostUsd = calculateModelCost(
      cost.model,
      normalizeUsage({
        inputTokens: cost.inputTokens,
        cachedInputTokens: cost.cachedInputTokens,
        outputTokens: cost.outputTokens,
        totalTokens: cost.totalTokens,
      }) ?? emptyUsage(),
    );
  }
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
  const reasoningEffort =
    options.reasoningEffort ??
    options.retryFrom?.reasoningEffort ??
    run.config.evaluationReasoningEffort;
  const evaluationId = options.retryFrom?.id ?? newId("mae");
  const profile = postHocProfileFor(run.config.problemCategory);
  const wantsMarble = profileIncludes(profile, "marble");
  const wantsInteraction = profileIncludes(profile, "interaction");
  let stages = initialStages(profile);

  const conversationId = `${run.id}:${conversation.problemId}`;
  const priorTask = run.evaluation?.problems.find(
    (p) => p.problemId === conversation.problemId,
  );
  const problem = getProblemById(
    run.config.problemCategory,
    conversation.problemId,
  );
  const agentModel = resolveRunModel(run.config);

  const record: MultiAgentEvaluation = {
    id: evaluationId,
    conversationId,
    problemId: conversation.problemId,
    runId: run.id,
    createdAt: options.retryFrom?.createdAt ?? new Date().toISOString(),
    evaluatorModel,
    reasoningEffort,
    status: "running",
    stages,
    componentStatus: {
      marble: wantsMarble ? "pending" : "skipped",
      belief: "skipped",
      moralDynamics: "skipped",
      interaction: wantsInteraction ? "pending" : "skipped",
    },
    errors: [],
    costs: options.retryFrom ? [...options.retryFrom.costs] : [],
    metadata: {
      agentAModel: agentModel,
      agentBModel: agentModel,
      trust: (run.policy.trustA + run.policy.trustB) / 2,
      trustA: run.policy.trustA,
      trustB: run.policy.trustB,
      authority: run.policy.authority,
      familiarity: run.policy.familiarity,
      evaluatorModel,
      evaluationReasoningEffort: reasoningEffort,
      marbleVersion: MARBLE_VERSION,
      marbleCommit: MARBLE_COMMIT,
      marbleAdapterVersion: MARBLE_ADAPTER_VERSION,
      evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION,
      beliefGraderVersion: BELIEF_GRADER_VERSION,
      beliefGraderSchemaVersion: BELIEF_GRADER_SCHEMA_VERSION,
      moralDynamicsVersion: MORAL_DYNAMICS_VERSION,
      moralDynamicsSchemaVersion: MORAL_DYNAMICS_SCHEMA_VERSION,
      moralJudgeVersion: MORAL_JUDGE_VERSION,
      interactionEvaluatorVersion: INTERACTION_EVALUATOR_VERSION,
      interactionSchemaVersion: INTERACTION_SCHEMA_VERSION,
      postHocComponents: [...profile.components],
      problemSet: run.config.problemCategory,
      problemId: conversation.problemId,
      problemTitle: conversation.problemTitle,
      runId: run.id,
      conversationId,
    },
    marble: options.retryFrom?.marble,
    beliefDynamics: options.retryFrom?.beliefDynamics,
    moralDynamics: options.retryFrom?.moralDynamics,
    interaction: options.retryFrom?.interaction,
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
    !wantsMarble ||
    (options.retryFrom?.componentStatus.marble === "completed" &&
      Boolean(options.retryFrom.marble));
  const skipInteraction =
    !wantsInteraction ||
    (options.retryFrom?.componentStatus.interaction === "completed" &&
      Boolean(options.retryFrom.interaction));

  try {
    stages = setStage(stages, "preparing", "running");
    emit();
    void conversation.messages.length;
    stages = setStage(stages, "preparing", "completed");
    emit();

    if (!wantsMarble) {
      stages = setStage(stages, "marble", "skipped");
      record.componentStatus.marble = "skipped";
    } else if (skipMarble) {
      stages = setStage(stages, "marble", "skipped", "Reused prior result");
      record.componentStatus.marble = "completed";
    } else {
      stages = setStage(stages, "marble", "running");
    }

    if (!wantsInteraction) {
      record.componentStatus.interaction = "skipped";
    } else if (skipInteraction) {
      stages = setStage(
        stages,
        "interaction",
        "skipped",
        "Reused prior result",
      );
      record.componentStatus.interaction = "completed";
    } else {
      stages = setStage(stages, "interaction", "running");
    }
    emit();

    const marbleTask = skipMarble
      ? Promise.resolve()
      : (async () => {
          try {
            const result = await evaluateMarblePosthoc({
              run,
              conversation,
              evaluatorModel,
              signal: options.signal,
              invoke: options.invokeMarble,
            });
            priceCost(result.cost);
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
        })();

    const interactionTask = skipInteraction
      ? Promise.resolve()
      : (async () => {
          try {
            const result = await evaluateConversation({
              problemType: run.config.problemCategory,
              conversation,
              run,
              problem,
              priorTaskLabel: priorTask?.label,
              priorTaskNotes: priorTask?.notes,
              evaluatorModel,
              reasoningEffort,
              client: options.client,
              signal: options.signal,
            });
            if (result.interaction) {
              priceCost(result.interaction.cost);
              record.interaction = result.interaction.artifact;
              record.costs.push(result.interaction.cost);
              record.componentStatus.interaction = "completed";
              stages = setStage(stages, "interaction", "completed");
            }
          } catch (error) {
            record.componentStatus.interaction = "failed";
            stages = setStage(
              stages,
              "interaction",
              "failed",
              error instanceof Error ? error.message : String(error),
            );
            record.errors.push({
              component: "interaction",
              message: error instanceof Error ? error.message : String(error),
              at: new Date().toISOString(),
              retryable: true,
            });
          }
        })();

    await Promise.all([marbleTask, interactionTask]);

    if (record.interaction?.normalized) {
      record.interaction.normalized.patterns = deriveCrossSourcePatterns(
        record.interaction.normalized,
        record.marble?.normalized,
      );
    }
    emit();

    stages = setStage(stages, "saving", "running");
    emit();
    record.finishedAt = new Date().toISOString();
    finalizeEvaluationUsage(record);
    const anyCompleted =
      record.componentStatus.marble === "completed" ||
      record.componentStatus.interaction === "completed";
    const anyFailed =
      record.componentStatus.marble === "failed" ||
      record.componentStatus.interaction === "failed";
    record.status = anyCompleted ? "completed" : anyFailed ? "failed" : "failed";
    stages = setStage(stages, "saving", "completed");
    record.stages = stages;
    emit();
    return record;
  } catch (error) {
    record.status = "failed";
    record.finishedAt = new Date().toISOString();
    finalizeEvaluationUsage(record);
    record.errors.push({
      component: "interaction",
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
      retryable: true,
    });
    record.stages = stages;
    emit();
    return record;
  }
}
