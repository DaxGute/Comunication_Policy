import type { MoralSpec } from "../../problems/moral/types";

type MoralPreviewProps = {
  moral: MoralSpec;
  /** Joint FINAL_ANSWER when the conversation has one. */
  answer?: string;
};

/**
 * Dilemma surface for the inspector header — scenario + question (+ answer),
 * analogous to the crossword board above run stats.
 */
export function MoralPreview({ moral, answer }: MoralPreviewProps) {
  const answerText = answer?.trim();

  return (
    <div className="moral-preview">
      {moral.title ? (
        <h4 className="moral-preview__title">{moral.title}</h4>
      ) : null}
      <section className="moral-preview__section">
        <h5 className="moral-preview__label">Scenario</h5>
        <p className="moral-preview__text">{moral.description}</p>
      </section>
      <section className="moral-preview__section">
        <h5 className="moral-preview__label">Question</h5>
        <p className="moral-preview__text">{moral.question}</p>
      </section>
      <section className="moral-preview__section">
        <h5 className="moral-preview__label">Answer</h5>
        {answerText ? (
          <p className="moral-preview__text moral-preview__answer">
            {answerText}
          </p>
        ) : (
          <p className="moral-preview__text muted">No final answer yet.</p>
        )}
      </section>
    </div>
  );
}
