import { useEffect, useId, useState } from "react";

type Props = {
  title: string;
  text: string;
  onClose: () => void;
};

/** Modal that shows plain text with Copy / Close, matching Agent Instantiation. */
export function TextPreviewModal({ title, text, onClose }: Props) {
  const titleId = useId();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="prompt-modal" role="presentation" onClick={onClose}>
      <div
        className="prompt-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="prompt-modal__toolbar">
          <h3 id={titleId} className="prompt-modal__title">
            {title}
          </h3>
          <div className="prompt-modal__actions">
            <button type="button" className="prompt-modal__button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="prompt-modal__button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <pre className="prompt-modal__body">{text}</pre>
      </div>
    </div>
  );
}
