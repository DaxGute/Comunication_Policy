/**
 * Architectural notes for MultiAgentBench / MARBLE post-hoc integration.
 *
 * Official sources:
 * - https://github.com/ulab-uiuc/MARBLE (canonical; MultiagentBench/MARBLE redirects here)
 * - ACL 2025 paper: https://aclanthology.org/2025.acl-long.421/
 *
 * ## What MARBLE natively evaluates
 *
 * From `marble/evaluator/evaluator.py` + Graph prompts in `evaluator_prompts.json`:
 * - Communication Score (C_score): LLM judge, 1–5 (0 if no communication)
 * - Planning Score (P_score): LLM judge, 1–5 (role clarity / task alignment / autonomy)
 * - Coordination Score (CS): average of C_score and P_score (paper definition)
 * - KPI / milestones: LLM extracts concrete milestones + contributing agent IDs
 * - Environment-specific task scores (research / coding / world / db / werewolf / …)
 *
 * ## What requires MARBLE orchestration
 *
 * - Live environments (Minecraft, DB docker, coding workspace, …)
 * - Per-iteration planner summaries and task assignments
 * - `Evaluator.update(environment, agents)` task-completion / token tracking
 * - Topology protocols (star / chain / tree / graph) during execution
 *
 * ## What can run post-hoc on our transcripts
 *
 * - `evaluate_communication(task, communications)`
 * - `evaluate_planning(summary, agent_profiles, agent_tasks, results)`
 * - `evaluate_kpi(task, agent_results)`
 *
 * Our adapter invokes those three methods via `scripts/marble/posthoc_evaluate.py`
 * against a pinned MARBLE checkout. We do **not** claim MARBLE orchestrated the run.
 *
 * ## Differences from Summer_CESTA / Organizational Tree
 *
 * Summer_CESTA's `MarbleMultiAgentBenchAdapter` launches MARBLE as the agent runtime
 * (`python -m marble.main`). Communication Policy Explorer already produced the
 * conversation; MARBLE is evaluation-only here.
 */

export const MARBLE_POSTHOC_NOTES = [
  "Post-hoc Graph evaluator only (communication, planning, KPI).",
  "Does not execute MARBLE environments or coordination engine.",
  "Planning inputs are adapted from our two-agent transcript.",
] as const;
