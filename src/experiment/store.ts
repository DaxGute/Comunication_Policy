/**
 * React store for the workbench: current policy/config, run list, and polling.
 *
 * Execution lives on the server (RunManager). Evaluation UI mapping is in
 * evaluationUi.ts. Persistence of picker state is in persistence.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  getRunTree as apiGetRunTree,
  putRunTree as apiPutRunTree,
} from "../api/runTreeClient";
import { createCommunicationPolicy } from "../communication/policy";
import type { CommunicationPolicy } from "../communication/types";
import type {
  MultiAgentEvaluation,
} from "../evaluation/types";
import type { ReasoningEffort } from "../models/modelRegistry";
import { modelSupportsReasoningEffort } from "../models/modelRegistry";
import { createInitialExperimentState, providerForModel } from "./defaults";
import {
  evaluationUiFromRuns,
  sameEvaluationUi,
  type EvaluationUiState,
} from "./evaluationUi";
import { reuseUnchangedRuns, sameProgressMap } from "./runIdentity";
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
import {
  deleteFolder as deleteFolderFromTree,
  emptyRunTree,
  insertFolder,
  moveTreeItem,
  prependRunToTree,
  reconcileRunTree,
  removeRunFromTree,
  renameFolder as renameFolderInTree,
  sameRunTree,
  type DraggedTreeItem,
  type DropTarget,
  type RunTree,
} from "./runTree";

const POLL_INTERVAL_MS = 750;

export type { EvaluationUiState } from "./evaluationUi";
export type { DraggedTreeItem, DropTarget, RunTree } from "./runTree";

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
  runTree: RunTree;
  createFolder: () => string;
  renameFolder: (folderId: string, title: string) => void;
  deleteFolder: (folderId: string) => void;
  moveTreeItem: (dragged: DraggedTreeItem, target: DropTarget) => void;
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
    overrideExisting?: boolean;
  }) => Promise<MultiAgentEvaluation | undefined>;
  runAllConversationEvaluations: (options: {
    runId: string;
    evaluatorModel: string;
    evaluationReasoningEffort?: ReasoningEffort;
    overrideExisting?: boolean;
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

function applyRunsToState(
  prev: ExperimentState,
  runs: ExperimentRun[],
): ExperimentState {
  const nextRuns = reuseUnchangedRuns(prev.runs, runs);
  const selectedRunId =
    prev.selectedRunId && nextRuns.some((r) => r.id === prev.selectedRunId)
      ? prev.selectedRunId
      : nextRuns[0]?.id;
  const selectedRun = nextRuns.find((r) => r.id === selectedRunId);
  const selectedProblemId =
    prev.selectedProblemId &&
    selectedRun?.conversations.some(
      (c) => c.problemId === prev.selectedProblemId,
    )
      ? prev.selectedProblemId
      : selectedRun?.conversations[0]?.problemId;
  const isRunning = isRunningFromRuns(nextRuns);
  const runProgressById = progressFromRuns(nextRuns);
  const speakingAgentId = speakingFromSelection(
    nextRuns,
    selectedRunId,
    selectedProblemId,
  );

  if (
    nextRuns === prev.runs &&
    selectedRunId === prev.selectedRunId &&
    selectedProblemId === prev.selectedProblemId &&
    isRunning === prev.isRunning &&
    speakingAgentId === prev.speakingAgentId &&
    sameProgressMap(runProgressById, prev.runProgressById)
  ) {
    return prev;
  }

  return {
    ...prev,
    runs: nextRuns,
    selectedRunId,
    selectedProblemId,
    isRunning,
    runProgressById,
    speakingAgentId,
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
  const [runTree, setRunTree] = useState<RunTree>(emptyRunTree);
  const stateRef = useRef(state);
  stateRef.current = state;
  const runTreeRef = useRef(runTree);
  runTreeRef.current = runTree;
  const evalFocusRef = useRef(evalFocus);
  evalFocusRef.current = evalFocus;
  const evaluationUiRef = useRef(evaluationUi);
  evaluationUiRef.current = evaluationUi;

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
        let tree = emptyRunTree();
        try {
          tree = await apiGetRunTree();
        } catch (error) {
          console.error("Failed to hydrate run tree from server:", error);
        }
        tree = reconcileRunTree(
          tree,
          runs.map((run) => run.id),
        );
        if (cancelled) return;
        setRunTree(tree);
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
      stateRef.current.runs.some(runNeedsPolling) ||
      evaluationUiRef.current?.status === "running" ||
      Boolean(evalFocusRef.current);

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
        const focus = evalFocusRef.current;
        const nextUi = evaluationUiFromRuns(runs, focus);
        setEvaluationUi((prev) =>
          sameEvaluationUi(prev, nextUi) ? prev : nextUi,
        );
        if (
          focus &&
          nextUi &&
          nextUi.status !== "running" &&
          !focus.batch
        ) {
          setEvalFocus(undefined);
        }
        if (focus?.batch) {
          const run = runs.find((r) => r.id === focus.runId);
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

  useEffect(() => {
    const runIds = state.runs.map((run) => run.id);
    setRunTree((prev) => {
      const next = reconcileRunTree(prev, runIds);
      return sameRunTree(prev, next) ? prev : next;
    });
  }, [state.runs]);

  const agentPrompts = useMemo(
    () => buildAgentPromptPair(state.currentPolicy),
    [state.currentPolicy],
  );

  const selectedRun = state.runs.find((r) => r.id === state.selectedRunId);

  const selectedConversation = selectedRun?.conversations.find(
    (c) => c.problemId === state.selectedProblemId,
  );

  const setPolicy = useCallback((partial: Partial<CommunicationPolicy>) => {
    setState((prev) => ({
      ...prev,
      currentPolicy: createCommunicationPolicy({
        ...prev.currentPolicy,
        ...partial,
      }),
    }));
  }, []);

  const setRunConfig = useCallback((partial: Partial<RunConfig>) => {
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
  }, []);

  const selectRun = useCallback((runId: string | undefined) => {
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
  }, []);

  const selectProblem = useCallback((problemId: string | undefined, runId?: string) => {
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
  }, []);

  const persistTree = useCallback((next: RunTree) => {
    const reconciled = reconcileRunTree(
      next,
      stateRef.current.runs.map((run) => run.id),
    );
    setRunTree(reconciled);
    void apiPutRunTree(reconciled).catch((error) => {
      console.error("Failed to save run tree:", error);
      void apiGetRunTree()
        .then((tree) => {
          setRunTree(
            reconcileRunTree(
              tree,
              stateRef.current.runs.map((run) => run.id),
            ),
          );
        })
        .catch(() => {
          // Ignore secondary failure; original error already logged.
        });
    });
  }, []);

  const mergeRun = useCallback((run: ExperimentRun) => {
    setRunTree((tree) => prependRunToTree(tree, run.id));
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
  }, []);

  const startRun = useCallback(async () => {
    const { currentPolicy, currentRunConfig } = stateRef.current;
    const policySnapshot = createCommunicationPolicy(currentPolicy);
    const configSnapshot: RunConfig = { ...currentRunConfig };

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
  }, [mergeRun]);

  const cancelRun = useCallback((runId: string) => {
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
  }, [mergeRun]);

  const deleteRun = useCallback((runId: string) => {
    // Optimistic: drop from UI immediately. Server delete is authoritative;
    // on failure, re-list so a failed wipe does not leave a ghost gap.
    setState((prev) => {
      const runs = prev.runs.filter((r) => r.id !== runId);
      return applyRunsToState(prev, runs);
    });
    setRunTree((tree) => removeRunFromTree(tree, runId));
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
  }, []);

  const renameRun = useCallback((runId: string, title: string) => {
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
  }, [mergeRun]);

  const renameProblem = useCallback((runId: string, problemId: string, title: string) => {
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
  }, [mergeRun]);

  const createFolder = useCallback((): string => {
    const { tree, folder } = insertFolder(runTreeRef.current);
    persistTree(tree);
    return folder.id;
  }, [persistTree]);

  const renameFolder = useCallback((folderId: string, title: string) => {
    persistTree(renameFolderInTree(runTreeRef.current, folderId, title));
  }, [persistTree]);

  const deleteFolder = useCallback((folderId: string) => {
    persistTree(deleteFolderFromTree(runTreeRef.current, folderId));
  }, [persistTree]);

  const moveInspectorTreeItem = useCallback(
    (dragged: DraggedTreeItem, target: DropTarget) => {
      persistTree(moveTreeItem(runTreeRef.current, dragged, target));
    },
    [persistTree],
  );

  const appendMultiAgentEvaluation = useCallback(
    (_runId: string, _evaluation: MultiAgentEvaluation) => {
      // Server is authoritative; polling will pick up evaluation writes.
    },
    [],
  );

  const runConversationEvaluation = useCallback(
    async (options: {
      runId: string;
      problemId: string;
      evaluatorModel: string;
      evaluationReasoningEffort?: ReasoningEffort;
      retryFrom?: MultiAgentEvaluation;
      overrideExisting?: boolean;
    }): Promise<MultiAgentEvaluation | undefined> => {
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
        overrideExisting: options.overrideExisting,
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
    },
    [mergeRun],
  );

  const runAllConversationEvaluations = useCallback(
    async (options: {
      runId: string;
      evaluatorModel: string;
      evaluationReasoningEffort?: ReasoningEffort;
      overrideExisting?: boolean;
    }): Promise<void> => {
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
        overrideExisting: options.overrideExisting,
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
    },
    [mergeRun],
  );

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
    runTree,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTreeItem: moveInspectorTreeItem,
    startRun,
    cancelRun,
    appendMultiAgentEvaluation,
    runConversationEvaluation,
    runAllConversationEvaluations,
  };
}
