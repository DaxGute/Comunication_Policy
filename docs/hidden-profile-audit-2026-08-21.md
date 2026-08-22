# Hidden Profile / HiddenBench audit (2026-08-21)

Proof is replaced by Hidden Profile. Crossword and Moral are unchanged. The reasoning-graph kernel is unchanged.

---

## Dataset

**Live pool = official HiddenBench full benchmark (65 tasks).**

| Source | Detail |
|--------|--------|
| GitHub | [Yassellee/HiddenBench_ICML](https://github.com/Yassellee/HiddenBench_ICML) `data/benchmark.json` |
| Hugging Face | [YuxuanLi1225/HiddenBench](https://huggingface.co/datasets/YuxuanLi1225/HiddenBench) |
| Vendored | `src/problems/data/hiddenbench_benchmark.json` |
| Commit | `3925a194423d` (2026-05-06) |
| License | MIT |
| Not used | `data/benchmark_short.json` (3 verification tasks only) |

### Dyadic adapter

HiddenBench gives one private string per original agent (`hidden_information.length` ∈ {3,4}). Our runtime is two agents, so private facts are assigned **round-robin** (even → A, odd → B). The **union preserves every official private fact**; nothing is dropped or sentence-split. FULL INFORMATION (overlap 1.0) still exposes all units to both agents.

Provenance on each problem (`hiddenProfile.hiddenBench`): dataset, commit, sourceTaskId, sourceTaskName, sourceAgentCount, dyadicPartition.

The 4-item authored diagnostic JSON remains for local smoke tooling only and is **not** the selectable pool. Problem-count UI caps at **65**.

---

## Mapping

| HiddenBench | Ours |
|-------------|------|
| `name` | `id = hiddenbench_${name}`, `sourceId`, title |
| `description` | `question` (verbatim official text) |
| `possible_answers` | `options` |
| `correct_answer` | `goldAnswer` (evaluator-only) |
| `shared_information[]` | units `S*` / `shared` |
| `hidden_information[]` | units `A*` / `B*` via round-robin |
| `rationale?` | `evaluatorMetadata.notes` (evaluator-only) |

`evaluatorMetadata.evidenceStructure` defaults to `classic_hidden_profile` for HiddenBench items.

---

## Verify

```bash
npm run test:hidden-profile
npm run test:information
npx vite-node scripts/dumpHiddenProfilePackets.ts
```
