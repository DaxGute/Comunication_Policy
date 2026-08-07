type Props = {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function clamp(n: number, min?: number, max?: number): number {
  let next = n;
  if (typeof min === "number") next = Math.max(min, next);
  if (typeof max === "number") next = Math.min(max, next);
  return next;
}

export function NumberStepper({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
}: Props) {
  const bump = (delta: number) => {
    if (disabled) return;
    const raw = Number((value + delta).toFixed(6));
    onChange(clamp(raw, min, max));
  };

  return (
    <div
      className={
        disabled ? "number-stepper number-stepper--disabled" : "number-stepper"
      }
    >
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (disabled) return;
          const next = Number(e.target.value);
          if (!Number.isFinite(next)) return;
          onChange(clamp(next, min, max));
        }}
      />
      <div className="number-stepper__controls" aria-hidden="true">
        <button
          type="button"
          className="number-stepper__btn"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => bump(step)}
        >
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path
              d="M1.5 4.5 5 1.5l3.5 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="number-stepper__btn"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => bump(-step)}
        >
          <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
            <path
              d="M1.5 1.5 5 4.5l3.5-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
