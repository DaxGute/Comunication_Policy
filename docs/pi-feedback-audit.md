# PI feedback audit — what exists, what is missing, what to leave alone

**Date:** 2026-08-20  
**Scope:** Forensic read of the current codebase, the Aug 19 persisted runs in `.data/runs.json`, and the earlier Aug 18 trustA sweep analysis. **No implementation changes.**

**Headline:** Most of the PI’s methodological architecture already exists in some form. The live scientific problem is not “we need another evaluator / ontology / graph.” It is that (1) the last experimental protocol already recorded persistent ideas plus changes, (2) HEAD has drifted back toward a denser graph, (3) official manipulation-check metrics are implemented but unused, and (4) treatments are not paired on the same problems. Adding more labels would duplicate infrastructure and add annotator noise.

Evidence base for empirical claims:

| Sweep | When | Protocol | n | Treatments | Post-hoc MAE |
| --- | --- | --- | --- | --- | --- |
| trustA crossword (prior canvas) | 2026-08-18 | graph moves (`claim` / `agree` / `disagree`) | 30 conversations, 10 puzzles × 3 cells | trustA ∈ {0, 0.5, 1}; authority=1; trustB=familiarity=0.5 | belief pending / unused |
| trustA crossword + moral | 2026-08-19 | SET / REVISE / REMOVE on subjects | 24 conversations, 4 problems × 3 cells × 2 categories | trustA ∈ {0, 0.5, 1}; authority=familiarity=0.5 | none recorded |
| proof | — | — | 0 recent runs | — | — |

---

## 1. Already implemented

Concrete PI suggestions that already exist, often under different names.

### 1.1 Two-layer scientific split (behavior vs task)

The code already separates:

1. **Task outcome** — automatic graders on `ExperimentRun.evaluation` (`src/evaluation/evaluateRun.ts`).
2. **Shared interaction / belief-change layer** — post-hoc MARBLE + universal interaction evaluator (`src/evaluation/orchestrator.ts`), plus a still-present belief-dynamics extractor that the orchestrator **skips**.

```text
domain-specific task outcome     →  evaluateRun() / graders/*
shared interaction layer         →  evaluateInteraction()  (and unused evaluateBeliefDynamics)
```

MARBLE and belief prompts omit slider values (`src/evaluation/marble/adapter.ts`, `src/evaluation/belief/prompt.ts`, `src/evaluation/moral/judge.ts`).

### 1.2 Constructs defined one level above the observable metric

Numeric sliders never appear in agent text (`src/communication/compilePolicy.ts`). Values band to `{low, moderate, high}` at 1/3 and 2/3 (`src/communication/descriptions.ts`). Exact compiled wording:

| Parameter | Band | Exact sentence |
| --- | --- | --- |
| Trust toward partner | low | `Treat {other}'s claims as unreliable until independently supported.` |
| Trust | moderate | `Consider {other}'s reasoning in the ordinary way. Independently recheck a claim when it is consequentially uncertain.` |
| Trust | high | `Give substantial weight to {other}'s claims. Independently recheck primarily when evidence conflicts.` |
| Authority | A primacy | `You have decision primacy relative to {other}.` / `{other} has decision primacy relative to you.` |
| Authority | symmetric | `You and {other} have equal decision standing.` |
| Authority | B primacy | same primacy pair, swapped |
| Familiarity | low | `Assume little shared conversational context with {other}. State assumptions and intermediate steps explicitly.` |
| Familiarity | moderate | `Assume ordinary shared conversational context with {other}.` |
| Familiarity | high | `Assume strong shared conversational context and established shorthand with {other}.` |

This is already **not** “high trust means accept the other agent more.” Isolation tests (`scripts/testPolicyPromptArchitecture.ts`) enforce: directional trust isolation, authority-only on the Authority line, familiarity-only on Familiarity, no numeric leak, identity/task/protocol invariant across treatments.

Observable behavior is **indirectly encouraged**, not prescribed. The default hypothesis stands: expanding these definitions toward the metrics we later measure would likely make the manipulation worse.

### 1.3 A→B vs B→A asymmetries

- Trust is directional: Agent A compiles `trustA`, Agent B compiles `trustB`.
- Authority is one slider, compiled from each agent’s perspective.
- Familiarity is symmetric complementary wording of the same F.

### 1.4 Manipulation-check metric catalog (names already match the PI list)

`src/evaluation/belief/metricCatalog.ts` + `src/evaluation/belief/policyMetrics.ts` already compute, from extracted claims/events:

**Trust:** proposal acceptance, unsupported acceptance, independent verification, correction, error propagation, challenge before acceptance, correct-claim uptake, incorrect-claim rejection, reconsideration, confidence transfer, evidence sensitivity, P(accept\|correct/incorrect).

**Authority:** proposal survival after disagreement, directional deference, challenge rate, disagreement win rate, revision asymmetry, challenge success, authority-induced error adoption/correction, persistence under counterevidence, decision concentration, final-answer ownership.

**Familiarity:** repeated information, explicit reference, clarification, information density, misunderstanding frequency/correction, redundant re-derivation, common-ground reuse, shorthand, coordination overhead, duplicate work, novel information, compression failure, turns/tokens-to-progress. Repair cost (mean turns/tokens) exists in `computeFamiliarity`. There is **no** dedicated “explanation length / restatement length” metric; token/character efficiency is the closest (`conversationEfficiency`, `tokenToProgressEfficiency`).

A **second**, graph-derived copy of the same constructs lives in `src/evaluation/interaction/types.ts` `PolicyRelevantOutcomes` and is what the current orchestrator actually runs.

### 1.5 Treatment hidden from evaluators

Policy numbers are experimental metadata. Agents see compiled sentences only. Post-hoc judges are instructed not to infer sliders.

### 1.6 Stall / loop / forced-finalization telemetry

`src/reasoning/solverProgress.ts` + `src/reasoning/stall.ts` already record, per conversation, and persist under `reasoningDiagnostics.solverProgress`:

stall warning, kind, fingerprint, delivered turn, freeze type, local loop, cycle, no-op mutations, recovery turns, progress resumed after warning, closure warning, FINALIZATION REQUIRED, final answer after warning/finalization, turns from warning to final answer, terminated as protocol stall / max turns, phase.

`stoppedReason` is an analyzable outcome: `final_answer | max_turns | cancelled | error | reasoning_protocol_stalled`. Invalid mutations are stored as rejected events with errors, not dropped.

This is **not** a hidden implementation failure. It is already a run outcome. Do not redesign it.

### 1.7 Domain-independent idea identity (in the last experimental protocol)

The Aug 19 agent prompts (snapshotted on the runs) already told models:

> Shared reasoning state is a per-subject current value plus an ordered history of changes.  
> Do not emit ACCEPT, SUPPORT, CHALLENGE, or evidence nodes. Agreement and disagreement are derived from state changes later.  
> reason / references are optional provenance. They are not graph edges.

Persisted events are exactly:

```text
{ subjectId, turn, agent, action: SET|REVISE|REMOVE, before, after, accepted, errors, reason? }
```

That is the PI’s minimal Idea + Change representation, already used in the last sweep.

### 1.8 Task-specific correctness vs shared change layer

| Domain | Task outcome | Idea identity |
| --- | --- | --- |
| Crossword | letter/word/completion/crossing/exact (`crosswordGrader.ts`) | one subject per clue (`crossword:across:N`) |
| Moral | stance reached + tension regex (`moralGrader.ts`); no gold | one root subject (`moral_philosophical:root`) |
| Proof | proof submitted + marker regex (`proofGrader.ts`); reference not scored | one root subject (`proof:root`) |

Adapters assign subjects and task grounding; they should not (and mostly do not) own a separate belief ontology.

### 1.9 Experimental snapshot fields the PI asked for

Each run already stores: `policy`, `agentPrompts`, `config.runModel`, `config.temperature`, `config.maxTurns`, per-conversation `problemId` + transcript + events + diagnostics + `evaluation`. Inspector can **Copy Run JSON** (`serializeRun`). Scatter plots can plot policy vs task metrics (`axisMetrics.ts`).

### 1.10 Prior conclusion on the graph

Earlier crossword graph audits already found: per-clue latest-active state is the reliable object; most mechanically generated edges (`supports` from `parents`, `answers`, `grounds` auto-links, `depends_on`) are not. The Aug 19 protocol was the response to that finding.

---

## 2. Partially implemented

Intended concept exists, but the current implementation is incomplete, unused, or unreliable.

### 2.1 Dual reasoning representations (the important split)

There are **two** live-ish representations, and they have diverged.

| Layer | Last successful experiment (Aug 19 runs) | Current HEAD source |
| --- | --- | --- |
| Agent protocol | `"mutations":[]` SET / REVISE / REMOVE | `"moves":[]` claim / evidence / revise / agree / disagree |
| Persisted events | subject change records (`ie-1`, `action`, `before`/`after`) | `ReasoningEvent` with `operation.type` |
| Nodes / edges | none persisted (`reasoningNodes` absent) | full graph + mechanical edges in `materializeEdges` (`src/reasoning/graph.ts`) |
| Diagnostics | `setCount`, `reviseCount`, `coverageRate`, `finalMatchesCurrent` | node/edge/atomicity/lineage diagnostics in `diagnostics.ts` |

HEAD `buildAgentPrompt.ts` has already drifted back to the denser graph protocol. Uncommitted `graph.ts` only **filters out** SET/REVISE events when hydrating, because they crash `event.operation.type`. `parseReasoningEvent` (`src/reasoning/parseStored.ts`) requires `operation`, `actor`, `turnIndex` — so **reloading Aug 19 runs through the current parser drops the scientifically useful events**.

This is not “we still need to invent persistent ideas.” It is “we already ran that, then the code forked.”

### 2.2 Manipulation checks exist as code, not as populated measurements

`runMultiAgentEvaluation` currently runs **MARBLE + interaction only**. Belief and moral-dynamics are `skipped` (`src/evaluation/posthoc/registry.ts`). Aug 19: **0** MAE records on 24 conversations. Aug 18: belief evals were pending.

So the PI’s “manipulation check layer” is ~90% specified in TypeScript and ~0% filled on the runs we would actually analyze.

Further reliability issues if we did run it:

- Belief metrics are **LLM-judged then deterministically aggregated**. They need `accept` / `verify` / `defer` / `challenge` labels the Aug 19 protocol **explicitly forbade agents from emitting**.
- Interaction metrics are **graph-derived** (`collectInteractionEvents`). On SET/REVISE data they see nothing. On graph-era data, stance ops were already at the floor (Aug 18: 1 / 1 / 0 A→B accepts across 10 puzzles per cell).
- Semantic pass (`src/evaluation/interaction/semantic.ts`) only fires when graph events are empty; it uses yet another 12-label taxonomy and does not drive the official rates.
- Many familiarity flags (`usesShorthand`, `isRepetition`, `isNovel`) are omitted unless the LLM sets them; rates become N/A (`frac(0,0)`).

**Answer to “how much of the PI manipulation-check layer do we already have?”**  
The **construct list** is already implemented, twice (belief + interaction). The **usable measurement on recent runs** is: latest-per-subject SET/REVISE/REMOVE plus transcripts. That is enough to recover introduce / change / abandon and partner overwrite. It is not enough to recover SUPPORT vs VERIFY.

### 2.3 Partner influence is recoverable, but only from change records (or rare graph stances)

Scientifically important quantities vs current data:

| Quantity | Recoverable now? | How |
| --- | --- | --- |
| A held X | Yes | accepted SET/REVISE `after` for a subject, `agent=A` |
| B introduced Y | Yes | first accepted SET by B |
| A maintained X | Sometimes | no later accepted change; or rejected REVISE leaving X |
| B provided contrary information | Transcript yes; structured only if B REVISEs or SETs a different value | crossword 0013: A SET Down6=NOLAN, B REVISE→ATARI |
| A changed X → X' | Yes | accepted REVISE |
| X' incorporates B’s contribution | Sometimes | later agent’s `before` equals partner’s `after` (0013 Across8 D_P_L → D_P_A → PIPPA) |

Support/challenge **relationships** are not first-class in Aug 19 data (by design). In HEAD they are inferred from `support`/`challenge` ops and from mechanical `parents`→`supports` edges, which prior audits found noisy.

### 2.4 Crossword latest-active state vs moral/proof ideas

Crossword subjects are stable (one per clue). Latest accepted SET/REVISE is a reliable fill. Competing alternatives are **not** stored as live siblings; they appear as history (`before`). That matches the prior graph-audit conclusion.

Moral/proof collapse to a **single root subject**. REVISE therefore conflates “new framing of the question,” “new stance,” and “synthesis of partner’s principles.” See §4. That is a domain-silo in **task shape**, not a second ontology — but it makes change events coarser than crossword.

### 2.5 Mechanical graph edges are still generated in HEAD

`materializeEdges` still emits:

- `answers` (claim → subject) on every create/revise
- `supports` from `node.parents` (**legacy=true**)
- `depends_on` from `dependencies` (legacy)
- `replaced_by` when a new live candidate replaces the previous
- `grounds` / `supports` from compiled `basis`
- `supports` into `__final_answer__`

`replaced_by` and explicit `revises` are the historically meaningful ones. The rest are the edges the previous audit recommended not trusting.

### 2.6 Experimental pairing is possible in data, not enforced in the runner

`selectProblems` (`src/problems/registry.ts`) **shuffles without a seed**. Same `problemCount` does not mean the same problems or order. Policy, model, and temperature **are** snapshotted. Repeated runs are a UI click. There is no dedicated sweep runner — and we do not need one — but we also do not have fixed problem IDs.

Aug 19 three-way intersection: **empty**. Pairwise overlaps: crossword `0036` (low vs mod), moral `0053` (mod vs high). Aug 18: zero puzzles in all three cells.

Export of treatment + problem + outputs: yes, if you copy run JSON. Comparison of matched problems: only after the fact, and only for accidental overlaps.

### 2.7 Protocol and task text can dominate the policy sentence

On Aug 19 Agent A prompts (~2944 chars): Communication Policy block ~261 chars; Protocol ~407; Reasoning Protocol ~2096. Crossword problem text alone ~3k chars of hard placement rules. The treatment is one sentence inside a much larger instruction stack. That is already a plausible wash-out, without expanding the policy text.

---

## 3. Actually missing

Only genuine gaps. Short list.

1. **Paired problem identity across treatments.** No seed, no fixed ID list, no lock on order. This is the PI’s paired-design recommendation, and it is the one experimental-design hole that actually blocks inference.

2. **A single live representation.** HEAD graph-moves vs Aug 19 SET/REVISE. Reloading recent runs drops change events. This is a data-integrity gap, not a missing ontology.

3. **Populated, deterministic manipulation checks from the representation we actually store.** Not a new LLM judge. The missing piece is folding SET/REVISE (or canonical graph events, if that is the live protocol) into the rates we already named: partner overwrite, introduce vs revise vs remove, directional who-holds-the-live-value.

4. **Authority and familiarity sweeps.** Recent empirics only move `trustA`. We cannot currently say those sliders fail or work.

5. **Proof conversations in the recent evidence base.** The pipeline exists; there are no recent proof runs to audit event-label reliability on.

6. **A dedicated explanation-length / restatement-length metric** — only if familiarity is the next IV. Token/character aggregates already exist; do not add this until familiarity is actually swept.

Not missing: a 9-way event taxonomy; a new belief evaluator; MARBLE (already wired); stall telemetry; hidden-treatment evaluators; domain-specific task graders.

---

## 4. Do not implement

Suggestions that would duplicate infrastructure, over-specify agent behavior, or require distinctions we cannot annotate reliably.

| Suggestion | Why not |
| --- | --- |
| Expand trust / authority / familiarity prompt definitions | Constructs are already one level above the metric. More text would hard-code “accept / verify / shorthand,” which we later measure. Isolation tests exist to keep the policy block tiny. |
| Nine-way `PROPOSE/SUPPORT/CHALLENGE/VERIFY/ADOPT/REJECT/REVISE/RETRACT/SYNTHESIZE` | Already present as belief actions **and** as interaction event types. Aug 19 protocol **forbade** emitting them. Transcripts do not distinguish SUPPORT vs VERIFY, CHALLENGE vs REJECT, ADOPT vs REVISE, REVISE vs SYNTHESIZE (see below). |
| New LLM evaluator for interaction acts | Belief grader + semantic pass + MARBLE already exist. Orchestrator already skipped belief because of overlap. |
| New graph machinery / more edge types | Mechanical edges are the known failure. Latest-per-subject state is the known success. |
| New experiment runner / sweep framework | Manual multi-run already produced 3-cell sweeps. Model, temperature, policy, prompts are snapshotted. Only pairing is missing. |
| Domain-siloed idea graphs | Task correctness should stay domain-specific. Idea-change should not grow a moral graph vs a crossword graph (moral/proof evaluators in `src/evaluation/moral/` are already legacy). |
| Force-injected final answers | FINALIZATION REQUIRED already asks the agent to submit; outcomes are recorded. System-writing the answer would confound task scores. |
| “High trust = accept more” operationalizations | Directly tautological with `proposalAcceptance`. |

### Event-ontology reliability (Audit 4), from real transcripts

**Reliably observable (1)**

- **Introduce:** first SET on a subject (`before=null`). Crossword 0013 turn 1: A SETs Down6=NOLAN.
- **Change:** accepted REVISE with different `after`. 0013 turn 8: B REVISE NOLAN→ATARI.
- **Abandon / clear:** REMOVE (rare in these runs) or a later value that leaves the subject empty.
- **Who currently holds the live value:** last accepted mutation’s `agent`.
- **Partner overwrite:** last agent ≠ introducer (0013 Down6 A→B; Across8 B→A→B).

**Sometimes recoverable (2)**

- **Contrary information:** B’s REVISE of A’s fill, or transcript “I think X is wrong.” Not always mutated (0013 turn 2 B challenges DUTY/TIP in prose, no mutation).
- **Maintain:** empty `mutations` plus unchanged live value. Confounded with stall and with “not yet justified.”
- **Influenced-by:** `before` matches partner’s previous `after` (0013 Across8). Optional `reason`/`references` on mutations help but were often omitted.

**Fundamentally ambiguous in natural conversation (3)**

Excerpts:

1. **SUPPORT vs VERIFY** — 0013 turn 9, A after B’s ATARI revision: “Great—updating Down 6 to ATARI makes the crossings consistent again. Recomputing Across 5…” That is simultaneously agreement, independent crossing check, and adoption. A 9-way scheme would split this three ways; annotators would not agree.

2. **CHALLENGE vs REJECT** — 0013 turn 2, B: “I think either Across1≠DUTY or Down2≠TIP; can you recheck those two assumptions.” No reject mutation. Prose is a challenge that does not reject a live value.

3. **ADOPT vs REVISE** — Moral 0053 (trustA=0.5) turn 2, B REVISES A’s question into a “provisional framework.” High-trust 0053: B’s turn-2 contribution is **not** even a REVISE (only A’s SET is stored). Same conversational move, different structured labels.

4. **REVISE vs SYNTHESIZE** — Moral 0053 turn 3, A: “Building on our provisional framework, I’d add a clearer boundary…” Stored as REVISE of the single root. It is also synthesis.

5. **RETRACT vs REJECT** — Crossword rejected mutations are engine-side (`candidate length 9 does not equal 4`, `stale before value`, `malformed idea mutation`), not an agent retracting a belief.

**Smallest vocabulary that survives all three domains**

```text
introduce   SET, before=null
maintain    no accepted change this turn (optional; high missingness)
change      REVISE (or SET that replaces a live value)
abandon     REMOVE, or rejected-without-replacement if we ever need it
```

Optional relational metadata, only when mechanically true:

```text
influenced_by     previous live agent ≠ this agent
contradicted_by   optional; only if we later add a deterministic conflict, not an LLM label
supported_by      do not add; SUPPORT/VERIFY collapse in transcripts
```

That is what Aug 19 already stored, minus `maintain`. Do not go finer.

---

## 5. Current minimal representation

### What the last experiment actually stored

```text
Subject:  id, label                    (task-defined; clue or moral/proof root)
Change:   turn, agent, action, before?, after?, accepted, errors, reason?
Live:     last accepted after per subject
```

Ownership = `createdBy` analogue is `agent` on the mutation that currently holds the value. Persistence = the subject id does not change. Supersession = REVISE (`before` → `after`), not a `replaced_by` edge.

This is enough to track ideas changing over turns **if we stop dropping it on load.**

### What HEAD still compiles to agents

```text
Node:     id, type, text, createdBy, createdAtTurn, subjectId, status, parents, supersedes
Event:    intent + operation (create|support|challenge|accept|reject|revise|…)
Edge:     answers|supports|challenges|depends_on|grounds|revises|replaced_by
```

Moves in the prompt: `claim`, `evidence`, `revise`, `agree`, `disagree`. Plus auto-extracted crossword fills from the utterance.

### Is it enough for the PI’s quantities?

Yes, under the Aug 19 schema, for introduce / hold / change / partner overwrite. No, if we insist on SUPPORT vs VERIFY. The scientific requirement does not need that distinction.

Crossword vs moral: same change record; different subject granularity. That is acceptable. Do not invent a moral event graph.

---

## 6. Treatment-to-measurement pipeline

```text
slider
  ↓  [A]
agent prompt
  ↓  [B]
observable conversation
  ↓  [C]
reasoning / change extraction
  ↓  [D]
manipulation metrics
  ↓  [E]
task outcome
```

| Arrow | Exact code path | Likely failure modes |
| --- | --- | --- |
| **A** slider → prompt | `CommunicationPolicy` → `bandFromValue` → `trustInstructions` / `authorityInstructionsForAgent` / `familiarityInstructions` → `compileCommunicationPolicy` → `buildAgentPrompt` (POLICY section only) | Continuous slider collapses to 3 bands. One-sentence treatment. Identity/task/protocol/reasoning **do not** change — good for identification, bad if those layers dominate. |
| **B** prompt → conversation | `runProblem` → `runInteractionLoop` → `renderModelRequest` (system + problem + CURRENT STATE + turn cue + stall feedback) → model | Reasoning protocol + crossword hard rules + stall warnings dwarf the policy sentence. Nano dumps many fills on turn 1 regardless of trust. JSON envelope failures → `structured_reasoning_missing`. |
| **C** conversation → extraction | Aug 19: mutations parsed into SET/REVISE/REMOVE (that parser is **not** in current HEAD `parseTurn.ts`). HEAD: `parseAgentTurn` → `compileReasoningMoves` → `applyReasoningIntents` → nodes/edges. Crossword also `extractCrosswordFillMoves`. | HEAD cannot parse Aug 19 mutations. `parseReasoningEvent` drops them. Mechanical edges add noise. Empty `moves` still produce dialogue, so interaction looks rich while structured state is thin. |
| **D** extraction → manipulation metrics | Intended: `evaluateBeliefDynamics` (LLM) or `computeInteractionDynamics` (graph). Actual recent runs: **neither executed**. Crude recoverable metrics sit unused on SET/REVISE. | Belief skipped in orchestrator. Interaction needs graph ops agents were told not to emit. Semantic pass is a third taxonomy. Official trust suite has ~0 denominators when stance ops are unused (Aug 18). |
| **E** metrics → task outcome | Automatic: `evaluateRun` → crossword letter accuracy etc. / moral stance / proof submitted. Independent of D. | Crossword scores vary 0–0.73 across puzzles in one cell. Unpaired sampling confounds treatment with puzzle. Moral/proof are not correctness scores, so they cannot test “does behavior affect performance” except via proxies (turns, tension markers). Stall/finalization can truncate search (controller), which **is** recorded. |

The weak link is **not** “missing architecture around D.” It is: **B may not move; D is unpopulated; problem pairing is missing so E is confounded.**

---

## 7. Empirical diagnosis

Ranked from evidence we already have. **Do not assume A.**

| Rank | Explanation | Verdict | Evidence |
| --- | --- | --- | --- |
| **1** | **C. Task insensitivity** | Primary for crossword | Agents solve by dumping fills and checking crossings. Partner-directed decisions are rare. Turn-1 claim/SET counts stay high in every trustA cell (Aug 18: 6.3–7.6 fills; Aug 19: A still opens). 0014 paired: identical 0.852 letter accuracy, same FAB/FBI/JOB grid. 0003: both lock LULU+DAVE. Moral has more partner REVISE (B rewriting A’s framing), so it is a better interpersonal task — still no trustA gradient in 12 conversations. |
| **2** | **D. Statistical noise / unpaired design** | Blocking | Aug 19 crossword letter: low 0.535, mod 0.472, high 0.533 (n=4 each, different puzzles). Within-cell scores range ~0.00–0.73. Three-way problem intersection empty. Cannot attribute Δscore to treatment. |
| **3** | **A. Manipulation failure** | Secondary, not “prompts are empty” | Endpoints **do** differ by one Trust sentence. Behavior does **not**. Aug 18: A→B accept 1 / 1 / 0; A almost never copies B’s candidateIdentity. Aug 19 partner overwrites: crossword 1 / 4 / 0 (low/mod/high) — not a high-trust uptake rise. Blinded A turns are interchangeable. Protocol+task likely wash the sentence out; expanding the sentence is the wrong fix. |
| **4** | **B. Measurement failure** | Real for the official suite; **not** the cause of the null | Belief/interaction MAE never populated on Aug 19; Aug 18 belief pending. Stance-op denominators ~0. Transcript + SET/REVISE audit still finds no treatment. If measurement were the only problem, crude partner-overwrite and lexical checks would have moved. They did not. |
| **5** | **E. Genuine null** | Possible, not identifiable yet | Under gpt-5.4-nano, temp 0.4, crossword/moral as currently framed, these sliders may simply not matter. We cannot claim E until pairing exists and we have looked at a task with more interpersonal forks (or a more instruction-sensitive model). Commit `15950be` (“communication has absolutely NO IMPACT ON THIS”) matches C+A, not a completed E. |

**PI’s two questions**

1. Does the manipulation change interaction behavior? **Not detectably, in unpaired nano crossword/moral sweeps.**  
2. Do those changes affect task performance? **Unaskable until (1) is non-null and problems are paired.** Crossword letter noise would drown a small effect anyway.

Authority/familiarity: **not tested** in these sweeps (held at 0.5 except Aug 18 authority=1 in every cell, which itself may have flattened trust).

---

## 8. Minimal next changes

Maximum **three**. Each addresses a demonstrated gap. No speculative graph expansion, no new evaluator, no larger behavior prompt, no nine-category ontology.

### Change 1 — Pair problems in the existing runner

**Gap:** `selectProblems` shuffles without a seed; treatments cannot be compared.

**Do:** Add an optional seeded shuffle or an explicit `problemIds` list on `RunConfig`, and reuse it across treatment clicks. Same model, temperature, and problem order. Do **not** build a new sweep framework.

**Why this first:** Until this exists, every score table is confounded. The PI’s paired design is the only experimental-design recommendation that is actually missing.

### Change 2 — Pick one reasoning representation and stop dropping it

**Gap:** Aug 19 SET/REVISE is the scientifically useful log; HEAD prompts and `parseReasoningEvent` belong to a denser graph; load path drops change events.

**Do:** Make the live protocol match the last experimental one (per-subject current value + SET/REVISE/REMOVE history), **or** fully revert to graph moves — but do not run a third thing. If SET/REVISE stays, teach `parseReasoningEvent` / hydrate to keep those records instead of filtering them out. Do not reintroduce mechanical `supports` edges.

**Why:** This is the PI’s “persistent ideas plus changes.” We already had it. The uncommitted `graph.ts` filter is a symptom of the fork, not a design.

### Change 3 — Compute manipulation checks from those change records (deterministic)

**Gap:** Official trust/authority/familiarity rates never populate, and they demand SUPPORT/VERIFY labels the protocol forbids.

**Do:** From existing mutations (or canonical graph events if that remains live), persist a small table:

- introduce / change / abandon counts by agent  
- partner overwrite rate (A→B vs B→A)  
- live-value ownership share  
- optional: whether `before` equals partner’s previous `after`

Wire those into the dashboard axes we already have. **Do not** re-enable the belief LLM grader for this. **Do not** expand policy prompts because the current one-sentence manipulation “failed” — it failed relative to task+protocol+unpaired noise, not because the sentence was underspecified.

---

## Appendix A — Treatment implementation (Audit 1 detail)

**What the numeric treatment changes:** only the compiled POLICY block; three bands, not the raw float.

**Observable vs prescribed:** indirect. No “accept more / challenge less / use shorter sentences.”

**Redundant layers:** none inside POLICY (one line each). Outside POLICY: protocol (disagreement allowed, FINAL_ANSWER rules), reasoning protocol (commit discipline, JSON shape, domain one-liners), problem text (crossword hard rules, moral “converge on a joint stance”, proof “challenge unjustified steps”). Those can wash out the IV. They are **task/protocol**, not extra policy definitions — leave them unless a later paired study shows they erase all interpersonal variance.

**A→B vs B→A:** implemented correctly for trust; authority is relational; familiarity is symmetric.

**HEAD vs snapshotted Aug 19 prompts:** policy sentences are the same. Reasoning protocol is **not** (moves vs mutations). Any new run from HEAD is a different extraction regime than `.data/runs.json`.

## Appendix B — Metric inventory (Audit 2 condensed)

| Construct | Metric | File | Det. vs LLM | Populated on Aug 19? | Redundant with | Reliable for treatment comparison? |
| --- | --- | --- | --- | --- | --- | --- |
| Trust | proposalAcceptance etc. | `belief/policyMetrics.ts` `computeTrust` | LLM extract, det. rates | No (belief skipped) | interaction `adoption` / `verification` | No — empty + needs forbidden labels |
| Trust | adoption, unsupportedAdoption, verification | `interaction/evaluator.ts` `policyFrom` | graph-derived | No MAE | belief trust | No on SET data; floor on graph data |
| Authority | survival, deference, revision asymmetry | belief `computeAuthority` | LLM extract | No | interaction `influence` / `concession` | No |
| Authority | directionalInfluence, disagreementSurvival | interaction | graph | No | belief authority | No |
| Familiarity | repeatedInformation, clarification, shorthand | belief `computeFamiliarity` | LLM flags | No | interaction efficiency/clarification | Flags often N/A |
| Familiarity | repetition, clarificationRequests | interaction | graph + `?` regex | No | belief familiarity | Weak (question-mark heuristic) |
| Familiarity | explanation length | — | — | — | `conversationEfficiency` chars/tokens | Not a named metric |
| Task | letterAccuracy etc. | `crosswordGrader.ts` | det. | **Yes** | — | Yes, **if paired** |
| Task | stance_reached | `moralGrader.ts` | det. regex | **Yes** (all 12 stances) | — | Ceilinged; not a performance score |
| Change | SET/REVISE/REMOVE | persisted `reasoningEvents` | det. | **Yes** (raw JSON) | — | Yes for introduce/change/overwrite; dropped on current parse |
| Stall | solverProgress.* | `runProblem.ts` | det. | **Yes** | — | Yes as covariates, not IVs |

**How much of the PI layer we already have:** the catalog is complete; the populated, reliable slice is task scores + stall telemetry + SET/REVISE change logs. Do not duplicate the catalog.

## Appendix C — Stall outcomes (Audit 6)

Not hidden. On Aug 19 all 24 conversations `stoppedReason=final_answer`. Solver fields present: stall warnings (6 convos), freeze type (3), finalization required (2), resumed after warning (1), final answer after finalization (2). Invalid mutations retained (`stale before value`, length mismatch, `malformed idea mutation`). No system-authored FINAL_ANSWER; force-finalize is a **prompt** (`FINALIZATION REQUIRED`) then the agent must emit one, else `reasoning_protocol_stalled` / `max_turns`.

Leave this alone.

## Appendix D — Experimental design (Audit 7)

| PI paired-design item | Supported? |
| --- | --- |
| Same problem under multiple treatments | Only if it happens to be resampled |
| Fixed problem selection/order | **No** (`Math.random` shuffle) |
| Seeds | **No** for problems; model sampling uses temperature only |
| Fixed model | **Yes** (`runModel` snapshotted) |
| Fixed temperature | **Yes** |
| Repeated runs | **Yes** (manual) |
| Treatment sweeps | **Yes** (manual slider + Run); no dedicated runner needed |
| Compare matched problems | Dashboard can filter `problemIds` after the fact |
| Export treatment + problem + outputs | **Yes** (Copy Run JSON) |

Close to the PI recommendation except pairing/seeds. Do not write a new runner.

---

*No code was changed for this audit. The uncommitted `src/reasoning/graph.ts` defensive filter was left as found.*
