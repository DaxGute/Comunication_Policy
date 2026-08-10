"""Post-hoc MultiAgentBench / MARBLE Graph evaluator.

Invokes the official MARBLE ``Evaluator`` methods on an externally generated
transcript. Does NOT run MARBLE's orchestration engine or environments.

Requires a MARBLE checkout (``MARBLE_ROOT``) and a Python env that can import
``marble`` (``MARBLE_PYTHON``, typically Summer_CESTA's ``.venv-marble``).

Pinned commit expectation is recorded by the TypeScript adapter metadata.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any

# Mirrors src/runtime/models.ts modelSupportsCustomTemperature.
_FIXED_TEMPERATURE_MODEL_RE = re.compile(r"^(gpt-5|o1|o3|o4)([.-]|$)", re.I)


def _is_fixed_temperature_model(model: str) -> bool:
    return bool(_FIXED_TEMPERATURE_MODEL_RE.match(model or ""))


def _patch_litellm_for_openai_reasoning_models() -> None:
    """Make MARBLE's LiteLLM calls compatible with GPT-5 / o-series.

    Those models reject non-default temperature and ``max_tokens`` (they require
    ``max_completion_tokens``). MARBLE hardcodes temperature=0.0 and max_tokens.
    """
    import litellm

    existing = litellm.completion
    if getattr(existing, "_comm_policy_reasoning_patch", False):
        return

    def completion(*args: Any, **kwargs: Any) -> Any:
        model = kwargs.get("model")
        if model is None and args:
            model = args[0]
        if isinstance(model, str) and _is_fixed_temperature_model(model):
            temperature = kwargs.get("temperature")
            if temperature is not None and temperature != 1:
                kwargs.pop("temperature", None)
            if "max_tokens" in kwargs:
                max_tokens = kwargs.pop("max_tokens")
                # Reasoning tokens share the completion budget; keep headroom.
                try:
                    budget = max(int(max_tokens or 512), 1024)
                except (TypeError, ValueError):
                    budget = 1024
                kwargs.setdefault("max_completion_tokens", budget)
        return existing(*args, **kwargs)

    completion._comm_policy_reasoning_patch = True  # type: ignore[attr-defined]
    litellm.completion = completion  # type: ignore[assignment]


def _resolve_marble_root() -> Path:
    env = os.environ.get("MARBLE_ROOT", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    here = Path(__file__).resolve()
    candidates = [
        here.parents[2] / "deps" / "MARBLE",
        here.parents[3] / "Summer_CESTA" / "deps" / "MARBLE",
        Path.home() / "Desktop" / "Summer_CESTA" / "deps" / "MARBLE",
    ]
    for path in candidates:
        if (path / "marble" / "evaluator" / "evaluator.py").exists():
            return path.resolve()
    raise FileNotFoundError(
        "MARBLE checkout not found. Set MARBLE_ROOT to a clone of "
        "https://github.com/ulab-uiuc/MARBLE (commit 8d60fa17…)."
    )


def _import_evaluator(marble_root: Path):
    sys.path.insert(0, str(marble_root))
    from marble.evaluator.evaluator import Evaluator  # type: ignore

    return Evaluator


class PosthocEvaluator:
    """Thin wrapper that retains KPI milestone payloads MARBLE otherwise drops."""

    def __init__(self, evaluator: Any) -> None:
        self.evaluator = evaluator
        self.milestones: list[dict[str, Any]] = []
        self.raw_responses: dict[str, str] = {}

    def evaluate_communication(self, task: str, communications: str) -> None:
        before = len(self.evaluator.metrics.get("communication_score") or [])
        self.evaluator.evaluate_communication(task, communications)
        after = self.evaluator.metrics.get("communication_score") or []
        if len(after) > before:
            self.raw_responses["communication"] = f'{{"rating": {after[-1]}}}'

    def evaluate_planning(
        self, summary: str, agent_profiles: str, agent_tasks: str, results: str
    ) -> None:
        before = len(self.evaluator.metrics.get("planning_score") or [])
        self.evaluator.evaluate_planning(summary, agent_profiles, agent_tasks, results)
        after = self.evaluator.metrics.get("planning_score") or []
        if len(after) > before:
            self.raw_responses["planning"] = f'{{"rating": {after[-1]}}}'

    def evaluate_kpi(self, task: str, agent_results: str) -> None:
        # Mirror Evaluator.evaluate_kpi but keep the milestone list.
        import json as _json

        MAX_LENGTH = 7200
        if len(agent_results) > MAX_LENGTH:
            agent_results = agent_results[:MAX_LENGTH] + "..."
        kpi_prompt_template = self.evaluator.evaluation_prompts["Graph"]["KPI"]["prompt"]
        prompt = kpi_prompt_template.format(task=task, agent_results=agent_results)
        from marble.llms.model_prompting import model_prompting  # type: ignore

        # temperature/max_tokens for GPT-5 are rewritten by the litellm patch.
        result = model_prompting(
            llm_model=self.evaluator.llm,
            messages=[{"role": "user", "content": prompt}],
            return_num=1,
            max_token_num=1024,
            temperature=0.0,
            top_p=None,
            stream=None,
        )[0]
        content = result.content if isinstance(result.content, str) else str(result.content)
        self.raw_responses["kpi"] = content
        milestones = self.evaluator.parse_milestones(content)
        self.milestones = milestones
        self.evaluator.metrics["total_milestones"] += len(milestones)
        for milestone in milestones:
            agents = milestone.get("contributing_agents") or milestone.get("agents") or []
            for agent_id in agents:
                key = str(agent_id)
                if key in self.evaluator.metrics["agent_kpis"]:
                    self.evaluator.metrics["agent_kpis"][key] += 1
                else:
                    self.evaluator.metrics["agent_kpis"][key] = 1
        # Normalize milestone shape for the TypeScript adapter.
        normalized = []
        for item in milestones:
            if not isinstance(item, dict):
                continue
            text = item.get("milestone") or item.get("description") or ""
            agents = item.get("agents") or item.get("contributing_agents") or []
            if isinstance(agents, list):
                agents = [str(a) for a in agents]
            else:
                agents = []
            if text:
                normalized.append({"milestone": str(text), "agents": agents})
        self.milestones = normalized
        _ = _json  # keep import intentional for future raw dumps


def _format_communications(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for message in messages:
        agent = message.get("agentId") or message.get("agent") or "agent"
        turn = message.get("turnIndex", message.get("turn", "?"))
        content = (message.get("content") or "").strip()
        lines.append(f"[Turn {turn}] {agent}: {content}")
    return "\n\n".join(lines)


def evaluate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    marble_root = _resolve_marble_root()
    Evaluator = _import_evaluator(marble_root)
    _patch_litellm_for_openai_reasoning_models()
    # MARBLE's logger writes to logs/app.log relative to cwd.
    Path("logs").mkdir(parents=True, exist_ok=True)

    model = payload.get("evaluatorModel") or "gpt-4o-mini"
    task = payload.get("task") or ""
    messages = payload.get("messages") or []
    agent_profiles = payload.get("agentProfiles") or (
        "agent_a: collaborative problem-solving agent\n"
        "agent_b: collaborative problem-solving agent"
    )
    agent_tasks = payload.get("agentTasks") or (
        "Both agents jointly solve the shared task through dialogue."
    )
    summary = payload.get("summary") or _format_communications(messages)
    results = payload.get("results") or (
        payload.get("finalAnswer")
        or _format_communications(messages[-4:] if messages else [])
    )

    communications = _format_communications(messages)
    started = time.perf_counter()

    base = Evaluator({"evaluate_llm": {"model": model}})
    evaluator = PosthocEvaluator(base)
    raw_outputs: dict[str, Any] = {
        "marble_root": str(marble_root),
        "evaluator_class": "marble.evaluator.evaluator.Evaluator",
        "methods": [
            "evaluate_communication",
            "evaluate_planning",
            "evaluate_kpi",
        ],
    }

    if communications.strip():
        evaluator.evaluate_communication(task, communications)
    else:
        base.metrics["communication_score"].append(0)

    evaluator.evaluate_planning(summary, agent_profiles, agent_tasks, results)
    evaluator.evaluate_kpi(task, results)

    latency_ms = (time.perf_counter() - started) * 1000

    communication_scores = list(base.metrics.get("communication_score") or [])
    planning_scores = list(base.metrics.get("planning_score") or [])
    agent_kpis = dict(base.metrics.get("agent_kpis") or {})
    total_milestones = int(base.metrics.get("total_milestones") or 0)
    milestones = list(evaluator.milestones)

    def _mean(values: list[Any]) -> float | None:
        valid = [float(v) for v in values if isinstance(v, (int, float)) and v >= 0]
        if not valid:
            return None
        return sum(valid) / len(valid)

    communication_score = _mean(communication_scores)
    planning_score = _mean(planning_scores)
    coordination_score = None
    if communication_score is not None and planning_score is not None:
        coordination_score = (communication_score + planning_score) / 2.0
    elif communication_score is not None:
        coordination_score = communication_score
    elif planning_score is not None:
        coordination_score = planning_score

    return {
        "ok": True,
        "normalized": {
            "communicationScore": communication_score,
            "planningScore": planning_score,
            "coordinationScore": coordination_score,
            "totalMilestones": total_milestones,
            "agentKpis": {str(k): int(v) for k, v in agent_kpis.items()},
            "milestones": milestones,
            "marbleCommit": os.environ.get("MARBLE_COMMIT")
            or "8d60fa17b5596b44458a52d4296061b9fc13d6f2",
            "marbleVersion": "0.0.1",
            "adapterVersion": "comm-policy-marble-posthoc-v1",
            "mode": "posthoc_evaluator",
            "limitations": [
                "Post-hoc only: MARBLE orchestration/environments were not used.",
                "Uses official Graph Communication / Planning / KPI evaluator methods.",
                "Planning placeholders (summary/profiles/tasks) are adapted from our transcript.",
            ],
        },
        "raw": {
            **raw_outputs,
            "metrics": base.metrics,
            "raw_responses": evaluator.raw_responses,
            "milestones": milestones,
            "communication_scores": communication_scores,
            "planning_scores": planning_scores,
            "inputs": {
                "task": task,
                "communications": communications,
                "summary": summary,
                "agent_profiles": agent_profiles,
                "agent_tasks": agent_tasks,
                "results": results,
                "evaluator_model": model,
            },
        },
        "cost": {
            "model": model,
            "provider": "marble_litellm",
            "latencyMs": latency_ms,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Post-hoc MARBLE Graph evaluation")
    parser.add_argument(
        "--input",
        required=True,
        help="Path to JSON payload, or '-' for stdin",
    )
    args = parser.parse_args()
    if args.input == "-":
        payload = json.load(sys.stdin)
    else:
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))

    try:
        result = evaluate_payload(payload)
    except Exception as exc:  # noqa: BLE001 — surface to caller as JSON
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(exc),
                    "errorType": type(exc).__name__,
                }
            ),
            flush=True,
        )
        return 1

    print(json.dumps(result), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
