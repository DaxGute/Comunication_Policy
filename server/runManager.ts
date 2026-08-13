import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt.ts";
import { createCommunicationPolicy } from "../src/communication/policy.ts";
import type { CommunicationPolicy } from "../src/communication/types.ts";
import { runMultiAgentEvaluation } from "../src/evaluation/orchestrator.ts";
import type { MultiAgentEvaluation } from "../src/evaluation/types.ts";
import { syncRunCostFields } from "../src/experiment/runCost.ts";
import type {
  ConversationMessage,
  ExperimentRun,
  ProblemConversation,
  RunConfig,
  RunProgress,
} from "../src/experiment/types.ts";
import { createId } from "../src/lib/id.ts";
import { emptyUsage } from "../src/models/usage.ts";
import type { ReasoningEffort } from "../src/models/modelRegistry.ts";
import {
  createModelClient,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../src/runtime/modelClient.ts";
import { runExperiment } from "../src/runtime/runExperiment.ts";
import { isAbortError } from "../src/runtime/abort.ts";
import {
  generateWithOpenAI,
  GenerateApiHttpError,
} from "./generateApi.ts";
import { runPosthoc } from "./marbleEvaluateApi.ts";
import { RunPersistence } from "./runPersistence.ts";

type ActiveRun = {
  abort: AbortController;
  promise: Promise<void>;
};

type ActiveEvaluation = {
  abort: AbortController;
  promise: Promise<void>;
  runId: string;
  problemId?: string;
  batch: boolean;
};

/**
 * Server-authoritative run + evaluation manager.
 * Browser reload has no effect; only explicit cancel or process death stops work.
 */
export class RunManager {
  private readonly persistence: RunPersistence;
  private readonly getApiKey: () => string | undefined;
  /** Live run objects for in-flight work (same refs the runtime mutates). */
  private readonly live = new Map<string, ExperimentRun>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly activeEvals = new Map<string, ActiveEvaluation>();
  /**
   * Tombstones for explicitly deleted runs. Late cancel/complete callbacks must
   * not resurrect them into `live` or `.data/runs.json`.
   */
  private readonly deletedIds = new Set<string>();
  private reconciled = false;

  constructor(
    getApiKey: () => string | undefined,
    persistence: RunPersistence = new RunPersistence(),
  ) {
    this.getApiKey = getApiKey;
    this.persistence = persistence;
  }

  /** On process start: fail any persisted "running"/"queued" with no live handle. */
  reconcileAfterRestart(): void {
    if (this.reconciled) return;
    this.reconciled = true;
    for (const run of this.persistence.list()) {
      if (run.status !== "running" && run.status !== "queued") continue;
      if (this.activeRuns.has(run.id)) continue;
      this.persistence.update(run.id, (r) => {
        r.status = "failed";
        r.error = r.error ?? "Interrupted (server restart)";
        r.finishedAt = r.finishedAt ?? new Date().toISOString();
        r.progress = undefined;
        for (const c of r.conversations) {
          if (c.status === "running") {
            c.status = undefined;
            c.speakingAgentId = undefined;
            c.stoppedReason = "error";
            c.error = c.error ?? "Interrupted (server restart)";
          }
        }
        for (const e of r.multiAgentEvaluations ?? []) {
          if (e.status === "running") {
            e.status = "failed";
            e.finishedAt = e.finishedAt ?? new Date().toISOString();
            e.errors.push({
              component: "belief",
              message: "Interrupted (server restart)",
              at: new Date().toISOString(),
              retryable: true,
            });
          }
        }
        syncRunCostFields(r);
      });
    }
  }

  listRuns(): ExperimentRun[] {
    this.reconcileAfterRestart();
    const byId = new Map(
      this.persistence.list().map((r) => [r.id, r] as const),
    );
    for (const [id, live] of this.live) {
      if (this.deletedIds.has(id)) continue;
      byId.set(id, live);
    }
    for (const id of this.deletedIds) {
      byId.delete(id);
    }
    return [...byId.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  getRun(runId: string): ExperimentRun | undefined {
    this.reconcileAfterRestart();
    if (this.deletedIds.has(runId)) return undefined;
    return this.live.get(runId) ?? this.persistence.get(runId);
  }

  createRun(args: {
    policy: CommunicationPolicy;
    config: RunConfig;
  }): ExperimentRun {
    this.reconcileAfterRestart();
    const policy = createCommunicationPolicy(args.policy);
    const config: RunConfig = { ...args.config };
    const runId = createId("run");
    const createdAt = new Date().toISOString();
    const placeholder: ExperimentRun = {
      id: runId,
      createdAt,
      status: "queued",
      policy,
      agentPrompts: buildAgentPromptPair(policy),
      config,
      conversations: [],
      conversationUsage: emptyUsage(),
      conversationCostUsd: null,
      evaluationUsage: emptyUsage(),
      evaluationCostUsd: null,
      totalCostUsd: null,
      progress: {
        fraction: 0,
        completedProblems: 0,
        totalProblems: Math.max(1, config.problemCount),
      },
    };

    this.live.set(runId, placeholder);
    this.persistLive(runId);

    const abort = new AbortController();
    const promise = this.executeRun(runId, policy, config, abort.signal);
    this.activeRuns.set(runId, { abort, promise });
    void promise.finally(() => {
      this.activeRuns.delete(runId);
      // Keep live until read once more is unnecessary — drop after terminal persist.
      const run = this.live.get(runId);
      if (run && run.status !== "queued" && run.status !== "running") {
        this.live.delete(runId);
      }
    });

    return structuredClone(placeholder) as ExperimentRun;
  }

  cancelRun(runId: string): ExperimentRun | undefined {
    const active = this.activeRuns.get(runId);
    if (active) {
      active.abort.abort();
    }
    // Also cancel any evaluations for this run.
    for (const [evalId, job] of this.activeEvals) {
      if (job.runId === runId) {
        job.abort.abort();
        this.activeEvals.delete(evalId);
      }
    }
    // Clear live progress immediately so the UI drops the medallion while
    // in-flight model calls unwind to a cancelled terminal state.
    this.mutate(runId, (run) => {
      if (run.status === "queued" || run.status === "running") {
        run.progress = undefined;
      }
    });
    return this.getRun(runId);
  }

  deleteRun(runId: string): boolean {
    // Tombstone first so in-flight cancel/complete callbacks cannot re-save.
    this.deletedIds.add(runId);

    const active = this.activeRuns.get(runId);
    if (active) {
      active.abort.abort();
      this.activeRuns.delete(runId);
    }
    for (const [evalId, job] of this.activeEvals) {
      if (job.runId === runId) {
        job.abort.abort();
        this.activeEvals.delete(evalId);
      }
    }

    this.live.delete(runId);
    return this.persistence.delete(runId);
  }

  renameRun(runId: string, title: string): ExperimentRun | undefined {
    const next = title.trim();
    if (!next) return this.getRun(runId);
    return this.mutate(runId, (run) => {
      run.title = next;
    });
  }

  renameProblem(
    runId: string,
    problemId: string,
    title: string,
  ): ExperimentRun | undefined {
    const next = title.trim();
    if (!next) return this.getRun(runId);
    return this.mutate(runId, (run) => {
      for (const c of run.conversations) {
        if (c.problemId === problemId) c.problemTitle = next;
      }
      if (run.evaluation) {
        run.evaluation = {
          ...run.evaluation,
          problems: run.evaluation.problems.map((p) =>
            p.problemId === problemId ? { ...p, problemTitle: next } : p,
          ),
        };
      }
      if (run.multiAgentEvaluations) {
        run.multiAgentEvaluations = run.multiAgentEvaluations.map((e) =>
          e.problemId === problemId
            ? {
                ...e,
                metadata: { ...e.metadata, problemTitle: next },
              }
            : e,
        );
      }
    });
  }

  importRuns(runs: ExperimentRun[]): { imported: number } {
    this.reconcileAfterRestart();
    const sanitized = runs.map((run) => {
      const clone = structuredClone(run) as ExperimentRun;
      if (clone.status === "running" || clone.status === "queued") {
        clone.status = "failed";
        clone.error =
          clone.error ?? "Imported inactive run (was in-flight in browser)";
        clone.finishedAt = clone.finishedAt ?? new Date().toISOString();
      }
      for (const c of clone.conversations) {
        if (c.status === "running") {
          c.status = undefined;
          c.speakingAgentId = undefined;
        }
      }
      syncRunCostFields(clone);
      return clone;
    });
    this.persistence.importMany(sanitized);
    return { imported: sanitized.length };
  }

  startEvaluation(args: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    retryFromId?: string;
  }): { evaluationId: string; run: ExperimentRun } {
    const run = this.requireRun(args.runId);
    const conversation = run.conversations.find(
      (c) => c.problemId === args.problemId,
    );
    if (!conversation) {
      throw new RunsApiError(404, `Problem "${args.problemId}" not found.`);
    }

    const retryFrom = args.retryFromId
      ? run.multiAgentEvaluations?.find((e) => e.id === args.retryFromId)
      : undefined;

    const evaluationId =
      retryFrom?.id ??
      `mae_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

    // Cancel prior eval for same problem (not other problems).
    for (const [id, job] of this.activeEvals) {
      if (
        job.runId === args.runId &&
        job.problemId === args.problemId &&
        !job.batch
      ) {
        job.abort.abort();
        this.activeEvals.delete(id);
      }
    }

    const abort = new AbortController();
    const promise = this.executeEvaluation({
      runId: args.runId,
      problemId: args.problemId,
      evaluatorModel: args.evaluatorModel,
      evaluationReasoningEffort: args.evaluationReasoningEffort,
      retryFrom,
      signal: abort.signal,
      evaluationId,
    });
    this.activeEvals.set(evaluationId, {
      abort,
      promise,
      runId: args.runId,
      problemId: args.problemId,
      batch: false,
    });
    void promise.finally(() => {
      this.activeEvals.delete(evaluationId);
    });

    return {
      evaluationId,
      run: structuredClone(this.requireRun(args.runId)) as ExperimentRun,
    };
  }

  startBatchEvaluation(args: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
  }): { batchId: string; run: ExperimentRun } {
    const run = this.requireRun(args.runId);
    if (run.conversations.length === 0) {
      throw new RunsApiError(400, "Run has no conversations to evaluate.");
    }

    for (const [id, job] of this.activeEvals) {
      if (job.runId === args.runId && job.batch) {
        job.abort.abort();
        this.activeEvals.delete(id);
      }
    }

    const batchId = createId("evalbatch");
    const abort = new AbortController();
    const promise = this.executeBatchEvaluation({
      runId: args.runId,
      evaluatorModel: args.evaluatorModel,
      evaluationReasoningEffort: args.evaluationReasoningEffort,
      signal: abort.signal,
    });
    this.activeEvals.set(batchId, {
      abort,
      promise,
      runId: args.runId,
      batch: true,
    });
    void promise.finally(() => {
      this.activeEvals.delete(batchId);
    });

    return {
      batchId,
      run: structuredClone(run) as ExperimentRun,
    };
  }

  cancelEvaluation(runId: string, evaluationId?: string): void {
    for (const [id, job] of this.activeEvals) {
      if (job.runId !== runId) continue;
      if (evaluationId && id !== evaluationId) continue;
      job.abort.abort();
      this.activeEvals.delete(id);
    }
  }

  private createServerModelClient(): ModelClient {
    return createModelClient({
      directOpenAIGenerate: async (input: ModelRequest): Promise<ModelResponse> => {
        try {
          const result = await generateWithOpenAI(
            {
              model: input.model,
              temperature: input.temperature,
              messages: input.messages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              ...(input.reasoningEffort
                ? { reasoningEffort: input.reasoningEffort }
                : {}),
            },
            this.getApiKey(),
            input.signal,
          );
          return {
            content: result.content,
            provider: "openai",
            durationMs: result.durationMs,
            usage: result.usage
              ? {
                  inputTokens: result.usage.inputTokens,
                  promptTokens: result.usage.promptTokens,
                  cachedInputTokens: result.usage.cachedInputTokens,
                  outputTokens: result.usage.outputTokens,
                  completionTokens: result.usage.completionTokens,
                  totalTokens: result.usage.totalTokens,
                }
              : undefined,
          };
        } catch (error) {
          if (error instanceof GenerateApiHttpError) {
            throw new Error(error.message);
          }
          throw error;
        }
      },
    });
  }

  private invokeMarble = async (
    request: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    if (signal?.aborted) {
      throw new Error("Evaluation cancelled.");
    }
    const result = await runPosthoc(request, this.getApiKey());
    if (!result.ok) {
      const message =
        typeof result.body.error === "string"
          ? result.body.error
          : "MARBLE evaluation failed.";
      throw new Error(message);
    }
    return result.body;
  };

  private async executeRun(
    runId: string,
    policy: CommunicationPolicy,
    config: RunConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const client = this.createServerModelClient();
    try {
      await runExperiment({
        policy,
        config,
        signal,
        client,
        runId,
        callbacks: {
          onRunCreated: (run) => {
            // Replace queued placeholder with the runtime-owned object.
            if (this.deletedIds.has(runId)) return;
            this.live.set(runId, run);
            this.persistLive(runId);
          },
          onProgress: (progress: RunProgress) => {
            this.mutate(runId, (run) => {
              run.progress = progress;
              if (run.status === "queued") {
                run.status = "running";
                run.startedAt = run.startedAt ?? new Date().toISOString();
              }
            });
          },
          onConversationMessage: (_id, problemId, message) => {
            this.mutate(runId, (run) => {
              this.appendMessage(run, problemId, message);
            });
          },
          onSpeaking: (agentId, problemId) => {
            this.mutate(runId, (run) => {
              const conv = run.conversations.find(
                (c) => c.problemId === problemId,
              );
              if (conv) {
                conv.speakingAgentId = agentId;
                conv.status = "running";
              }
            });
          },
          onProblemComplete: (_id, conversation) => {
            this.mutate(runId, (run) => {
              this.replaceConversation(run, conversation);
              syncRunCostFields(run);
            });
          },
          onRunComplete: (run) => {
            if (this.deletedIds.has(runId)) return;
            run.progress = undefined;
            this.live.set(runId, run);
            this.persistLive(runId);
          },
          onRunFailed: (run) => {
            if (this.deletedIds.has(runId)) return;
            run.progress = undefined;
            this.live.set(runId, run);
            this.persistLive(runId);
          },
          onRunCancelled: (run) => {
            if (this.deletedIds.has(runId)) return;
            run.progress = undefined;
            this.live.set(runId, run);
            this.persistLive(runId);
          },
        },
      });
    } catch (error) {
      this.mutate(runId, (run) => {
        if (run.status !== "running" && run.status !== "queued") return;
        const cancelled = isAbortError(error) || signal.aborted;
        run.status = cancelled ? "cancelled" : "failed";
        run.error = cancelled
          ? "Cancelled"
          : error instanceof Error
            ? error.message
            : String(error);
        run.finishedAt = new Date().toISOString();
        run.progress = undefined;
        for (const c of run.conversations) {
          if (c.status === "running") {
            c.status = undefined;
            c.speakingAgentId = undefined;
            if (cancelled && c.stoppedReason !== "error") {
              c.stoppedReason = "cancelled";
            }
          }
        }
      });
    }
  }

  private async executeEvaluation(args: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    retryFrom?: MultiAgentEvaluation;
    signal: AbortSignal;
    evaluationId: string;
  }): Promise<void> {
    const run = this.requireRun(args.runId);
    const conversation = run.conversations.find(
      (c) => c.problemId === args.problemId,
    );
    if (!conversation) return;

    const client = this.createServerModelClient();
    const evaluation = await runMultiAgentEvaluation({
      run,
      conversation,
      evaluatorModel: args.evaluatorModel,
      reasoningEffort: args.evaluationReasoningEffort,
      retryFrom: args.retryFrom,
      signal: args.signal,
      client,
      invokeMarble: this.invokeMarble,
      onProgress: (progress) => {
        this.upsertEvaluation(args.runId, progress.evaluation);
      },
    });
    this.upsertEvaluation(args.runId, evaluation);
  }

  private async executeBatchEvaluation(args: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    signal: AbortSignal;
  }): Promise<void> {
    const run = this.requireRun(args.runId);
    const problemIds = run.conversations.map((c) => c.problemId);
    for (const problemId of problemIds) {
      if (args.signal.aborted) break;
      const latest = this.requireRun(args.runId);
      const conversation = latest.conversations.find(
        (c) => c.problemId === problemId,
      );
      if (!conversation) continue;
      const client = this.createServerModelClient();
      const evaluation = await runMultiAgentEvaluation({
        run: latest,
        conversation,
        evaluatorModel: args.evaluatorModel,
        reasoningEffort: args.evaluationReasoningEffort,
        signal: args.signal,
        client,
        invokeMarble: this.invokeMarble,
        onProgress: (progress) => {
          this.upsertEvaluation(args.runId, progress.evaluation);
        },
      });
      this.upsertEvaluation(args.runId, evaluation);
    }
  }

  private upsertEvaluation(
    runId: string,
    evaluation: MultiAgentEvaluation,
  ): void {
    this.mutate(runId, (run) => {
      const existing = run.multiAgentEvaluations ?? [];
      const without = existing.filter((e) => e.id !== evaluation.id);
      run.multiAgentEvaluations = [...without, evaluation];
      syncRunCostFields(run);
    });
  }

  private appendMessage(
    run: ExperimentRun,
    problemId: string,
    message: ConversationMessage,
  ): void {
    const existing = run.conversations.find((c) => c.problemId === problemId);
    if (!existing) {
      run.conversations.push({
        problemId,
        problemTitle: problemId,
        problemText: "",
        messages: [message],
        stoppedReason: "max_turns",
        status: "running",
      });
      return;
    }
    // Avoid duplicate appends if a persist race re-delivers.
    if (existing.messages.some((m) => m.id === message.id)) return;
    existing.messages = [...existing.messages, message];
    existing.status = "running";
  }

  private replaceConversation(
    run: ExperimentRun,
    conversation: ProblemConversation,
  ): void {
    const completed: ProblemConversation = {
      ...conversation,
      status: undefined,
      speakingAgentId: undefined,
    };
    const index = run.conversations.findIndex(
      (c) => c.problemId === conversation.problemId,
    );
    if (index >= 0) {
      const prev = run.conversations[index]!;
      // Prefer longer transcript if finalize races with live appends.
      if (prev.messages.length > completed.messages.length) {
        completed.messages = prev.messages;
      }
      if (
        prev.problemTitle &&
        prev.problemTitle !== conversation.problemId &&
        prev.problemTitle !== conversation.problemTitle
      ) {
        completed.problemTitle = prev.problemTitle;
      }
      run.conversations[index] = completed;
    } else {
      run.conversations.push(completed);
    }
  }

  private requireRun(runId: string): ExperimentRun {
    const run = this.getRun(runId);
    if (!run) throw new RunsApiError(404, `Run "${runId}" not found.`);
    // Ensure subsequent mutates hit a live object.
    if (!this.live.has(runId)) {
      this.live.set(runId, structuredClone(run) as ExperimentRun);
    }
    return this.live.get(runId)!;
  }

  private mutate(
    runId: string,
    mutator: (run: ExperimentRun) => void,
  ): ExperimentRun | undefined {
    if (this.deletedIds.has(runId)) return undefined;
    const run = this.live.get(runId) ?? this.persistence.get(runId);
    if (!run) return undefined;
    if (!this.live.has(runId)) {
      this.live.set(runId, run);
    }
    const live = this.live.get(runId)!;
    mutator(live);
    this.persistLive(runId);
    return structuredClone(live) as ExperimentRun;
  }

  private persistLive(runId: string): void {
    if (this.deletedIds.has(runId)) {
      this.live.delete(runId);
      return;
    }
    const run = this.live.get(runId);
    if (!run) return;
    this.persistence.save(run);
  }
}

export class RunsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let singleton: RunManager | undefined;

export function getRunManager(
  getApiKey: () => string | undefined,
): RunManager {
  if (!singleton) {
    singleton = new RunManager(getApiKey);
    singleton.reconcileAfterRestart();
  }
  return singleton;
}
