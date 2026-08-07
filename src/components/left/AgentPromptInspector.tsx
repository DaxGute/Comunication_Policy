import { useEffect, useId, useState } from "react";

type Props = {
  agentAPrompt: string;
  agentBPrompt: string;
};

export function AgentPromptInspector({ agentAPrompt, agentBPrompt }: Props) {
  const [openPrompt, setOpenPrompt] = useState<"A" | "B" | null>(null);

  return (
    <div className="prompt-inspector">
      <div className="prompt-inspector__actions">
        <button
          type="button"
          className="prompt-open-button"
          onClick={() => setOpenPrompt("A")}
        >
          Agent A Instantiation
        </button>
        <button
          type="button"
          className="prompt-open-button"
          onClick={() => setOpenPrompt("B")}
        >
          Agent B Instantiation
        </button>
      </div>

      {openPrompt === "A" ? (
        <PromptModal
          title="Agent A Instantiation"
          text={agentAPrompt}
          onClose={() => setOpenPrompt(null)}
        />
      ) : null}
      {openPrompt === "B" ? (
        <PromptModal
          title="Agent B Instantiation"
          text={agentBPrompt}
          onClose={() => setOpenPrompt(null)}
        />
      ) : null}
    </div>
  );
}

function PromptModal({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
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
