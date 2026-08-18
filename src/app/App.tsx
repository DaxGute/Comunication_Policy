/**
 * Workbench shell: wires the experiment store into the four-pane layout.
 *
 * Pane implementations live under src/components/{policy,dashboard,runSettings,inspector}.
 */
import { useCallback, useMemo, useState } from "react";
import { ConversationInspector } from "../components/inspector/ConversationInspector";
import { CenterPane } from "../components/dashboard/CenterPane";
import { CommunicationPolicyPanel } from "../components/policy/CommunicationPolicyPanel";
import { RunSettingsPanel } from "../components/runSettings/RunSettingsPanel";
import { useExperimentStore } from "../experiment/store";
import { WorkbenchLayout } from "./layout/WorkbenchLayout";

export default function App() {
  const store = useExperimentStore();
  const {
    selectRun: storeSelectRun,
    selectProblem: storeSelectProblem,
    setPolicy,
    setRunConfig,
    startRun,
    cancelRun,
    deleteRun,
    renameRun,
    renameProblem,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTreeItem,
    runConversationEvaluation,
    runAllConversationEvaluations,
  } = store;
  const [inspectorFocus, setInspectorFocus] = useState(0);

  const activeRuns = useMemo(
    () =>
      Object.entries(store.state.runProgressById).map(([id, progress]) => {
        const run = store.state.runs.find((r) => r.id === id);
        return {
          id,
          title: run?.title,
          config: run?.config,
          policy: run?.policy,
          progress,
          selected: store.state.selectedRunId === id,
        };
      }),
    [
      store.state.runProgressById,
      store.state.runs,
      store.state.selectedRunId,
    ],
  );

  const selectRun = useCallback(
    (runId: string | undefined) => {
      storeSelectRun(runId);
      setInspectorFocus((n) => n + 1);
    },
    [storeSelectRun],
  );

  const selectProblem = useCallback(
    (problemId: string, runId?: string) => {
      storeSelectProblem(problemId, runId);
      setInspectorFocus((n) => n + 1);
    },
    [storeSelectProblem],
  );

  return (
    <WorkbenchLayout
      left={
        <CommunicationPolicyPanel
          policy={store.state.currentPolicy}
          onChange={setPolicy}
          agentAPrompt={store.agentPrompts.agentA}
          agentBPrompt={store.agentPrompts.agentB}
        />
      }
      main={
        <CenterPane
          runs={store.state.runs}
          selectedRunId={store.state.selectedRunId}
          onSelectRun={selectRun}
        />
      }
      right={
        <RunSettingsPanel
          config={store.state.currentRunConfig}
          onConfigChange={setRunConfig}
          onRun={startRun}
          onCancelRun={cancelRun}
          onSelectRun={selectRun}
          activeRuns={activeRuns}
        />
      }
      bottom={
        <ConversationInspector
          runs={store.state.runs}
          runTree={store.runTree}
          selectedRun={store.selectedRun}
          selectedProblemId={store.state.selectedProblemId}
          inspectorFocus={inspectorFocus}
          speakingAgentId={store.state.speakingAgentId}
          onSelectRun={selectRun}
          onSelectProblem={selectProblem}
          onDeleteRun={deleteRun}
          onRenameRun={renameRun}
          onRenameProblem={renameProblem}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
          onMoveTreeItem={moveTreeItem}
          evaluationUi={store.evaluationUi}
          onRunEvaluation={runConversationEvaluation}
          onRunAllEvaluations={runAllConversationEvaluations}
        />
      }
    />
  );
}
