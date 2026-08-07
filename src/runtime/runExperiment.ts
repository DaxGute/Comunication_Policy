import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import type { CommunicationPolicy } from "../communication/types";
import { evaluateRun } from "../evaluation/evaluateRun";
import type {
  ExperimentRun,
  RunConfig,
  RunProgress,
} from "../experiment/types";
import { createId } from "../lib/id";
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
  turnIndex = 0,
  maxTurns = 1,
) {
  const total = Math.max(1, totalProblems);
  const turnFraction =
    maxTurns > 0 ? Math.min(1, Math.max(0, (turnIndex - 1) / maxTurns)) : 0;
  const fraction = Math.min(
    1,
    (completedProblems + turnFraction) / total,
  );
  callbacks?.onProgress?.({
    fraction,
    completedProblems,
    totalProblems: total,
  });
}

/**
 * Snapshots policy + prompts + config, then executes the problem set.
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
    agentPrompts: buildAgentPromptPair(policySnapshot),
    config: { ...config },
    conversations: [],
    status: "running",
  };

  callbacks?.onRunCreated?.(run);

  const client = createModelClient();
  const problems = selectProblems(config.problemCategory, config.problemCount);
  const totalProblems = problems.length;
  reportProgress(callbacks, 0, totalProblems);

  try {
    for (let i = 0; i < problems.length; i++) {
      throwIfAborted(signal);

      const problem = problems[i];
      const conversation = await runProblem({
        problem,
        policy: policySnapshot,
        config,
        client,
        signal,
        callbacks: {
          onSpeaking: callbacks?.onSpeaking,
          onMessage: (message) => {
            callbacks?.onConversationMessage?.(run.id, problem.id, message);
          },
          onTurnProgress: (turnIndex, maxTurns) => {
            reportProgress(callbacks, i, totalProblems, turnIndex, maxTurns);
          },
        },
      });

      if (
        conversation.stoppedReason === "cancelled" &&
        conversation.messages.length === 0
      ) {
        run.evaluation =
          run.conversations.length > 0 ? evaluateRun(run) : undefined;
        run.status = "cancelled";
        run.finishedAt = new Date().toISOString();
        run.error = "Cancelled";
        callbacks?.onRunCancelled?.(run);
        return run;
      }

      run.conversations.push(conversation);
      callbacks?.onProblemComplete?.(run.id, conversation);
      reportProgress(callbacks, i + 1, totalProblems);

      if (conversation.stoppedReason === "cancelled") {
        run.evaluation =
          run.conversations.length > 0 ? evaluateRun(run) : undefined;
        run.status = "cancelled";
        run.finishedAt = new Date().toISOString();
        run.error = "Cancelled";
        callbacks?.onRunCancelled?.(run);
        return run;
      }
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
