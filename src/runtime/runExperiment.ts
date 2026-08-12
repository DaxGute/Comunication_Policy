import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import type { CommunicationPolicy } from "../communication/types";
import { evaluateRun } from "../evaluation/evaluateRun";
import { syncRunCostFields } from "../experiment/runCost";
import type {
  ExperimentRun,
  ProblemConversation,
  RunConfig,
  RunProgress,
} from "../experiment/types";
import { createId } from "../lib/id";
import { emptyUsage } from "../models/usage";
import { selectProblems } from "../problems/registry";
import type { AgentId } from "../agents/types";
import type { ConversationMessage } from "../experiment/types";
import { isAbortError, throwIfAborted } from "./abort";
import { createModelClient } from "./modelClient";
import { runProblem } from "./runProblem";

export type RunExperimentCallbacks = {
  onRunCreated?: (run: ExperimentRun) => void;
  onConversationMessage?: (
    runId: string,
    problemId: string,
    message: ConversationMessage,
  ) => void;
  onSpeaking?: (agentId: AgentId | undefined) => void;
  onProgress?: (progress: RunProgress) => void;
  onProblemComplete?: (
    runId: string,
    conversation: ExperimentRun["conversations"][number],
  ) => void;
  onRunComplete?: (run: ExperimentRun) => void;
  onRunFailed?: (run: ExperimentRun, error: unknown) => void;
  onRunCancelled?: (run: ExperimentRun) => void;
};

function reportProgress(
  callbacks: RunExperimentCallbacks | undefined,
  completedProblems: number,
  totalProblems: number,
  inFlightTurnSum = 0,
) {
  const total = Math.max(1, totalProblems);
  const fraction = Math.min(1, (completedProblems + inFlightTurnSum) / total);
  callbacks?.onProgress?.({
    fraction,
    completedProblems,
    totalProblems: total,
  });
}

function isCancelledConversation(conversation: ProblemConversation): boolean {
  return conversation.stoppedReason === "cancelled";
}

function attachRunUsageTotals(run: ExperimentRun): void {
  syncRunCostFields(run);
}

/**
 * Snapshots policy + prompts + config, then executes every problem in parallel.
 */
export async function runExperiment(args: {
  policy: CommunicationPolicy;
  config: RunConfig;
  signal?: AbortSignal;
  callbacks?: RunExperimentCallbacks;
}): Promise<ExperimentRun> {
  const { policy, config, signal, callbacks } = args;

  const policySnapshot: CommunicationPolicy = {
    trustA: policy.trustA,
    trustB: policy.trustB,
    authority: policy.authority,
    familiarity: policy.familiarity,
  };

  const run: ExperimentRun = {
    id: createId("run"),
    createdAt: new Date().toISOString(),
    policy: policySnapshot,
    agentPrompts: buildAgentPromptPair(
      policySnapshot,
      config.problemCategory,
    ),
    config: { ...config },
    conversations: [],
    conversationUsage: emptyUsage(),
    conversationCostUsd: null,
    evaluationUsage: emptyUsage(),
    evaluationCostUsd: null,
    totalCostUsd: null,
    status: "running",
  };

  callbacks?.onRunCreated?.(run);

  const client = createModelClient();
  const problems = selectProblems(config.problemCategory, config.problemCount);
  const totalProblems = problems.length;
  const parallel = totalProblems > 1;
  reportProgress(callbacks, 0, totalProblems);

  let completedProblems = 0;
  const inFlightTurnFraction = new Map<number, number>();
  const conversationsByIndex: Array<ProblemConversation | undefined> =
    Array.from({ length: totalProblems });

  const snapshotConversations = () =>
    conversationsByIndex.filter(
      (c): c is ProblemConversation =>
        !!c &&
        !(c.stoppedReason === "cancelled" && c.messages.length === 0),
    );

  const emitProgress = () => {
    let turnSum = 0;
    for (const value of inFlightTurnFraction.values()) {
      turnSum += value;
    }
    reportProgress(callbacks, completedProblems, totalProblems, turnSum);
  };

  try {
    await Promise.all(
      problems.map(async (problem, index) => {
        throwIfAborted(signal);

        const conversation = await runProblem({
          problem,
          policy: policySnapshot,
          config,
          client,
          signal,
          callbacks: {
            onSpeaking: parallel ? undefined : callbacks?.onSpeaking,
            onMessage: (message) => {
              callbacks?.onConversationMessage?.(run.id, problem.id, message);
            },
            onTurnProgress: (turnIndex, maxTurns) => {
              const turnFraction =
                maxTurns > 0
                  ? Math.min(1, Math.max(0, (turnIndex - 1) / maxTurns))
                  : 0;
              inFlightTurnFraction.set(index, turnFraction);
              emitProgress();
            },
          },
        });

        conversationsByIndex[index] = conversation;
        run.conversations = snapshotConversations();
        attachRunUsageTotals(run);
        inFlightTurnFraction.delete(index);
        completedProblems += 1;
        emitProgress();

        if (
          !(
            conversation.stoppedReason === "cancelled" &&
            conversation.messages.length === 0
          )
        ) {
          callbacks?.onProblemComplete?.(run.id, conversation);
        }

        return conversation;
      }),
    );

    run.conversations = snapshotConversations();
    attachRunUsageTotals(run);

    const cancelled =
      signal?.aborted ||
      conversationsByIndex.some(
        (c) => c !== undefined && isCancelledConversation(c),
      );
    if (cancelled) {
      run.evaluation =
        run.conversations.length > 0 ? evaluateRun(run) : undefined;
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.error = "Cancelled";
      callbacks?.onRunCancelled?.(run);
      return run;
    }

    run.evaluation = evaluateRun(run);
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    callbacks?.onProgress?.({
      fraction: 1,
      completedProblems: totalProblems,
      totalProblems,
    });
    callbacks?.onRunComplete?.(run);
    return run;
  } catch (error) {
    run.conversations = snapshotConversations();
    attachRunUsageTotals(run);
    if (isAbortError(error)) {
      run.evaluation =
        run.conversations.length > 0 ? evaluateRun(run) : undefined;
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.error = "Cancelled";
      callbacks?.onRunCancelled?.(run);
      return run;
    }

    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : String(error);
    callbacks?.onRunFailed?.(run, error);
    return run;
  }
}
