/**
 * Small inspector chrome shared by the run tree, transcript, and results panes.
 */
export function InspectorBusySpinner({
  kind,
}: {
  kind: "run" | "analysis";
}) {
  const analysis = kind === "analysis";
  return (
    <span
      className={
        analysis
          ? "conv-tree__problem-spinner conv-tree__problem-spinner--analysis"
          : "conv-tree__problem-spinner"
      }
      aria-label={analysis ? "Analyzing" : "Running"}
      title={analysis ? "Analyzing" : "Running"}
    />
  );
}

export function RunWarningBanner({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="run-warning-banner" role="status">
      <strong className="run-warning-banner__title">{title}</strong>
      <p className="run-warning-banner__message">{message}</p>
    </div>
  );
}

export function CopyJsonButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="transcript__copy-json"
      onClick={onClick}
      aria-label={label}
    >
      <svg
        className="transcript__copy-json-icon"
        width="14"
        height="14"
        viewBox="0 0 16 16"
        aria-hidden="true"
      >
        <rect
          x="5.5"
          y="5.5"
          width="8"
          height="8"
          rx="1.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
        <path
          d="M10.5 5.5V4.25A1.25 1.25 0 0 0 9.25 3H4.25A1.25 1.25 0 0 0 3 4.25v5A1.25 1.25 0 0 0 4.25 10.5H5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
      {label}
    </button>
  );
}
