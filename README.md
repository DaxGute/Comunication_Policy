# Communication Policy Experiment

Research workbench for studying how interpersonal communication policies affect collaboration between exactly two general-purpose agents.

## Independent variables

- **Trust A→B / Trust B→A** `(0–1 each)` — asymmetric; each agent's trust toward the other
- **Authority** `(0–1)` — split continuum: `0` = Agent A over B, `0.5` = symmetric, `1` = Agent B over A
- **Familiarity** `(0–1)` — stranger-like explicitness ↔ long-term collaborator compression

These parameters rewrite agent instantiation prompts. They do **not** change model intelligence, expertise, or assigned task identity.

## Quick start

```bash
npm install
cp .env.example .env.local   # then set OPENAI_API_KEY
npm run dev
```

The Vite dev server also hosts `POST /api/generate`, a local OpenAI proxy.
The browser never receives the API key.

```bash
npm run build
npm run smoke:openai   # requires OPENAI_API_KEY; hits ModelClient via the proxy
```

### Models

OpenAI chat models selectable in run settings (default `gpt-4o-mini`):

- `gpt-5-nano`, `gpt-4.1-nano`, `gpt-4o-mini`
- `gpt-5-mini`, `gpt-4.1-mini`, `gpt-4o`, `gpt-5`

All of them go through the local `/api/generate` proxy. Missing `OPENAI_API_KEY` or an API failure **fails the run** — it never falls back to mock output.
## Architecture

```text
CommunicationPolicy
    ↓
compileCommunicationPolicy()
    ↓
AgentPromptContext / buildAgentPrompt(agentId)
    ↓
runtime interaction loop (A ↔ B)
    ↓
ExperimentRun snapshot (policy + prompts + config + transcripts + evaluation)
```

Domain logic lives outside React components:

| Area | Responsibility |
|------|----------------|
| `src/communication/` | Canonical policy object + NL compilation |
| `src/agents/` | Minimal agent definitions + prompt assembly |
| `src/runtime/` | Model client + alternating interaction loop |
| `src/problems/` | Category registry (crossword, moral, proof) |
| `src/evaluation/` | Extensible per-category evaluators |
| `src/experiment/` | Current config vs immutable completed runs |
| `src/components/` | Four-pane experiment browser UI |

## Datasets

### Crossword

Curated full-puzzle subset of [CrossWordBench](https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench) ([paper](https://arxiv.org/abs/2504.00043)).

- Vendored: `src/problems/data/crosswordbench_subset.json` (40 English 7×7 puzzles)
- Experimental unit: one complete crossword (grid + Across/Down clues)
- Grader: letter accuracy (primary), plus word accuracy, completion, crossing consistency, exact solve
- Reference solutions are stored for evaluation only and never included in agent prompts

```bash
npm run curate:crossword
npm run test:crossword-grader
```

### Moral / Philosophical

Curated subset of [agentlans/reddit-ethics](https://huggingface.co/datasets/agentlans/reddit-ethics) (CC-BY-4.0).

- Vendored: `src/problems/data/reddit_ethics_subset.json` (80 dilemmas)
- Open-ended: source sample answers/resolutions are **not** used as gold labels
- Evaluator records stance reached + lightweight tension signals only

```bash
npm run curate:moral
```

### Proof

Curated subset of [WilhelmH/proofsolver-1300](https://huggingface.co/datasets/WilhelmH/proofsolver-1300) (MIT).

- Vendored: `src/problems/data/proofsolver_subset.json` (80 prove-that / with-proof items)
- Agents co-author a joint proof; `FINAL_ANSWER` is the full write-up
- Reference solutions are stored for inspectability only and are **not** used as gold scores
- Evaluator records proof submitted + lightweight proof-structure signals

```bash
npm run curate:proof
npm run test:proof-grader
```

## Current status

- Fully implemented: layout, policy sliders, live prompt inspection, mock + OpenAI runs, transcript inspector, CrossWordBench full puzzles + Reddit Ethics + ProofSolver collaborative proofs
- OpenAI: `ConfigurableModelClient` → local `/api/generate` proxy → `gpt-4o-mini`
- Smoke test: `npm run smoke:openai`