import { useEffect, useId, useMemo, useRef, useState } from "react";
import { axisMetricLabel, type AxisMetricGroup } from "./axisMetrics";

type Props = {
  label: string;
  groups: AxisMetricGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
  align?: "start" | "end";
};

export function ColumnMenu({
  label,
  groups,
  selected,
  onChange,
  align = "start",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const totalAvailable = groups.reduce((n, g) => n + g.metrics.length, 0);
  const showSearch = totalAvailable > 8;

  const preview = useMemo(() => {
    if (selected.length === 0) return "None";
    const names = selected.map(axisMetricLabel);
    if (names.length <= 2) return names.join(" · ");
    return `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;
  }, [selected]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => ({
        ...group,
        metrics: group.metrics.filter((metric) =>
          metric.label.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.metrics.length > 0);
  }, [groups, query]);

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

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function toggle(id: string) {
    if (selectedSet.has(id)) {
      onChange(selected.filter((x) => x !== id));
      return;
    }
    onChange([...selected, id]);
  }

  function setGroup(group: AxisMetricGroup, on: boolean) {
    const ids = new Set(group.metrics.map((m) => m.id));
    if (on) {
      const next = [...selected];
      for (const id of ids) {
        if (!selectedSet.has(id)) next.push(id);
      }
      onChange(next);
      return;
    }
    onChange(selected.filter((id) => !ids.has(id)));
  }

  return (
    <div
      className={
        align === "end"
          ? "center-col-menu center-col-menu--end"
          : "center-col-menu"
      }
      ref={rootRef}
    >
      <button
        type="button"
        className={
          open
            ? "center-col-menu__trigger is-open"
            : "center-col-menu__trigger"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="center-col-menu__copy">
          <span className="center-col-menu__kicker">{label}</span>
          <span className="center-col-menu__preview">{preview}</span>
        </span>
        <span className="center-col-menu__meta">
          <span className="center-col-menu__count">{selected.length}</span>
          <svg
            className="center-col-menu__chevron"
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
        </span>
      </button>
      {open ? (
        <div className="center-col-menu__panel" id={panelId} role="menu">
          {showSearch ? (
            <input
              className="center-col-menu__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter columns"
              aria-label={`Filter ${label.toLowerCase()} columns`}
            />
          ) : null}
          {filteredGroups.length === 0 ? (
            <p className="center-col-menu__empty muted">No matching columns.</p>
          ) : (
            filteredGroups.map((group, i) => {
              const onCount = group.metrics.filter((m) =>
                selectedSet.has(m.id),
              ).length;
              const allOn = onCount === group.metrics.length;
              return (
                <div key={group.id} className="center-col-menu__section">
                  {i > 0 ? (
                    <div className="center-col-menu__divider" role="separator" />
                  ) : null}
                  <div className="center-col-menu__group">
                    <span>{group.label}</span>
                    <button
                      type="button"
                      className="center-col-menu__group-btn"
                      onClick={() => setGroup(group, !allOn)}
                    >
                      {allOn ? "None" : "All"}
                    </button>
                  </div>
                  {group.metrics.map((metric) => {
                    const on = selectedSet.has(metric.id);
                    return (
                      <button
                        key={metric.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={on}
                        className={
                          on
                            ? "center-col-menu__option is-on"
                            : "center-col-menu__option"
                        }
                        onClick={() => toggle(metric.id)}
                      >
                        <span className="center-col-menu__tick" aria-hidden />
                        {metric.label}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
