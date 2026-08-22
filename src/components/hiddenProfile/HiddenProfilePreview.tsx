import type { HiddenProfileSpec } from "../../problems/hidden_profile/types";

/**
 * Researcher-facing Hidden Profile packet view.
 * Shows all information; agents never see this combined layout.
 */
export function HiddenProfilePreview({
  spec,
  selected,
  gold,
  correct,
}: {
  spec: HiddenProfileSpec;
  selected?: string;
  gold?: string;
  correct?: boolean;
}) {
  const shared = spec.information.filter((u) => u.visibility === "shared");
  const aOnly = spec.information.filter((u) => u.visibility === "a_private");
  const bOnly = spec.information.filter((u) => u.visibility === "b_private");

  return (
    <div className="hidden-profile-preview">
      <section className="hidden-profile-preview__section">
        <h4>Task / Decision</h4>
        <p>{spec.question}</p>
      </section>

      <section className="hidden-profile-preview__section">
        <h4>Options</h4>
        <ul>
          {spec.options.map((option) => (
            <li key={option}>{option}</li>
          ))}
        </ul>
      </section>

      <section className="hidden-profile-preview__section">
        <h4>Shared information</h4>
        <ul className="mono">
          {shared.map((unit) => (
            <li key={unit.id}>
              <strong>{unit.id}</strong> {unit.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="hidden-profile-preview__section">
        <h4>Agent A only</h4>
        <ul className="mono">
          {aOnly.map((unit) => (
            <li key={unit.id}>
              <strong>{unit.id}</strong> {unit.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="hidden-profile-preview__section">
        <h4>Agent B only</h4>
        <ul className="mono">
          {bOnly.map((unit) => (
            <li key={unit.id}>
              <strong>{unit.id}</strong> {unit.text}
            </li>
          ))}
        </ul>
      </section>

      {(selected !== undefined || gold !== undefined) && (
        <section className="hidden-profile-preview__section hidden-profile-preview__final">
          <h4>Final decision</h4>
          <div className="mono">
            <div>Gold: {gold ?? spec.goldAnswer}</div>
            <div>Selected: {selected ?? "—"}</div>
            <div>
              Correct:{" "}
              {correct === undefined ? "—" : correct ? "yes" : "no"}
            </div>
          </div>
          <p className="muted">
            Evaluator metadata (evidence structure, strengths) is not shown to
            agents.
          </p>
        </section>
      )}

      {spec.hiddenBench ? (
        <section className="hidden-profile-preview__section muted mono">
          <h4>Source</h4>
          <div>
            {spec.hiddenBench.dataset} · task #{spec.hiddenBench.sourceTaskId}{" "}
            ({spec.hiddenBench.sourceTaskName}) · commit{" "}
            {spec.hiddenBench.datasetVersion} · original agents{" "}
            {spec.hiddenBench.sourceAgentCount} · partition{" "}
            {spec.hiddenBench.dyadicPartition}
          </div>
        </section>
      ) : null}
    </div>
  );
}
