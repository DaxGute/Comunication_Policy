import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Props = {
  direction: "horizontal" | "vertical";
  children: ReactNode;
  /** Relative sizes (need not sum to 100). */
  initialSizes: number[];
  /** Per-pane minimum size in pixels. */
  minSizesPx?: number[];
  /** Persist sizes in localStorage under this key. */
  storageKey?: string;
  className?: string;
};

function normalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (sum <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => s / sum);
}

function loadSizes(key: string | undefined, fallback: number[]): number[] {
  const normalizedFallback = normalize(fallback);
  if (!key) return normalizedFallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return normalizedFallback;
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length === fallback.length &&
      parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    ) {
      return normalize(parsed);
    }
  } catch {
    /* ignore corrupt storage */
  }
  return normalizedFallback;
}

export function ResizableSplit({
  direction,
  children,
  initialSizes,
  minSizesPx,
  storageKey,
  className,
}: Props) {
  const panes = Children.toArray(children).filter(Boolean);
  const paneCount = panes.length;

  const containerRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState(() =>
    loadSizes(storageKey, initialSizes.slice(0, paneCount)),
  );
  const dragRef = useRef<{
    index: number;
    startPos: number;
    startSizes: number[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(sizes));
    } catch {
      /* ignore quota / private mode */
    }
  }, [sizes, storageKey]);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;

      const rect = container.getBoundingClientRect();
      const totalPx =
        direction === "horizontal" ? rect.width : rect.height;
      if (totalPx <= 0) return;

      const handleCount = paneCount - 1;
      const handlePx = handleCount * 6;
      const available = Math.max(1, totalPx - handlePx);

      const pos = direction === "horizontal" ? event.clientX : event.clientY;
      const deltaPx = pos - drag.startPos;

      const startPx = drag.startSizes.map((s) => s * available);
      const i = drag.index;
      const minL = minSizesPx?.[i] ?? 120;
      const minR = minSizesPx?.[i + 1] ?? 120;
      const pair = startPx[i]! + startPx[i + 1]!;

      let nextL = startPx[i]! + deltaPx;
      nextL = Math.max(minL, Math.min(nextL, pair - minR));
      const nextR = pair - nextL;

      const next = [...startPx];
      next[i] = nextL;
      next[i + 1] = nextR;
      setSizes(normalize(next));
    },
    [direction, minSizesPx, paneCount],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    document.body.classList.remove(
      "is-resizing-panes",
      "is-resizing-panes--horizontal",
      "is-resizing-panes--vertical",
    );
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onUp = () => endDrag();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, endDrag, onPointerMove]);

  if (paneCount < 2) {
    return (
      <div className={className} ref={containerRef}>
        {panes}
      </div>
    );
  }

  const template = sizes
    .flatMap((size, index) =>
      index < paneCount - 1 ? [`${size}fr`, "6px"] : [`${size}fr`],
    )
    .join(" ");

  const style =
    direction === "horizontal"
      ? { gridTemplateColumns: template }
      : { gridTemplateRows: template };

  const items: ReactNode[] = [];
  panes.forEach((pane, index) => {
    items.push(
      <div key={`pane-${index}`} className="resizable-split__pane">
        {pane}
      </div>,
    );
    if (index < paneCount - 1) {
      items.push(
        <div
          key={`handle-${index}`}
          className="resizable-split__handle"
          role="separator"
          aria-orientation={
            direction === "horizontal" ? "vertical" : "horizontal"
          }
          aria-label="Resize panes"
          onPointerDown={(event) => {
            event.preventDefault();
            dragRef.current = {
              index,
              startPos:
                direction === "horizontal" ? event.clientX : event.clientY,
              startSizes: [...sizes],
            };
            setDragging(true);
            document.body.classList.add(
              "is-resizing-panes",
              `is-resizing-panes--${direction}`,
            );
          }}
        />,
      );
    }
  });

  return (
    <div
      ref={containerRef}
      className={[
        "resizable-split",
        `resizable-split--${direction}`,
        dragging ? "resizable-split--dragging" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      {items}
    </div>
  );
}
