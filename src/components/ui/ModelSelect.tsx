import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  formatReasoningEffort,
  getModelDefinition,
  modelSelectGroups,
  modelSupportsReasoningEffort,
  REASONING_EFFORTS,
  tierLabel,
  type ReasoningEffort,
} from "../../models/modelRegistry";

type Purpose = "run" | "evaluation";

type ModelSelectProps = {
  label: string;
  purpose: Purpose;
  value: string;
  onChange: (modelId: string) => void;
  reasoningEffort?: ReasoningEffort;
  onReasoningEffortChange?: (effort: ReasoningEffort) => void;
  /** Optional right-side content on the label row (e.g. estimated cost). */
  labelTrailing?: ReactNode;
  /** Hide the text label when the parent already provides a section title. */
  hideLabel?: boolean;
  disabled?: boolean;
};

function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function ModelInfoTooltip({ modelId }: { modelId: string }) {
  const model = getModelDefinition(modelId);
  if (!model) return null;
  return (
    <div className="model-select__tooltip" role="tooltip">
      <div className="model-select__tooltip-title">{model.displayName}</div>
      <div className="model-select__tooltip-tier muted">
        {tierLabel(model.tier)}
      </div>
      <p>{model.infoBlurb}</p>
      <ul className="model-select__tooltip-prices mono">
        <li>{formatPrice(model.inputPricePerMillion)} / 1M input</li>
        {typeof model.cachedInputPricePerMillion === "number" ? (
          <li>
            {formatPrice(model.cachedInputPricePerMillion)} / 1M cached input
          </li>
        ) : null}
        <li>{formatPrice(model.outputPricePerMillion)} / 1M output</li>
      </ul>
    </div>
  );
}

export function ModelSelect({
  label,
  purpose,
  value,
  onChange,
  reasoningEffort,
  onReasoningEffortChange,
  labelTrailing,
  hideLabel,
  disabled,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = getModelDefinition(value);
  const groups = modelSelectGroups(purpose);
  const showReasoning =
    typeof reasoningEffort !== "undefined" &&
    typeof onReasoningEffortChange === "function" &&
    modelSupportsReasoningEffort(value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="model-select" ref={rootRef}>
      {!hideLabel || labelTrailing ? (
        <div className="model-select__label-row">
          <div className="model-select__label-main">
            {!hideLabel ? (
              <span className="model-select__label">{label}</span>
            ) : null}
            {!hideLabel ? (
              <details className="model-select__info">
                <summary aria-label={`About ${selected?.displayName ?? value}`}>
                  i
                </summary>
                <ModelInfoTooltip modelId={value} />
              </details>
            ) : null}
          </div>
          {labelTrailing ? (
            <div className="model-select__label-trailing">{labelTrailing}</div>
          ) : null}
        </div>
      ) : null}
      <div className="model-select__row">
        {hideLabel ? (
          <details className="model-select__info model-select__info--inline">
            <summary aria-label={`About ${selected?.displayName ?? value}`}>
              i
            </summary>
            <ModelInfoTooltip modelId={value} />
          </details>
        ) : null}
        <button
          type="button"
          className="model-select__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="model-select__trigger-main">
            <span className="model-select__name">
              {selected?.displayName ?? value}
            </span>
            {selected?.shortLabel ? (
              <span className="model-select__cost muted">
                {selected.shortLabel}
              </span>
            ) : null}
          </span>
          <svg
            className="model-select__chevron"
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
        {showReasoning ? (
          <label className="model-select__reasoning">
            <span className="visually-hidden">Reasoning</span>
            <select
              value={reasoningEffort}
              disabled={disabled}
              aria-label="Reasoning"
              onChange={(e) =>
                onReasoningEffortChange(e.target.value as ReasoningEffort)
              }
            >
              {REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {formatReasoningEffort(effort)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {open ? (
        <div className="model-select__menu" id={listId} role="listbox">
          {groups.map((group, groupIndex) => (
            <div key={group.id} className="model-select__group">
              {groupIndex > 0 ? (
                <div className="model-select__divider" role="separator" />
              ) : null}
              <div className="model-select__group-label muted">{group.label}</div>
              {group.models.map((model) => {
                const isSelected = model.id === value;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={
                      isSelected
                        ? "model-select__option model-select__option--selected"
                        : "model-select__option"
                    }
                    onClick={() => {
                      onChange(model.id);
                      setOpen(false);
                    }}
                  >
                    <span className="model-select__option-name">
                      {model.displayName}
                      {model.tier === "recommended" ? (
                        <span className="model-select__badge">Recommended</span>
                      ) : null}
                    </span>
                    <span className="model-select__option-cost muted">
                      {model.shortLabel}
                    </span>
                    <span className="model-select__option-desc muted">
                      {model.tier === "cheap"
                        ? "Fast / cheap"
                        : model.tier === "recommended"
                          ? "Recommended"
                          : model.tier === "max"
                            ? "Maximum capability"
                            : model.tier === "baseline" &&
                                model.id.includes("nano")
                              ? "Weak baseline"
                              : "Legacy baseline"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
