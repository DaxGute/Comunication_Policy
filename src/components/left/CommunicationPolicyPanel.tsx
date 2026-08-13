import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useState } from "react";
import {
  authorityWeightA,
  authorityWeightB,
  describeAuthoritySlider,
  formatPolicyValue,
} from "../../communication";
import type { CommunicationPolicy } from "../../communication/types";
import { AgentPromptInspector } from "./AgentPromptInspector";

type Props = {
  policy: CommunicationPolicy;
  onChange: (partial: Partial<CommunicationPolicy>) => void;
  agentAPrompt: string;
  agentBPrompt: string;
};

export function CommunicationPolicyPanel({
  policy,
  onChange,
  agentAPrompt,
  agentBPrompt,
}: Props) {
  const aAuth = authorityWeightA(policy.authority);
  const bAuth = authorityWeightB(policy.authority);

  return (
    <section className="panel-section">
      <header className="panel-section__header">
        <h2>Communication Policy</h2>
        <p className="muted">
          Independent variable. Changes rewrite only the compiled
          communication-policy section — not identity, task, protocol, model,
          or expertise.
        </p>
      </header>

      <div className="slider-stack">
        <div className="policy-group">
          <div className="policy-group__title">Trust</div>
          <p className="policy-group__hint muted">
            Layered controls — warm = A→B, blue = B→A.
          </p>

          <div className="slider-field">
            <div className="slider-field__top">
              <span className="slider-field__label authority-split-labels">
                <span className="agent-tag agent-tag--a">
                  A→B {formatPolicyValue(policy.trustA)}
                </span>
                <span className="agent-tag agent-tag--b">
                  B→A {formatPolicyValue(policy.trustB)}
                </span>
              </span>
            </div>

            <LayeredTrustSlider
              trustA={policy.trustA}
              trustB={policy.trustB}
              onChangeA={(trustA) => onChange({ trustA })}
              onChangeB={(trustB) => onChange({ trustB })}
            />

            <span className="slider-field__hint muted">
              Independent verification ↔ collaborative synthesis
            </span>
          </div>
        </div>

        <div className="policy-group">
          <div className="policy-group__title">Authority</div>
          <p className="policy-group__hint muted">
            Split continuum — warm = A weight, blue = B weight.
          </p>

          <label className="slider-field">
            <div className="slider-field__top">
              <span className="slider-field__label authority-split-labels">
                <span className="agent-tag agent-tag--a">
                  A {formatPolicyValue(aAuth)}
                </span>
                <span className="agent-tag agent-tag--b">
                  B {formatPolicyValue(bAuth)}
                </span>
              </span>
              <span className="slider-field__value mono">
                {formatPolicyValue(policy.authority)}
              </span>
            </div>
            <input
              className="range range--authority"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={policy.authority}
              onChange={(e) => onChange({ authority: Number(e.target.value) })}
              style={
                {
                  "--authority-pos": `${policy.authority * 100}%`,
                } as CSSProperties
              }
            />
            <span className="slider-field__hint muted">
              {describeAuthoritySlider(policy.authority)} · 0 = A over B · 1 = B
              over A
            </span>
          </label>
        </div>

        <div className="policy-group">
          <div className="policy-group__title">Familiarity</div>
          <p className="policy-group__hint muted">
            Shared history continuum — strangers to long-term collaborators.
          </p>

          <label className="slider-field">
            <div className="slider-field__top">
              <span className="slider-field__label">Level</span>
              <span className="slider-field__value mono">
                {formatPolicyValue(policy.familiarity)}
              </span>
            </div>
            <input
              className="range range--familiarity"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={policy.familiarity}
              onChange={(e) =>
                onChange({ familiarity: Number(e.target.value) })
              }
              style={
                {
                  "--familiarity-pos": `${policy.familiarity * 100}%`,
                } as CSSProperties
              }
            />
            <span className="slider-field__hint muted">
              Strangers (explicit) ↔ long-term collaborators (compressed)
            </span>
          </label>
        </div>
      </div>

      <AgentPromptInspector
        agentAPrompt={agentAPrompt}
        agentBPrompt={agentBPrompt}
      />
    </section>
  );
}

function LayeredTrustSlider({
  trustA,
  trustB,
  onChangeA,
  onChangeB,
}: {
  trustA: number;
  trustB: number;
  onChangeA: (value: number) => void;
  onChangeB: (value: number) => void;
}) {
  const [active, setActive] = useState<"a" | "b">("a");

  function preferCloserThumb(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const distA = Math.abs(ratio - trustA);
    const distB = Math.abs(ratio - trustB);
    setActive(distA <= distB ? "a" : "b");
  }

  return (
    <div
      className="layered-trust"
      style={
        {
          "--trust-a": `${trustA * 100}%`,
          "--trust-b": `${trustB * 100}%`,
          "--trust-overlap": `${Math.min(trustA, trustB) * 100}%`,
        } as CSSProperties
      }
      onPointerDown={preferCloserThumb}
    >
      <div className="layered-trust__track" aria-hidden="true">
        <div className="layered-trust__fill layered-trust__fill--a" />
        <div className="layered-trust__fill layered-trust__fill--b" />
        <div className="layered-trust__fill layered-trust__fill--overlap" />
      </div>

      <input
        className={
          active === "a"
            ? "layered-trust__input layered-trust__input--a layered-trust__input--front"
            : "layered-trust__input layered-trust__input--a"
        }
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={trustA}
        aria-label="Agent A trust toward Agent B"
        onChange={(e) => onChangeA(Number(e.target.value))}
        onPointerDown={() => setActive("a")}
        onFocus={() => setActive("a")}
      />
      <input
        className={
          active === "b"
            ? "layered-trust__input layered-trust__input--b layered-trust__input--front"
            : "layered-trust__input layered-trust__input--b"
        }
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={trustB}
        aria-label="Agent B trust toward Agent A"
        onChange={(e) => onChangeB(Number(e.target.value))}
        onPointerDown={() => setActive("b")}
        onFocus={() => setActive("b")}
      />
    </div>
  );
}
