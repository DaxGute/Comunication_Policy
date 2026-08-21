/**
 * Right-pane run configuration: category, models, problem count, and start/cancel.
 *
 * Post-hoc multi-agent evaluation lives in the conversation inspector, not here.
 * CSS class `evaluation-panel` is historical; the visible heading stays "Evaluation".
 */
import { memo, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { formatPolicyValue } from "../../communication";
import type { CommunicationPolicy } from "../../communication/types";
import {
  loadRunSettingsOpen,
  saveRunSettingsOpen,
} from "../../experiment/persistence";
import {
  MAX_INTERACTION_TURNS,
  MIN_INTERACTION_TURNS,
} from "../../experiment/defaults";
import type { RunConfig, RunProgress } from "../../experiment/types";
import {
  estimateExperimentCost,
  formatEstimatedCostRange,
} from "../../models/cost";
import {
  displayNameForModel,
} from "../../models/modelRegistry";
import { PROBLEM_CATEGORIES, getProblemsForCategory } from "../../problems/registry";
import type { ProblemCategory } from "../../problems/types";
import { NumberStepper } from "../ui/NumberStepper";
import { ModelSelect } from "../ui/ModelSelect";

export type ActiveRunMedallion = {
  id: string;
  title?: string;
  config?: RunConfig;
  policy?: CommunicationPolicy;
  progress: RunProgress;
  selected?: boolean;
};

type Props = {
  config: RunConfig;
  onConfigChange: (partial: Partial<RunConfig>) => void;
  onRun: () => void;
  onCancelRun: (runId: string) => void;
  onSelectRun?: (runId: string) => void;
  activeRuns: ActiveRunMedallion[];
};

type TooltipAnchor = {
  runId: string;
  left: number;
  top: number;
};

function categoryLabel(id: ProblemCategory): string {
  return PROBLEM_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export const RunSettingsPanel = memo(function RunSettingsPanel({
  config,
  onConfigChange,
  onRun,
  onCancelRun,
  onSelectRun,
  activeRuns,
}: Props) {
  const [settingsOpen, setSettingsOpen] = useState(loadRunSettingsOpen);
  const [tooltipAnchor, setTooltipAnchor] = useState<TooltipAnchor | null>(
    null,
  );

  const costEstimate = useMemo(
    () =>
      estimateExperimentCost({
        runModel: config.runModel,
        evaluationModel: config.evaluationModel,
        problemCount: config.problemCount,
        maxTurns: config.maxTurns,
        // Evaluation is post-hoc; Run settings only estimate conversation cost.
        evaluationEnabled: false,
      }),
    [
      config.runModel,
      config.evaluationModel,
      config.problemCount,
      config.maxTurns,
    ],
  );

  const hoveredRun = activeRuns.find((r) => r.id === tooltipAnchor?.runId);
  const hoveredConfig = hoveredRun?.config;
  const hoveredPolicy = hoveredRun?.policy;

  function showTooltip(runId: string, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    setTooltipAnchor({
      runId,
      left: rect.left + rect.width / 2,
      top: rect.bottom + 6,
    });
  }

  function hideTooltip(runId: string) {
    setTooltipAnchor((prev) => (prev?.runId === runId ? null : prev));
  }

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
                  <span>{displayNameForModel(config.runModel)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{config.maxTurns} turns</span>
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

              <div className="run-settings__section">
                <h3 className="run-settings__section-title">
                  Agent configuration
                </h3>
                <ModelSelect
                  label="Conversation model"
                  purpose="run"
                  value={config.runModel}
                  onChange={(runModel) => onConfigChange({ runModel })}
                  reasoningEffort={config.runReasoningEffort}
                  onReasoningEffortChange={(runReasoningEffort) =>
                    onConfigChange({ runReasoningEffort })
                  }
                  labelTrailing={
                    <span className="model-select__estimate muted">
                      Estimated conversation cost{" "}
                      <span className="mono">
                        {formatEstimatedCostRange(costEstimate)}
                      </span>
                    </span>
                  }
                />
              </div>

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
                <span>Maximum interaction turns</span>
                <NumberStepper
                  min={MIN_INTERACTION_TURNS}
                  max={MAX_INTERACTION_TURNS}
                  value={config.maxTurns}
                  onChange={(maxTurns) => onConfigChange({ maxTurns })}
                />
              </label>

              <label className="slider-field">
                <div className="slider-field__top">
                  <span className="slider-field__label">Information overlap</span>
                  <span className="slider-field__value mono">
                    {Math.round((config.informationOverlap ?? 1) * 100)}%
                  </span>
                </div>
                <input
                  className="range"
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={Math.round((config.informationOverlap ?? 1) * 100)}
                  onChange={(e) =>
                    onConfigChange({
                      informationOverlap: Number(e.target.value) / 100,
                    })
                  }
                  aria-valuetext={`${Math.round((config.informationOverlap ?? 1) * 100)} percent overlap`}
                />
                <span className="slider-field__hint muted">
                  50% Fully partitioned · 70% Partial overlap · 100% Same
                  information
                </span>
              </label>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="run-button"
          aria-label="Run"
          onClick={onRun}
        >
          <span className="run-button__label">Run</span>
        </button>

        {activeRuns.length > 0 ? (
          <div className="run-medallions-wrap">
            <div className="run-medallions" role="list" aria-label="Active runs">
              {activeRuns.map((run) => {
                const progressPct = Math.round(
                  (run.progress.fraction ?? 0) * 100,
                );
                const label = run.title?.trim() || "Run";
                return (
                  <div
                    key={run.id}
                    role="listitem"
                    className={
                      run.selected
                        ? "run-medallion run-medallion--selected"
                        : "run-medallion"
                    }
                    style={
                      {
                        "--run-progress": `${progressPct}%`,
                      } as CSSProperties
                    }
                    onMouseEnter={(e) =>
                      showTooltip(run.id, e.currentTarget)
                    }
                    onMouseLeave={() => hideTooltip(run.id)}
                  >
                    <button
                      type="button"
                      className="run-medallion__body"
                      aria-label={`${label}, ${progressPct}% complete`}
                      onClick={() => onSelectRun?.(run.id)}
                    >
                      <span className="run-medallion__fill" aria-hidden="true" />
                      <span className="run-medallion__pct" aria-hidden="true">
                        {progressPct}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="run-medallion__cancel"
                      aria-label={`Cancel ${label}`}
                      title="Cancel"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCancelRun(run.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {tooltipAnchor &&
          hoveredRun &&
          hoveredConfig &&
          createPortal(
            <div
              className="run-medallion__tooltip"
              role="tooltip"
              style={{
                left: tooltipAnchor.left,
                top: tooltipAnchor.top,
              }}
            >
              <div className="run-medallion__tooltip-title">
                {hoveredRun.title?.trim() || "Run"}
                <span className="muted">
                  {" "}
                  · {Math.round((hoveredRun.progress.fraction ?? 0) * 100)}%
                </span>
              </div>
              <dl className="run-medallion__tooltip-settings">
                <div>
                  <dt>Category</dt>
                  <dd>{categoryLabel(hoveredConfig.problemCategory)}</dd>
                </div>
                <div>
                  <dt>Problems</dt>
                  <dd>{hoveredConfig.problemCount}</dd>
                </div>
                <div>
                  <dt>Model</dt>
                  <dd>{displayNameForModel(hoveredConfig.runModel)}</dd>
                </div>
                <div>
                  <dt>Turns</dt>
                  <dd>{hoveredConfig.maxTurns}</dd>
                </div>
                <div>
                  <dt>Reasoning</dt>
                  <dd>{hoveredConfig.runReasoningEffort}</dd>
                </div>
              </dl>
              {hoveredPolicy ? (
                <>
                  <div className="run-medallion__tooltip-divider" />
                  <dl className="run-medallion__tooltip-settings">
                    <div>
                      <dt>Trust A→B</dt>
                      <dd className="mono">
                        {formatPolicyValue(hoveredPolicy.trustA)}
                      </dd>
                    </div>
                    <div>
                      <dt>Trust B→A</dt>
                      <dd className="mono">
                        {formatPolicyValue(hoveredPolicy.trustB)}
                      </dd>
                    </div>
                    <div>
                      <dt>Authority</dt>
                      <dd className="mono">
                        {formatPolicyValue(hoveredPolicy.authority)}
                      </dd>
                    </div>
                    <div>
                      <dt>Familiarity</dt>
                      <dd className="mono">
                        {formatPolicyValue(hoveredPolicy.familiarity)}
                      </dd>
                    </div>
                  </dl>
                </>
              ) : null}
            </div>,
            document.body,
          )}

        {!settingsOpen ? (
          <p className="run-button__estimate muted">
            Estimated conversation cost:{" "}
            <span className="mono">{formatEstimatedCostRange(costEstimate)}</span>
          </p>
        ) : null}
      </section>
    </div>
  );
});
