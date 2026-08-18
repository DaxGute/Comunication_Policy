import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onCommit: (next: string) => void;
  /** Called when the user starts editing (e.g. to select the parent row). */
  onEditStart?: () => void;
  /**
   * When false, click/Enter only fires `onEditStart` (select the row)
   * without entering rename mode. Default true.
   */
  allowEditOnClick?: boolean;
  /** When true, mount already in rename mode (used for newly created folders). */
  autoEdit?: boolean;
  /** Called when rename mode closes (commit or cancel). */
  onEditEnd?: () => void;
  className?: string;
  inputClassName?: string;
  ariaLabel?: string;
  as?: "span" | "h3";
};

/**
 * Click-to-rename text. Enter/blur commits; Escape cancels.
 * Empty commits are ignored (previous value kept).
 */
export function InlineEditableText({
  value,
  onCommit,
  onEditStart,
  allowEditOnClick = true,
  autoEdit = false,
  onEditEnd,
  className,
  inputClassName,
  ariaLabel,
  as: Tag = "span",
}: Props) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommit = useRef(false);

  useEffect(() => {
    if (!editing) return;
    setDraft(value);
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing, value]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    onEditEnd?.();
    if (next && next !== value) onCommit(next);
  }

  function cancel() {
    skipBlurCommit.current = true;
    setDraft(value);
    setEditing(false);
    onEditEnd?.();
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName ?? "inline-editable__input"}
        value={draft}
        aria-label={ariaLabel ?? "Rename"}
        onChange={(e) => setDraft(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={() => {
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            return;
          }
          commit();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <Tag
      className={className ?? "inline-editable"}
      title="Click to rename"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? `Rename ${value}`}
      onClick={(e) => {
        e.stopPropagation();
        onEditStart?.();
        if (allowEditOnClick) setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onEditStart?.();
          if (allowEditOnClick) setEditing(true);
        }
      }}
    >
      {value}
    </Tag>
  );
}
