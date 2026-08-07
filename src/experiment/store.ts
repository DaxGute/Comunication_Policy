import { useEffect, useMemo, useRef, useState } from "react";
import { buildAgentPromptPair } from "../agents/buildAgentPrompt";
import type { AgentId } from "../agents/types";
import { createCommunicationPolicy } from "../communication/policy";
import type { CommunicationPolicy } from "../communication/types";
import { runExperiment } from "../runtime/runExperiment";
import { createInitialExperimentState, providerForModel } from "./defaults";
import {
  loadRunConfig,
  loadRuns,
  loadSelection,
  saveRunConfig,
  saveRuns,
  saveSelection,
} from "./persistence";
import type {
  ConversationMessage,
  ExperimentRun,
  ExperimentState,
  RunConfig,
  RunProgress,
} from "./types";

export type ExperimentStore = {
  state: ExperimentState;
  agentPrompts: { agentA: string; agentB: string };
  selectedRun?: ExperimentRun;
  selectedConversation?: ExperimentRun["conversations"][number];
  setPolicy: (partial: Partial<CommunicationPolicy>) => void;
  setRunConfig: (partial: Partial<RunConfig>) => void;
  selectRun: (runId: string | undefined) => void;
  selectProblem: (problemId: string | undefined) => void;
  deleteRun: (runId: string) => void;
  startRun: () => Promise<void>;
  cancelRun: () => void;
};

export function useExperimentStore(): ExperimentStore {
  const [state, setState] = useState<ExperimentState>(() =>
    createInitialExperimentState(loadRunConfig(), loadRuns(), loadSelection()),
  );
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    saveRuns(state.runs);
  }, [state.runs]);

  useEffect(() => {
    saveSelection({
      selectedRunId: state.selectedRunId,
      selectedProblemId: state.selectedProblemId,
    });
  }, [state.selectedRunId, state.selectedProblemId]);

  const agentPrompts = useMemo(
    () => buildAgentPromptPair(state.currentPolicy),
    [state.currentPolicy],
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
      if (partial.model !== undefined) {
        currentRunConfig.provider = providerForModel(partial.model);
      }
      saveRunConfig(currentRunConfig);
      return { ...prev, currentRunConfig };
    });
  }

  function selectRun(runId: string | undefined) {
    setState((prev) => {
      const run = prev.runs.find((r) => r.id === runId);
      return {
        ...prev,
        selectedRunId: runId,
        selectedProblemId: run?.conversations[0]?.problemId,
      };
    });
  }

  function selectProblem(problemId: string | undefined) {
    setState((prev) => ({ ...prev, selectedProblemId: problemId }));
  }

  function deleteRun(runId: string) {
    setState((prev) => {
      const runs = prev.runs.filter((r) => r.id !== runId);
      const selectedRunId =
        prev.selectedRunId === runId ? runs[0]?.id : prev.selectedRunId;
      const nextSelected = runs.find((r) => r.id === selectedRunId);
      return {
        ...prev,
        runs,
        selectedRunId,
        selectedProblemId:
          prev.selectedRunId === runId
            ? nextSelected?.conversations[0]?.problemId
            : prev.selectedProblemId,
      };
    });
  }

  function upsertRun(run: ExperimentRun) {
    setState((prev) => {
      const exists = prev.runs.some((r) => r.id === run.id);
      const runs = exists
        ? prev.runs.map((r) => (r.id === run.id ? { ...r, ...run } : r))
        : [run, ...prev.runs];
      return {
        ...prev,
        runs,
        selectedRunId: run.id,
        selectedProblemId:
          prev.selectedProblemId ?? run.conversations[0]?.problemId,
      };
    });
  }

  function appendMessage(
    runId: string,
    problemId: string,
    message: ConversationMessage,
  ) {
    setState((prev) => ({
      ...prev,
      runs: prev.runs.map((run) => {
        if (run.id !== runId) return run;
        const existing = run.conversations.find(
          (c) => c.problemId === problemId,
        );
        if (!existing) {
          return {
            ...run,
            conversations: [
              ...run.conversations,
              {
                problemId,
                problemTitle: problemId,
                problemText: "",
                messages: [message],
                stoppedReason: "max_turns" as const,
              },
            ],
          };
        }
        if (existing.messages.some((m) => m.id === message.id)) {
          return run;
        }
        return {
          ...run,
          conversations: run.conversations.map((c) =>
            c.problemId === problemId
              ? { ...c, messages: [...c.messages, message] }
              : c,
          ),
        };
      }),
      selectedProblemId: problemId,
    }));
  }

  async function startRun() {
    if (runningRef.current) return;
    runningRef.current = true;

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Snapshot at click time so later slider moves cannot mutate this run.
    const policySnapshot = createCommunicationPolicy(state.currentPolicy);
    const configSnapshot: RunConfig = { ...state.currentRunConfig };

    setState((prev) => ({
      ...prev,
      isRunning: true,
      speakingAgentId: undefined,
      runProgress: {
        fraction: 0,
        completedProblems: 0,
        totalProblems: configSnapshot.problemCount,
      },
    }));

    try {
      await runExperiment({
        policy: policySnapshot,
        config: configSnapshot,
        signal: abortController.signal,
        callbacks: {
          onRunCreated: (run) => {
            upsertRun(run);
          },
          onSpeaking: (agentId: AgentId | undefined) => {
            setState((prev) => ({ ...prev, speakingAgentId: agentId }));
          },
          onProgress: (progress: RunProgress) => {
            setState((prev) => ({ ...prev, runProgress: progress }));
          },
          onConversationMessage: (runId, problemId, message) => {
            appendMessage(runId, problemId, message);
          },
          onProblemComplete: (runId, conversation) => {
            setState((prev) => ({
              ...prev,
              runs: prev.runs.map((run) => {
                if (run.id !== runId) return run;
                const without = run.conversations.filter(
                  (c) => c.problemId !== conversation.problemId,
                );
                return {
                  ...run,
                  conversations: [...without, conversation],
                };
              }),
              selectedProblemId: conversation.problemId,
            }));
          },
          onRunComplete: (run) => {
            upsertRun(run);
          },
          onRunFailed: (run) => {
            upsertRun(run);
          },
          onRunCancelled: (run) => {
            upsertRun(run);
          },
        },
      });
    } finally {
      runningRef.current = false;
      abortRef.current = null;
      setState((prev) => ({
        ...prev,
        isRunning: false,
        speakingAgentId: undefined,
        runProgress: undefined,
      }));
    }
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  return {
    state,
    agentPrompts,
    selectedRun,
    selectedConversation,
    setPolicy,
    setRunConfig,
    selectRun,
    selectProblem,
    deleteRun,
    startRun,
    cancelRun,
  };
}
