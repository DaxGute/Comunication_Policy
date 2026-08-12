import { useEffect, useMemo, useRef, useState } from "react";
import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import type { AgentId } from "../agents/types";
import {
  cancelRun as apiCancelRun,
  createRun as apiCreateRun,
  deleteRun as apiDeleteRun,
  importRuns as apiImportRuns,
  listRuns as apiListRuns,
  renameProblem as apiRenameProblem,
  renameRun as apiRenameRun,
  runNeedsPolling,
  startBatchEvaluation as apiStartBatchEvaluation,
  startEvaluation as apiStartEvaluation,
} from "../api/runsClient";
import { createCommunicationPolicy } from "../communication/policy";
import type { CommunicationPolicy } from "../communication/types";
import type {
  EvaluationStageState,
  MultiAgentEvaluation,
} from "../evaluation/types";
import type { ReasoningEffort } from "../models/modelRegistry";
import { modelSupportsReasoningEffort } from "../models/modelRegistry";
import { createInitialExperimentState, providerForModel } from "./defaults";
import {
  loadLegacyRunsForMigration,
  loadRunConfig,
  loadSelection,
  markLegacyRunsMigrated,
  saveRunConfig,
  saveSelection,
} from "./persistence";
import type {
  ExperimentRun,
  ExperimentState,
  RunConfig,
  RunProgress,
} from "./types";

const POLL_INTERVAL_MS = 750;

export type EvaluationUiState = {
  runId: string;
  problemId: string;
  evaluationId?: string;
  evaluatorModel: string;
  evaluationReasoningEffort?: ReasoningEffort;
  status: "idle" | "running" | "completed" | "failed";
  stages: EvaluationStageState[];
  /** In-flight / latest partial evaluation for progressive UI. */
  partial?: MultiAgentEvaluation;
  error?: string;
  /** Present while a run-wide batch evaluation is in progress. */
  batch?: {
    currentIndex: number;
    total: number;
  };
};

export type ExperimentStore = {
  state: ExperimentState;
  agentPrompts: { agentA: string; agentB: string };
  selectedRun?: ExperimentRun;
  selectedConversation?: ExperimentRun["conversations"][number];
  evaluationUi?: EvaluationUiState;
  setPolicy: (partial: Partial<CommunicationPolicy>) => void;
  setRunConfig: (partial: Partial<RunConfig>) => void;
  selectRun: (runId: string | undefined) => void;
  selectProblem: (problemId: string | undefined, runId?: string) => void;
  /** Increments only when the user explicitly selects a problem. */
  problemSelectGeneration: number;
  deleteRun: (runId: string) => void;
  renameRun: (runId: string, title: string) => void;
  renameProblem: (runId: string, problemId: string, title: string) => void;
  startRun: () => Promise<void>;
  cancelRun: (runId: string) => void;
  appendMultiAgentEvaluation: (
    runId: string,
    evaluation: MultiAgentEvaluation,
  ) => void;
  runConversationEvaluation: (options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    retryFrom?: MultiAgentEvaluation;
  }) => Promise<MultiAgentEvaluation | undefined>;
  runAllConversationEvaluations: (options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
  }) => Promise<void>;
};

function progressFromRuns(runs: ExperimentRun[]): Record<string, RunProgress> {
  const map: Record<string, RunProgress> = {};
  for (const run of runs) {
    if (
      (run.status === "queued" || run.status === "running") &&
      run.progress
    ) {
      map[run.id] = run.progress;
    }
  }
  return map;
}

function speakingFromSelection(
  runs: ExperimentRun[],
  selectedRunId: string | undefined,
  selectedProblemId: string | undefined,
): AgentId | undefined {
  const run = runs.find((r) => r.id === selectedRunId);
  const conversation = run?.conversations.find(
    (c) => c.problemId === selectedProblemId,
  );
  if (conversation?.status === "running") {
    return conversation.speakingAgentId;
  }
  return undefined;
}

function isRunningFromRuns(runs: ExperimentRun[]): boolean {
  return runs.some((r) => r.status === "queued" || r.status === "running");
}

function evaluationUiFromRuns(
  runs: ExperimentRun[],
  focus?: { runId: string; problemId?: string; batch?: boolean },
): EvaluationUiState | undefined {
  if (!focus) {
    // Prefer any in-flight evaluation.
    for (const run of runs) {
      const running = [...(run.multiAgentEvaluations ?? [])]
        .filter((e) => e.status === "running")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = running[0];
      if (!latest) continue;
      return {
        runId: run.id,
        problemId: latest.problemId,
        evaluationId: latest.id,
        evaluatorModel: latest.evaluatorModel,
        evaluationReasoningEffort: latest.reasoningEffort,
        status: "running",
        stages: latest.stages,
        partial: latest,
        error: latest.errors[0]?.message,
      };
    }
    return undefined;
  }

  const run = runs.find((r) => r.id === focus.runId);
  if (!run) return undefined;

  if (focus.batch) {
    const running = (run.multiAgentEvaluations ?? []).filter(
      (e) => e.status === "running",
    );
    const latest =
      running[0] ??
      [...(run.multiAgentEvaluations ?? [])].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      )[0];
    if (!latest) {
      return {
        runId: focus.runId,
        problemId: run.conversations[0]?.problemId ?? "",
        evaluatorModel: run.config.evaluationModel,
        status: "running",
        stages: [],
        batch: {
          currentIndex: 0,
          total: run.conversations.length,
        },
      };
    }
    const index = Math.max(
      0,
      run.conversations.findIndex((c) => c.problemId === latest.problemId),
    );
    return {
      runId: focus.runId,
      problemId: latest.problemId,
      evaluationId: latest.id,
      evaluatorModel: latest.evaluatorModel,
      evaluationReasoningEffort: latest.reasoningEffort,
      status: latest.status === "running" ? "running" : latest.status === "completed" ? "completed" : "failed",
      stages: latest.stages,
      partial: latest,
      error: latest.errors[0]?.message,
      batch: {
        currentIndex: index,
        total: run.conversations.length,
      },
    };
  }

  const problemId = focus.problemId;
  if (!problemId) return undefined;
  const forProblem = (run.multiAgentEvaluations ?? [])
    .filter((e) => e.problemId === problemId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = forProblem[0];
  if (!latest) {
    return {
      runId: focus.runId,
      problemId,
      evaluatorModel: run.config.evaluationModel,
      status: "running",
      stages: [],
    };
  }
  return {
    runId: focus.runId,
    problemId,
    evaluationId: latest.id,
    evaluatorModel: latest.evaluatorModel,
    evaluationReasoningEffort: latest.reasoningEffort,
    status:
      latest.status === "running"
        ? "running"
        : latest.status === "completed"
          ? "completed"
          : "failed",
    stages: latest.stages,
    partial: latest,
    error: latest.errors[0]?.message,
  };
}

function applyRunsToState(
  prev: ExperimentState,
  runs: ExperimentRun[],
): ExperimentState {
  const selectedRunId =
    prev.selectedRunId && runs.some((r) => r.id === prev.selectedRunId)
      ? prev.selectedRunId
      : runs[0]?.id;
  const selectedRun = runs.find((r) => r.id === selectedRunId);
  const selectedProblemId =
    prev.selectedProblemId &&
    selectedRun?.conversations.some(
      (c) => c.problemId === prev.selectedProblemId,
    )
      ? prev.selectedProblemId
      : selectedRun?.conversations[0]?.problemId;

  return {
    ...prev,
    runs,
    selectedRunId,
    selectedProblemId,
    isRunning: isRunningFromRuns(runs),
    runProgressById: progressFromRuns(runs),
    speakingAgentId: speakingFromSelection(
      runs,
      selectedRunId,
      selectedProblemId,
    ),
  };
}

export function useExperimentStore(): ExperimentStore {
  const [state, setState] = useState<ExperimentState>(() =>
    createInitialExperimentState(loadRunConfig(), [], loadSelection()),
  );
  const [evaluationUi, setEvaluationUi] = useState<
    EvaluationUiState | undefined
  >();
  const [evalFocus, setEvalFocus] = useState<
    { runId: string; problemId?: string; batch?: boolean } | undefined
  >();
  const [hydrated, setHydrated] = useState(false);
  const [problemSelectGeneration, setProblemSelectGeneration] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveSelection({
      selectedRunId: state.selectedRunId,
      selectedProblemId: state.selectedProblemId,
    });
  }, [state.selectedRunId, state.selectedProblemId]);

  // Hydrate from server; migrate legacy localStorage runs once if server empty.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        let runs = await apiListRuns();
        if (runs.length === 0) {
          const legacy = loadLegacyRunsForMigration();
          if (legacy.length > 0) {
            await apiImportRuns(legacy);
            markLegacyRunsMigrated();
            runs = await apiListRuns();
          }
        }
        if (cancelled) return;
        setState((prev) => applyRunsToState(prev, runs));
        setEvaluationUi(evaluationUiFromRuns(runs, undefined));
      } catch (error) {
        console.error("Failed to hydrate runs from server:", error);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Key off in-flight run/eval presence — not `isRunning` alone.
  // `startRun` sets `isRunning` before the queued run is merged; depending on
  // that flag alone left polling never started, so status stayed "queued"
  // until something else (e.g. rename → mergeRun) refreshed from the server.
  const runsNeedPolling = state.runs.some(runNeedsPolling);
  const evalNeedsPolling =
    evaluationUi?.status === "running" || Boolean(evalFocus);

  // Poll while any run or evaluation is active.
  useEffect(() => {
    if (!hydrated) return;
    if (!runsNeedPolling && !evalNeedsPolling) return;

    let cancelled = false;
    let intervalId: number | undefined;

    const needsPollNow = () =>
      stateRef.current.runs.some(runNeedsPolling) || evalNeedsPolling;

    const tick = async () => {
      if (!needsPollNow()) {
        if (intervalId !== undefined) {
          window.clearInterval(intervalId);
          intervalId = undefined;
        }
        return;
      }
      try {
        const runs = await apiListRuns();
        if (cancelled) return;
        setState((prev) => applyRunsToState(prev, runs));
        const nextUi = evaluationUiFromRuns(runs, evalFocus);
        setEvaluationUi(nextUi);
        if (
          evalFocus &&
          nextUi &&
          nextUi.status !== "running" &&
          !evalFocus.batch
        ) {
          setEvalFocus(undefined);
        }
        if (evalFocus?.batch) {
          const run = runs.find((r) => r.id === evalFocus.runId);
          const anyRunning = (run?.multiAgentEvaluations ?? []).some(
            (e) => e.status === "running",
          );
          const allDone =
            run &&
            run.conversations.every((c) =>
              (run.multiAgentEvaluations ?? []).some(
                (e) =>
                  e.problemId === c.problemId &&
                  (e.status === "completed" || e.status === "failed"),
              ),
            );
          if (!anyRunning && allDone) {
            setEvalFocus(undefined);
          }
        }
      } catch (error) {
        console.error("Failed to poll runs:", error);
      }
    };

    intervalId = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [hydrated, runsNeedPolling, evalNeedsPolling, evalFocus]);

  const agentPrompts = useMemo(
    () =>
      buildAgentPromptPair(
        state.currentPolicy,
        state.currentRunConfig.problemCategory,
      ),
    [state.currentPolicy, state.currentRunConfig.problemCategory],
  );

  const selectedRun = state.runs.find((r) => r.id === state.selectedRunId);

  const selectedConversation = selectedRun?.conversations.find(
    (c) => c.problemId === state.selectedProblemId,
  );

  function setPolicy(partial: Partial<CommunicationPolicy>) {
    setState((prev) => ({
      ...prev,
      currentPolicy: createCommunicationPolicy({
        ...prev.currentPolicy,
        ...partial,
      }),
    }));
  }

  function setRunConfig(partial: Partial<RunConfig>) {
    setState((prev) => {
      const currentRunConfig = { ...prev.currentRunConfig, ...partial };

      if (partial.runModel !== undefined) {
        currentRunConfig.provider = providerForModel(partial.runModel);
        if (
          !modelSupportsReasoningEffort(partial.runModel) &&
          currentRunConfig.runReasoningEffort
        ) {
          // Keep stored value for when the user switches back; API will omit it.
        }
      }

      saveRunConfig(currentRunConfig);
      return { ...prev, currentRunConfig };
    });
  }

  function selectRun(runId: string | undefined) {
    setState((prev) => {
      const run = prev.runs.find((r) => r.id === runId);
      const selectedProblemId = run?.conversations[0]?.problemId;
      return {
        ...prev,
        selectedRunId: runId,
        selectedProblemId,
        speakingAgentId: speakingFromSelection(
          prev.runs,
          runId,
          selectedProblemId,
        ),
      };
    });
  }

  function selectProblem(problemId: string | undefined, runId?: string) {
    setProblemSelectGeneration((n) => n + 1);
    setState((prev) => {
      const selectedRunId = runId ?? prev.selectedRunId;
      return {
        ...prev,
        selectedRunId,
        selectedProblemId: problemId,
        speakingAgentId: speakingFromSelection(
          prev.runs,
          selectedRunId,
          problemId,
        ),
      };
    });
  }

  function mergeRun(run: ExperimentRun) {
    setState((prev) => {
      const exists = prev.runs.some((r) => r.id === run.id);
      const runs = exists
        ? prev.runs.map((r) => (r.id === run.id ? run : r))
        : [run, ...prev.runs];
      return applyRunsToState(
        {
          ...prev,
          selectedRunId: run.id,
          selectedProblemId:
            prev.selectedRunId === run.id
              ? prev.selectedProblemId
              : (run.conversations[0]?.problemId ?? prev.selectedProblemId),
        },
        runs,
      );
    });
  }

  async function startRun() {
    const policySnapshot = createCommunicationPolicy(state.currentPolicy);
    const configSnapshot: RunConfig = { ...state.currentRunConfig };

    setState((prev) => ({ ...prev, isRunning: true }));

    try {
      const run = await apiCreateRun({
        policy: policySnapshot,
        config: configSnapshot,
      });
      mergeRun(run);
    } catch (error) {
      console.error("Failed to start run:", error);
      setState((prev) => ({
        ...prev,
        isRunning: isRunningFromRuns(prev.runs),
      }));
    }
  }

  function cancelRun(runId: string) {
    // Select immediately so Run Results shows the cancelled banner when the
    // server finishes unwinding the run.
    setState((prev) => {
      const runs = prev.runs.map((run) =>
        run.id === runId
          ? {
              ...run,
              progress: undefined,
            }
          : run,
      );
      return applyRunsToState(
        {
          ...prev,
          selectedRunId: runId,
          selectedProblemId:
            prev.selectedRunId === runId
              ? prev.selectedProblemId
              : (runs.find((r) => r.id === runId)?.conversations[0]
                  ?.problemId ?? prev.selectedProblemId),
        },
        runs,
      );
    });
    void apiCancelRun(runId)
      .then((run) => {
        mergeRun(run);
      })
      .catch((error) => {
        console.error("Failed to cancel run:", error);
      });
  }

  function deleteRun(runId: string) {
    // Optimistic: drop from UI immediately. Server delete is authoritative;
    // on failure, re-list so a failed wipe does not leave a ghost gap.
    setState((prev) => {
      const runs = prev.runs.filter((r) => r.id !== runId);
      return applyRunsToState(prev, runs);
    });
    setEvaluationUi((prev) => (prev?.runId === runId ? undefined : prev));
    setEvalFocus((prev) => (prev?.runId === runId ? undefined : prev));

    void apiDeleteRun(runId).catch((error) => {
      console.error("Failed to delete run:", error);
      void apiListRuns()
        .then((runs) => {
          setState((prev) => applyRunsToState(prev, runs));
        })
        .catch(() => {
          // Ignore secondary failure; original error already logged.
        });
    });
  }

  function renameRun(runId: string, title: string) {
    const next = title.trim();
    if (!next) return;
    // Optimistic local update
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((run) =>
        run.id === runId ? { ...run, title: next } : run,
      ),
    }));
    void apiRenameRun(runId, next)
      .then((run) => mergeRun(run))
      .catch((error) => console.error("Failed to rename run:", error));
  }

  function renameProblem(runId: string, problemId: string, title: string) {
    const next = title.trim();
    if (!next) return;
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((run) => {
        if (run.id !== runId) return run;
        return {
          ...run,
          conversations: run.conversations.map((c) =>
            c.problemId === problemId ? { ...c, problemTitle: next } : c,
          ),
        };
      }),
    }));
    void apiRenameProblem(runId, problemId, next)
      .then((run) => mergeRun(run))
      .catch((error) => console.error("Failed to rename problem:", error));
  }

  function appendMultiAgentEvaluation(
    _runId: string,
    _evaluation: MultiAgentEvaluation,
  ) {
    // Server is authoritative; polling will pick up evaluation writes.
  }

  async function runConversationEvaluation(options: {
    runId: string;
    problemId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    retryFrom?: MultiAgentEvaluation;
  }): Promise<MultiAgentEvaluation | undefined> {
    const evaluationReasoningEffort =
      options.evaluationReasoningEffort ??
      stateRef.current.runs.find((r) => r.id === options.runId)?.config
        .evaluationReasoningEffort;

    setEvalFocus({ runId: options.runId, problemId: options.problemId });
    setEvaluationUi({
      runId: options.runId,
      problemId: options.problemId,
      evaluatorModel: options.evaluatorModel,
      evaluationReasoningEffort,
      status: "running",
      stages: [],
    });

    try {
      const result = await apiStartEvaluation({
        runId: options.runId,
        problemId: options.problemId,
        evaluatorModel: options.evaluatorModel,
        evaluationReasoningEffort,
        retryFromId: options.retryFrom?.id,
      });
      mergeRun(result.run);
      setEvaluationUi(
        evaluationUiFromRuns([result.run], {
          runId: options.runId,
          problemId: options.problemId,
        }),
      );
      return result.run.multiAgentEvaluations?.find(
        (e) => e.id === result.evaluationId,
      );
    } catch (error) {
      setEvalFocus(undefined);
      setEvaluationUi({
        runId: options.runId,
        problemId: options.problemId,
        evaluatorModel: options.evaluatorModel,
        evaluationReasoningEffort,
        status: "failed",
        stages: [],
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async function runAllConversationEvaluations(options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
  }): Promise<void> {
    const run = stateRef.current.runs.find((r) => r.id === options.runId);
    if (!run || run.conversations.length === 0) return;

    const evaluationReasoningEffort =
      options.evaluationReasoningEffort ?? run.config.evaluationReasoningEffort;

    setEvalFocus({ runId: options.runId, batch: true });
    setEvaluationUi({
      runId: options.runId,
      problemId: run.conversations[0]!.problemId,
      evaluatorModel: options.evaluatorModel,
      evaluationReasoningEffort,
      status: "running",
      stages: [],
      batch: { currentIndex: 0, total: run.conversations.length },
    });

    try {
      const result = await apiStartBatchEvaluation({
        runId: options.runId,
        evaluatorModel: options.evaluatorModel,
        evaluationReasoningEffort,
      });
      mergeRun(result.run);
    } catch (error) {
      setEvalFocus(undefined);
      setEvaluationUi({
        runId: options.runId,
        problemId: run.conversations[0]!.problemId,
        evaluatorModel: options.evaluatorModel,
        evaluationReasoningEffort,
        status: "failed",
        stages: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    state,
    agentPrompts,
    selectedRun,
    selectedConversation,
    evaluationUi,
    setPolicy,
    setRunConfig,
    selectRun,
    selectProblem,
    problemSelectGeneration,
    deleteRun,
    renameRun,
    renameProblem,
    startRun,
    cancelRun,
    appendMultiAgentEvaluation,
    runConversationEvaluation,
    runAllConversationEvaluations,
  };
}
