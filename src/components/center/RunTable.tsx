import { useMemo, useState } from "react";
import type { RunSummary } from "./centerAdapter";
import { formatMetricValue } from "./centerAdapter";
import { axisMetricLabel } from "./axisMetrics";

type SortKey = "title" | "status" | string;
type SortDir = "asc" | "desc";

type Props = {
  runs: RunSummary[];
  policyColumns: string[];
  metricColumns: string[];
  selectedId?: string;
  onSelect: (runId: string) => void;
};

function cmpStr(a: string, b: string, dir: SortDir): number {
  const c = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? c : -c;
}

function cmpNum(a: number | undefined, b: number | undefined, dir: SortDir): number {
  const aMiss = typeof a !== "number";
  const bMiss = typeof b !== "number";
  if (aMiss && bMiss) return 0;
  if (aMiss) return 1;
  if (bMiss) return -1;
  return dir === "asc" ? a - b : b - a;
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  className,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  className?: string;
  onSort: (column: SortKey) => void;
}) {
  const active = sortKey === column;
  return (
    <th
      className={className}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="center-run-table__sort"
        onClick={() => onSort(column)}
      >
        {label}
        {active ? (
          <span className="center-run-table__sort-ind" aria-hidden>
            {sortDir === "asc" ? "↑" : "↓"}
          </span>
        ) : null}
      </button>
    </th>
  );
}

export function RunTable({
  runs,
  policyColumns,
  metricColumns,
  selectedId,
  onSelect,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function onSort(column: SortKey) {
    if (sortKey === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(column);
    setSortDir(column === "title" || column === "status" ? "asc" : "desc");
  }

  const rows = useMemo(() => {
    const base = [...runs].reverse();
    if (!sortKey) return base;
    return [...base].sort((a, b) => {
      if (sortKey === "title") return cmpStr(a.title, b.title, sortDir);
      if (sortKey === "status") return cmpStr(a.status, b.status, sortDir);
      return cmpNum(a.metrics[sortKey], b.metrics[sortKey], sortDir);
    });
  }, [runs, sortKey, sortDir]);

  return (
    <div className="center-run-table-wrap">
      <table className="center-run-table">
        <thead>
          <tr>
            <SortHeader
              label="Run"
              column="title"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortHeader
              label="Status"
              column="status"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            {policyColumns.map((id, i) => (
              <SortHeader
                key={id}
                label={axisMetricLabel(id)}
                column={id}
                sortKey={sortKey}
                sortDir={sortDir}
                className={i === 0 ? "center-run-table__group-start" : undefined}
                onSort={onSort}
              />
            ))}
            {metricColumns.map((id, i) => (
              <SortHeader
                key={id}
                label={axisMetricLabel(id)}
                column={id}
                sortKey={sortKey}
                sortDir={sortDir}
                className={i === 0 ? "center-run-table__group-start" : undefined}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((run) => {
            const selected = run.runId === selectedId;
            return (
              <tr
                key={run.runId}
                className={selected ? "is-selected" : undefined}
                onClick={() => onSelect(run.runId)}
              >
                <td>{run.title}</td>
                <td>
                  <span className={`center-status center-status--${run.status}`}>
                    {run.status}
                  </span>
                </td>
                {policyColumns.map((id, i) => {
                  const v = run.metrics[id];
                  return (
                    <td
                      key={id}
                      className={[
                        "mono",
                        i === 0 ? "center-run-table__group-start" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {typeof v === "number" ? formatMetricValue(id, v) : "—"}
                    </td>
                  );
                })}
                {metricColumns.map((id, i) => {
                  const v = run.metrics[id];
                  return (
                    <td
                      key={id}
                      className={[
                        "mono",
                        i === 0 ? "center-run-table__group-start" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {typeof v === "number" ? formatMetricValue(id, v) : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
