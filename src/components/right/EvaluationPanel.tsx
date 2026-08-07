import { useState, type CSSProperties } from "react";
import { AVAILABLE_MODELS } from "../../experiment/defaults";
import {
  loadRunSettingsOpen,
  saveRunSettingsOpen,
} from "../../experiment/persistence";
import type { RunConfig, RunProgress } from "../../experiment/types";
import { PROBLEM_CATEGORIES, getProblemsForCategory } from "../../problems/registry";
import type { ProblemCategory } from "../../problems/types";
import { labelForModel } from "../../runtime/models";
import { NumberStepper } from "../ui/NumberStepper";

type Props = {
  config: RunConfig;
  onConfigChange: (partial: Partial<RunConfig>) => void;
  onRun: () => void;
  onCancel: () => void;
  isRunning: boolean;
  runProgress?: RunProgress;
};

function categoryLabel(id: ProblemCategory): string {
  return PROBLEM_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export function EvaluationPanel({
  config,
  onConfigChange,
  onRun,
  onCancel,
  isRunning,
  runProgress,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(loadRunSettingsOpen);
  const progressPct = Math.round((runProgress?.fraction ?? 0) * 100);

  return (
    <div className="evaluation-panel">
      <section className="panel-section">
        <header className="panel-section__header">
          <h2>Evaluation</h2>
          <p className="muted">
            Configure a run. Policy and prompts are snapshotted when you click
            Run. Saved runs live in Conversation Inspector.
          </p>
        </header>

        <div className="run-settings">
          <button
            type="button"
            className="run-settings__toggle"
            aria-expanded={settingsOpen}
            onClick={() => {
              const open = !settingsOpen;
              setSettingsOpen(open);
              saveRunSettingsOpen(open);
            }}
          >
            <span className="run-settings__toggle-label">
              <span className="run-settings__title">Run settings</span>
              {!settingsOpen ? (
                <span className="run-settings__meta muted">
                  <span>{categoryLabel(config.problemCategory)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{config.problemCount} problems</span>
                  <span aria-hidden="true">·</span>
                  <span className="mono">{labelForModel(config.model)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{config.maxTurns} turns</span>
                  <span aria-hidden="true">·</span>
                  <span>T {config.temperature}</span>
                </span>
              ) : null}
            </span>
            <svg
              className="run-settings__chevron"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M3 4.5 6 7.5 9 4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {settingsOpen ? (
            <div className="run-settings__body">
              <label className="field">
                <span>Problem category</span>
                <select
                  value={config.problemCategory}
                  onChange={(e) =>
                    onConfigChange({
                      problemCategory: e.target.value as ProblemCategory,
                    })
                  }
                >
                  {PROBLEM_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span className="field__top">
                  <span>Number of problems</span>
                  <span className="field__top-note muted">
                    (Total:{" "}
                    {getProblemsForCategory(config.problemCategory).length})
                  </span>
                </span>
                <NumberStepper
                  min={1}
                  max={150}
                  value={config.problemCount}
                  onChange={(problemCount) => onConfigChange({ problemCount })}
                />
              </label>

              <label className="field">
                <span className="field__top">
                  <span>Model</span>
                  <span className="field__top-note muted">
                    OpenAI calls go through a local{" "}
                    <span className="mono">/api/generate</span> proxy (key
                    stays on the server).
                  </span>
                </span>
                <select
                  value={config.model}
                  onChange={(e) => onConfigChange({ model: e.target.value })}
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Maximum interaction turns</span>
                <NumberStepper
                  min={1}
                  max={40}
                  value={config.maxTurns}
                  onChange={(maxTurns) => onConfigChange({ maxTurns })}
                />
              </label>

              <label className="field">
                <span>Temperature</span>
                <NumberStepper
                  min={0}
                  max={2}
                  step={0.1}
                  value={config.temperature}
                  onChange={(temperature) => onConfigChange({ temperature })}
                />
              </label>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={
            isRunning ? "run-button run-button--running" : "run-button"
          }
          style={
            isRunning
              ? ({
                  "--run-progress": `${progressPct}%`,
                } as CSSProperties)
              : undefined
          }
          title={isRunning ? "Cancel" : undefined}
          aria-label={isRunning ? "Cancel run" : "Run"}
          onClick={isRunning ? onCancel : onRun}
        >
          <span className="run-button__fill" aria-hidden="true" />
          <span className="run-button__label">
            {isRunning ? `${progressPct}%` : "Run"}
          </span>
        </button>
      </section>
    </div>
  );
}
