import { useState } from "react";
import { TextPreviewModal } from "../ui/TextPreviewModal";

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
        <TextPreviewModal
          title="Agent A Instantiation"
          text={agentAPrompt}
          onClose={() => setOpenPrompt(null)}
        />
      ) : null}
      {openPrompt === "B" ? (
        <TextPreviewModal
          title="Agent B Instantiation"
          text={agentBPrompt}
          onClose={() => setOpenPrompt(null)}
        />
      ) : null}
    </div>
  );
}
