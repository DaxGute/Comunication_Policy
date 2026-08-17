/**
 * Workbench shell: wires the experiment store into the four-pane layout.
 *
 * Pane implementations live under src/components/{policy,dashboard,runSettings,inspector}.
 */
import { useState } from "react";
import { ConversationInspector } from "../components/inspector/ConversationInspector";
import { CenterPane } from "../components/dashboard/CenterPane";
import { CommunicationPolicyPanel } from "../components/policy/CommunicationPolicyPanel";
import { RunSettingsPanel } from "../components/runSettings/RunSettingsPanel";
import { useExperimentStore } from "../experiment/store";
import { WorkbenchLayout } from "./layout/WorkbenchLayout";

export default function App() {
  const store = useExperimentStore();
  const [inspectorFocus, setInspectorFocus] = useState(0);

  const activeRuns = Object.entries(store.state.runProgressById).map(
    ([id, progress]) => {
      const run = store.state.runs.find((r) => r.id === id);
      return {
        id,
        title: run?.title,
        config: run?.config,
        policy: run?.policy,
        progress,
        selected: store.state.selectedRunId === id,
      };
    },
  );

  const selectRun = (runId: string | undefined) => {
    store.selectRun(runId);
    setInspectorFocus((n) => n + 1);
  };

  return (
    <WorkbenchLayout
      left={
        <CommunicationPolicyPanel
          policy={store.state.currentPolicy}
          onChange={store.setPolicy}
          agentAPrompt={store.agentPrompts.agentA}
          agentBPrompt={store.agentPrompts.agentB}
        />
      }
      main={
        <CenterPane
          runs={store.state.runs}
          selectedRunId={store.state.selectedRunId}
          onSelectRun={(runId) => {
            selectRun(runId);
          }}
        />
      }
      right={
        <RunSettingsPanel
          config={store.state.currentRunConfig}
          onConfigChange={store.setRunConfig}
          onRun={() => {
            void store.startRun();
          }}
          onCancelRun={store.cancelRun}
          onSelectRun={selectRun}
          activeRuns={activeRuns}
        />
      }
      bottom={
        <ConversationInspector
          runs={store.state.runs}
          selectedRun={store.selectedRun}
          selectedProblemId={store.state.selectedProblemId}
          inspectorFocus={inspectorFocus}
          speakingAgentId={store.state.speakingAgentId}
          onSelectRun={selectRun}
          onSelectProblem={(problemId, runId) => {
            store.selectProblem(problemId, runId);
            setInspectorFocus((n) => n + 1);
          }}
          onDeleteRun={store.deleteRun}
          onRenameRun={store.renameRun}
          onRenameProblem={store.renameProblem}
          evaluationUi={store.evaluationUi}
          onRunEvaluation={store.runConversationEvaluation}
          onRunAllEvaluations={store.runAllConversationEvaluations}
        />
      }
    />
  );
}
