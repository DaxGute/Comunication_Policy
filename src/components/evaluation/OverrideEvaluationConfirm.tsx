import { useId, useState } from "react";

type Props = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function OverrideEvaluationConfirm({
  message,
  onConfirm,
  onCancel,
}: Props) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const canConfirm = value.trim().toLowerCase() === "yes";

  return (
    <div className="eval-override">
      <p className="eval-override__message">{message}</p>
      <div className="eval-override__row">
        <label className="eval-override__label" htmlFor={inputId}>
          Type <span className="mono">yes</span> to override
        </label>
        <input
          id={inputId}
          className="eval-override__input"
          type="text"
          value={value}
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="yes"
          aria-label="Type yes to override the completed evaluation"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canConfirm) onConfirm();
            if (event.key === "Escape") onCancel();
          }}
        />
        <button
          type="button"
          className="eval-override__confirm"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          Override
        </button>
        <button
          type="button"
          className="eval-override__cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
