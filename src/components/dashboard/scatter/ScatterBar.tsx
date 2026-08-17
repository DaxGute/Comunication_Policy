/**
 * Legend/status strip under 2D and 3D scatter plots.
 */
export function ScatterBar({ legend, status }: { legend: string; status?: string }) {
  return (
    <div className="center-scatter__bar">
      <span className="center-scatter__bar-legend" title={legend}>
        {legend}
      </span>
      {status ? (
        <span className="center-scatter__bar-meta">{status}</span>
      ) : null}
    </div>
  );
}

