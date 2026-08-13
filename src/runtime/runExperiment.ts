import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import type { CommunicationPolicy } from "../communication/types";
import { evaluateRun } from "../evaluation/evaluateRun";
import { syncRunCostFields } from "../experiment/runCost";
import { FULL_HISTORY_TRANSCRIPT_PROTOCOL } from "../experiment/transcriptProtocol";
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
import { createModelClient, type ModelClient } from "./modelClient";
import { runProblem } from "./runProblem";

export type RunExperimentCallbacks = {
  onRunCreated?: (run: ExperimentRun) => void;
  onConversationMessage?: (
    runId: string,
    problemId: string,
    message: ConversationMessage,
  ) => void;
  /** Per-problem speaking updates (safe under parallel execution). */
  onSpeaking?: (agentId: AgentId | undefined, problemId: string) => void;
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
): RunProgress {
  const total = Math.max(1, totalProblems);
  const fraction = Math.min(1, (completedProblems + inFlightTurnSum) / total);
  const progress: RunProgress = {
    fraction,
    completedProblems,
    totalProblems: total,
  };
  callbacks?.onProgress?.(progress);
  return progress;
}

function isCancelledConversation(conversation: ProblemConversation): boolean {
  return conversation.stoppedReason === "cancelled";
}

function isErrorConversation(conversation: ProblemConversation): boolean {
  return conversation.stoppedReason === "error";
}

function attachRunUsageTotals(run: ExperimentRun): void {
  syncRunCostFields(run);
}

function isEmptyCancelled(conversation: ProblemConversation): boolean {
  return (
    conversation.stoppedReason === "cancelled" &&
    conversation.messages.length === 0
  );
}

/**
 * Snapshots policy + prompts + config, then executes every problem in parallel.
 * Callable from the browser or the server; inject `client` on the server to
 * call OpenAI directly (no HTTP hop through /api/generate).
 */
export async function runExperiment(args: {
  policy: CommunicationPolicy;
  config: RunConfig;
  signal?: AbortSignal;
  callbacks?: RunExperimentCallbacks;
  /** Override model client (server uses a direct OpenAI adapter). */
  client?: ModelClient;
  /** Optional pre-assigned run id (server RunManager). */
  runId?: string;
}): Promise<ExperimentRun> {
  const { policy, config, signal, callbacks } = args;

  const policySnapshot: CommunicationPolicy = {
    trustA: policy.trustA,
    trustB: policy.trustB,
    authority: policy.authority,
    familiarity: policy.familiarity,
  };
  const agentPrompts = buildAgentPromptPair(policySnapshot);

  const client = args.client ?? createModelClient();
  const problems = selectProblems(config.problemCategory, config.problemCount);
  const totalProblems = problems.length;

  // Seed conversations up front in stable problem order so the inspector
  // list/selection does not reshuffle as parallel problems start and finish.
  const seededConversations: ProblemConversation[] = problems.map(
    (problem) => ({
      problemId: problem.id,
      problemTitle: problem.title,
      problemText: problem.text,
      messages: [],
      stoppedReason: "max_turns" as const,
      status: "running" as const,
    }),
  );

  const now = new Date().toISOString();
  const run: ExperimentRun = {
    id: args.runId ?? createId("run"),
    createdAt: now,
    startedAt: now,
    policy: policySnapshot,
    agentPrompts,
    transcriptProtocol: { ...FULL_HISTORY_TRANSCRIPT_PROTOCOL },
    config: { ...config },
    conversations: seededConversations.map((c) => ({ ...c })),
    conversationUsage: emptyUsage(),
    conversationCostUsd: null,
    evaluationUsage: emptyUsage(),
    evaluationCostUsd: null,
    totalCostUsd: null,
    status: "running",
    progress: {
      fraction: 0,
      completedProblems: 0,
      totalProblems,
    },
  };

  callbacks?.onRunCreated?.(run);
  run.progress = reportProgress(callbacks, 0, totalProblems);

  let completedProblems = 0;
  const inFlightTurnFraction = new Map<number, number>();
  const conversationsByIndex: Array<ProblemConversation | undefined> =
    Array.from({ length: totalProblems });

  /** Always keep one entry per problem so failures never erase the run. */
  const snapshotConversations = (): ProblemConversation[] =>
    problems.map((problem, index) => {
      const finished = conversationsByIndex[index];
      if (finished) return finished;
      const seeded = seededConversations[index]!;
      // Preserve live transcript/speaker updates that callbacks already wrote
      // onto `run.conversations` (critical under parallel problems).
      const live = run.conversations.find((c) => c.problemId === problem.id);
      return {
        ...seeded,
        problemId: problem.id,
        status: "running" as const,
        messages: live?.messages?.length ? live.messages : seeded.messages,
        speakingAgentId: live?.speakingAgentId,
        problemTitle: live?.problemTitle ?? seeded.problemTitle,
      };
    });

  const publishConversations = () => {
    run.conversations = snapshotConversations().filter(
      (c) => !isEmptyCancelled(c),
    );
    attachRunUsageTotals(run);
  };

  const emitProgress = () => {
    let turnSum = 0;
    for (const value of inFlightTurnFraction.values()) {
      turnSum += value;
    }
    run.progress = reportProgress(
      callbacks,
      completedProblems,
      totalProblems,
      turnSum,
    );
  };

  try {
    await Promise.all(
      problems.map(async (problem, index) => {
        throwIfAborted(signal);

        const conversation = await runProblem({
          problem,
          policy: policySnapshot,
          agentPrompts,
          config,
          client,
          signal,
          callbacks: {
            onSpeaking: (agentId) => {
              callbacks?.onSpeaking?.(agentId, problem.id);
            },
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
        publishConversations();
        inFlightTurnFraction.delete(index);
        completedProblems += 1;
        emitProgress();

        if (!isEmptyCancelled(conversation)) {
          callbacks?.onProblemComplete?.(run.id, conversation);
        }

        return conversation;
      }),
    );

    publishConversations();

    const visible = run.conversations;
    const cancelled =
      signal?.aborted ||
      conversationsByIndex.some(
        (c) => c !== undefined && isCancelledConversation(c),
      );
    const failedConversation = visible.find(isErrorConversation);

    // Explicit cancel wins even if some problems surfaced as errors while
    // unwinding (e.g. provider abort wrapped as a generic failure).
    if (cancelled) {
      run.evaluation =
        visible.length > 0 ? evaluateRun(run) : undefined;
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.error = "Cancelled";
      callbacks?.onRunCancelled?.(run);
      return run;
    }

    if (failedConversation) {
      run.evaluation =
        visible.some((c) => c.messages.length > 0) ? evaluateRun(run) : undefined;
      run.status = "failed";
      run.finishedAt = new Date().toISOString();
      run.error =
        failedConversation.error ??
        "One or more problems failed during the run.";
      callbacks?.onRunFailed?.(run, new Error(run.error));
      return run;
    }

    run.evaluation = evaluateRun(run);
    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    run.progress = {
      fraction: 1,
      completedProblems: totalProblems,
      totalProblems,
    };
    callbacks?.onProgress?.(run.progress);
    callbacks?.onRunComplete?.(run);
    return run;
  } catch (error) {
    // Finalize any problems that never returned so the inspector does not keep
    // forever-spinning placeholders after a hard failure.
    for (let index = 0; index < totalProblems; index++) {
      if (conversationsByIndex[index]) continue;
      const seeded = seededConversations[index]!;
      conversationsByIndex[index] = {
        ...seeded,
        status: undefined,
        stoppedReason: isAbortError(error) ? "cancelled" : "error",
        error: isAbortError(error)
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error),
      };
    }
    publishConversations();
    if (isAbortError(error)) {
      run.evaluation =
        run.conversations.length > 0 ? evaluateRun(run) : undefined;
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      run.error = "Cancelled";
      callbacks?.onRunCancelled?.(run);
      return run;
    }

    // Unexpected throw: still keep every seeded/partial problem so the run
    // remains visible and inspectable instead of disappearing.
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.error = error instanceof Error ? error.message : String(error);
    if (run.conversations.some((c) => c.messages.length > 0)) {
      run.evaluation = evaluateRun(run);
    }
    callbacks?.onRunFailed?.(run, error);
    return run;
  }
}
