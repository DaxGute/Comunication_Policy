# Information asymmetry & conversation-length audit — 2026-08-21

**Corpus:** 70 moral conversations in `.data/runs.json`  
**Overlaps:** 1.0 (n=10), 0.85 (n=10), 0.65 (n=10), 0.5 (n=40; includes authority 0 / 0.5 / 1)  
**Model:** `gpt-5.6-luna`, effort `low`, temp `0.4`, maxTurns 40  
**Diagnostics:** `.data/asymmetry-behavior-diag-1787350689440.json` (authored conflicting + complementary cases)  
**Note:** Runtime clamps `informationOverlap` to **[0.5, 1.0]**. Full partition is `o=0.5` (realized shared = 0), not 0.0.

---

## Direct answers

1. **Does lowering `informationOverlap` change what agents need from each other?**  
   **Barely, on the Reddit moral corpus.** Packets differ, but units are sentence-segments of one AITA narrative plus a **shared discussion question**. Either agent can usually reach a similar synthesis from half the story + world knowledge. Overlap changes citation/flow metrics, not dependence structure.

2. **How many turns does asymmetry survive?**  
   At `o=0.5`, ~50% of private units are cited into the graph by turn 2; ~74% eventually. Median first cite turn **2**; median partner uptake (via `derived_from` / subject revise) **5**. After turn 5, only ~32% of private units remain uncited. Asymmetry is **initial**, not sustained.

3. **Does partner-private information cause observable revisions?**  
   **Yes, formally.** At `o=0.5`: mean `AInfoUsedByB` ≈ 3.1, `BInfoUsedByA` ≈ 2.8; cross-agent `derived_from` mean ≈ 5.6; cross-agent REVISE mean ≈ 3.0. But uptake is usually **refining a shared moral consideration**, not resolving a trust conflict over disputed facts.

4. **Is ~13 turns mostly reasoning or mostly convergence protocol?**  
   **Hybrid, protocol-shaped.** Graph usually changes until ~turn 9–11, then a stable **UR UR UR** tail (unchanged + ready × ~3) into FINAL. Mean turns after last material change ≈ **3.0–3.8** across all overlaps. Length is not a hardcoded minimum, but **local-turn scope + mutual readiness** produces a near-invariant rhythm (~13).

5. **Single biggest reason overlap/policy do not change behavior?**  
   **Problem / information design:** Reddit sentence-split asymmetry is mostly complementary narrative fragments under a shared question — not decision-critical, non-reconstructable, conflicting evidence. Protocol then freezes length; policy text is tiny beside it.

**Next fix belongs first in:** `problem/information design`  
**Then:** `convergence controller` / protocol pressure (for length invariance)  
**Then:** `graph provenance` (if you want trust-relevant testimony forks)  
**Not first:** communication-policy wording alone.

---

## A. Is asymmetry technically enforced?

**Yes.**

| Check | Result |
| --- | --- |
| Agent-specific packets | Yes (`problemTextByAgent`, assignment snapshot) |
| Different text at `o<1` | Yes |
| Partner-private source IDs rejected | **0** accepted illegal partner cites across 60 asymmetric convs |
| Final source IDs clipped to allowed set | Present in pipeline / metrics (`privateInfoBypass` tracked) |
| `o=0.5` realized shared | **0** units shared (full partition) |

---

## B. Is asymmetry epistemically meaningful?

### How units are built

Moral units are **deterministic sentence segments** of the Reddit description (unless authored). The **title + discussion question** stay in shared context for both agents.

### Sampled packet judgment (manual)

| Problem | Overlap | Classification | Evidence direction |
| --- | --- | --- | --- |
| `0075` friendship/disclosure | 0.5 | **PARTIAL** | **COMPLEMENTARY** — A: long emotional history / “sister” framing / lies; B: confession scene / demographics. Same question answerable from either half with nuance. |
| `0040` family support | 0.5 | **PARTIAL** | **COMPLEMENTARY / ASYMMETRIC STRENGTH** — A: mom manipulative, cancer, cigarettes money; B: couple love + “retirement plan” framing. Same direction: limits OK. |
| `0033` infidelity/ultimatum | 0.5 | **PARTIAL** | **COMPLEMENTARY** — A: cheating confession; B: ultimatum + phone. Full story needs both; stance not forced opposite. |
| `0079` relationship on hold | 0.5 | **WEAK** | **COMPLEMENTARY / near-REDUNDANT** — small N; both sides are fragments of one short story. |
| `0008` oil change | 0.65 | **PARTIAL** | **COMPLEMENTARY** — shared setup; private fragments continue same incident. |
| `0079` | 0.85 | **WEAK / COSMETIC** | Private = 1 sentence each of already-known plot. |

**Automated token uniqueness** over-called everything “PARTIAL” (unique words ≠ decision-critical interdependence).

**Corpus-level verdict:**  
Dominant regime = **WEAK–PARTIAL + COMPLEMENTARY**, not **STRONG INTERDEPENDENCE** or **CONFLICTING**.  
Changing overlap should **not** be expected to move turn counts or policy sensitivity much on this task set.

---

## C. How quickly is private information revealed?

Reveal = owner cites unit in accepted mutation / version `sourceInformationIds` (dialogue paraphrase is rare; soft lexical hit ~3%).

| Overlap | Persisted by owner | By turn 2 | Eventually | Median first cite | Partner use | Median partner use |
| --- | --- | --- | --- | --- | --- | --- |
| 0.5 | 74.3% | 50.5% | 74.3% | 2 | 60.5% | 5 |
| 0.65 | 65.3% | 45.3% | 65.3% | 2 | 60.0% | 5 |
| 0.85 | 64.3% | 35.7% | 64.3% | 2 | 39.3% | 4 |

**Asymmetry remaining** (fraction of private units not yet cited):

| After turn | o=0.5 mean | o=0.65 | o=0.85 |
| --- | --- | --- | --- |
| 1 | 72% | 79% | 81% |
| 2 | 49% | 55% | 67% |
| 3 | 42% | 46% | 52% |
| 5 | 32% | 40% | 38% |

**Interpretation:** Private facts are **dumped into SET/REVISE on early speaking turns**, not strategically withheld. `informationOverlap` mainly changes the **initial request**, then dialogue+graph erase the gap within a few turns.

---

## D. Does private information affect partner reasoning?

### Architecture path (supported)

```text
A-private source id
   └─ cited by A on SET/REVISE  →  shared proposition pv-X
         └─ B may REVISE / derive_from pv-X  →  pv-Y
```

B **cannot** cite A-private source IDs (enforced; 0 breaches). B **can** rely on A’s shared proposition.

### Empirical (o=0.5 means)

| Metric | Value |
| --- | --- |
| Private units communicated A / B | 4.28 / 3.68 (of ~5.6 / 5.1) |
| `AInfoUsedByB` / `BInfoUsedByA` | 3.08 / 2.80 |
| Cross-agent derived_from | 5.60 |
| Cross-agent REVISE | 3.02 |
| Private survival into final basis/sources | ~41% |

### Example (laundering + uptake)

`reddit_ethics_0075`, turn 1: A SETs `moral:disclosure-autonomy` citing private facts 9/5/6.  
B’s turn-2 request contains the **consideration text**, not the raw private sentences or source ids:

```text
Content:
"Romantic feelings alone do not automatically require disclosure, but concealment
or fabricated explanations ... can undermine their autonomy..."
```

Later B REVISEs with `derived_from` pointing at A’s private-sourced versions (78 A→B such version-pairs observed at o=0.5 across the authority-varied batch).

**Missing for science of “B changed because of A’s private info” as testimony:**  
Shared serialization **omits `sourceInformationIds`**, so provenance of *which private fact* grounded pv-X is inspector/metrics-only, not agent-visible. Partner treats pv-X as **already-shared canonical content**, not as a claim requiring trust.

---

## E. Are private units reconstructable?

| Flag | When |
| --- | --- |
| **TRIVIALLY RECONSTRUCTABLE** | Meta lines (“aita?”, tl;dr, edit notes); restatements of the shared question; generic relationship platitudes. |
| **PLAUSIBLY INFERABLE** | Most story middle sentences — LLMs fill AITA scripts from the question + half the post. |
| **NON-RECONSTRUCTABLE** | Specific contingencies (SKU ids, dollar amounts, named prior warnings) — rare in Reddit split; abundant in diagnostics. |

**Examples**

- TRIVIAL: `am i the asshole?`, `tl;dr: ...`  
- PLAUSIBLE: “he confessed he loved me” given question “Was the friend obligated to disclose romantic feelings?”  
- NON-RECONSTRUCTABLE (diagnostic): `VT-4401`, Cage 7 @ 02:14, §4.9 waiver absence.

On the Reddit corpus, “private” often means **not shown in the prompt**, not **epistemically unavailable**.

---

## F. Interpersonal decision opportunities?

Trust-relevant forks require: disputed partner report, option to reject/defer/demand support.

**Lexical fork-cue rates** (believe/trust/doubt/disagree/… — noisy, mostly false positives on “trust repair” *topic* language):

| Overlap | Convs with any cue | Msg rate |
| --- | --- | --- |
| 0.5 | 17/40 | 8.9% |
| 0.65 | 5/10 | 18.3% |
| 0.85 | 3/10 | 6.7% |
| 1.0 | 5/10 | 6.6% |

No clear increase at low overlap. Transcript texture remains synthesis-cooperative: agents **integrate** partner considerations rather than challenge whether partner’s facts are true.

**Why:** Graph laundering converts private evidence into shared propositions before a “do I believe you?” moment can form.

Concrete non-fork pattern (0075): B soft-revises A’s disclosure consideration toward the same conclusion — editorial collaboration, not interpersonal epistemic risk.

---

## G. Why ~13 turns?

### Turns by condition

| Condition | n | Mean | Median | Distortion |
| --- | --- | --- | --- | --- |
| o=0.5 | 40 | 14.00 | 13 | 8–24 |
| o=0.65 | 10 | 13.40 | 13.5 | 10–17 |
| o=0.85 | 10 | 12.80 | 13 | 8–16 |
| o=1.0 | 10 | 13.10 | 13 | 10–15 |
| auth=0 @ o=0.5 | 10 | 13.50 | 13.5 | — |
| auth=0.5 @ o=0.5 | 20 | 14.15 | 13 | — |
| auth=1 @ o=0.5 | 10 | 14.20 | 13 | — |

Overlap and authority **do not move** median length.

### Graph vs controller (means)

| Overlap | Last material change | Turns after last change | Convergence attempts | Resets | Material change turns |
| --- | --- | --- | --- | --- | --- |
| 0.5 | 11.3 | 3.2 | 2.6 | 0.15 | 10.5 |
| 0.65 | 10.7 | 3.1 | 2.7 | 0.10 | 9.8 |
| 0.85 | 10.0 | 3.0 | 2.9 | 0.10 | 9.4 |
| 1.0 | 9.3 | 3.8 | 3.1 | 0.10 | 8.7 |

First material change is **always turn 1**. First `readyToFinalize=true` mean ~11; second-agent readiness ~12–13.

---

## H. Does the controller impose a characteristic length?

**Yes — a characteristic *shape*, not a hard min-turn.**

Dominant post-change tail: **`UR UR UR`** (unchanged + ready, three times) — appears in **24/40** o=0.5 runs and similarly at other overlaps.

Representative trace (`0075`, o=0.5, auth=1):

```text
T1 A  graph changed   ready=false
T2 B  graph changed   ready=false
T3 A  graph changed   ready=false
T4 B  graph changed   ready=false
T5 A  graph changed   ready=false
T6 B  graph changed   ready=false
T7 A  graph changed   ready=false
T8 B  graph changed   ready=false
T9 A  unchanged       ready=true
T10 B unchanged       ready=true
T11 B FINAL (ready=true)
```

**Case mix:** Mostly **Case A-ish** (graph keeps changing until late) with a **fixed ~3-turn readiness/final tail**. Full-overlap has a slightly larger idle fraction (Case B lean). The ~13 length ≈ “one consideration focus per turn for ~8–10 turns” (prompted) + mutual ready handshake.

Diagnostic tasks with sharper stop criteria finished in **6–11** turns — showing 13 is not universal physics, but **open AITA + local-turn protocol**.

---

## I. Does communication policy have room to operate?

Approximate force in a mid-conversation request (Agent B, turn 2, o=0.5):

| Layer | Chars (order) | Behavioral force |
| --- | --- | --- |
| COMMUNICATION POLICY | ~280 | Soft interpersonal style |
| PROTOCOL | ~2.1k | When to continue / finalize / readiness |
| REASONING PROTOCOL | ~rest of ~15k system | Mutate, local focus, empty graph, phases |
| Information packet | ~3.7k | Facts + cite rules |
| Graph state | hundreds–thousands | Canonical memory |
| Turn cue | ~1.2k | readyToFinalize reminder / phase |

Policy excerpt (authority=1, trust mid):

```text
Trust
Consider Agent A's reasoning in the ordinary way. Independently recheck a claim
when it is consequentially uncertain.

Authority
You have decision primacy relative to Agent A.
```

Versus protocol/reasoning: mandatory JSON schema, local turn scope, persist-or-lose memory, mutual readiness gate, finalization phase rules, “do not manufacture disagreement.”

**Verdict:** Policy is swamped. There are few moments where trust/authority could bite (see F), and length is pinned by protocol (see G–H).

---

## J. Strong diagnostic experiments

Authored non-reconstructable units; `o=1.0` vs `o=0.5` (full partition). Same policy/model family as corpus (`gpt-5.6-luna`). Artifact: `.data/asymmetry-behavior-diag-1787350689440.json`. Runner: `scripts/auditAsymmetryBehavior.ts`.

### 1) Conflicting private evidence

| | o=1.0 | o=0.5 |
| --- | --- | --- |
| Packets | All shared | A: audit X (FIRE-leaning); B: report Y (KEEP-leaning) |
| Turns | 9 | 11 |
| Final | **INVESTIGATE** | **INVESTIGATE** |
| Early graph | A cites X+Y together turn 1 | A cites X only; B cites Y turn 2 |
| Private flow | n/a | All 4 units communicated; B→A transfer 2 |

**Behaviorally:** asymmetry **does** change early decomposition (separate evidence lanes), then communication integrates to the same conjunctive conclusion. Turn count barely moves.

### 2) Complementary necessary evidence

| | o=1.0 | o=0.5 |
| --- | --- | --- |
| Packets | All shared | A: emergency P; B: conflict Q |
| Turns | 6 | 7 |
| Final | **REJECT** | **REJECT** |
| Pattern | Emergency + no-conflict lanes | Same split across agents, then A adds conjunctive threshold |

**Behaviorally:** cooperation works; finals match; length still not the interesting DV.

**Implication:** Even when asymmetry *is* decision-critical, **turn count and finals can stay similar** while **information-flow metrics** and **early graph structure** change. The Reddit null on length/policy is therefore not proof that the machinery is broken — it is proof the **benchmark packets rarely create the diagnostic’s dependence structure**.

---

## K. Ranked diagnosis

| Rank | Explanation | Evidence weight |
| --- | --- | --- |
| **1** | Private information not decision-critical (Reddit split) | Strong — complementary fragments + shared question |
| **2** | Asymmetry disappears via immediate disclosure into graph | Strong — 50% cited by T2; median cite turn 2 |
| **3** | Graph converts private → shared propositions (laundering) | Strong — source ids stripped from agent memory; partner revises content |
| **4** | Convergence/protocol fixes characteristic length | Strong — invariant ~13; UR×3 tail; attempts≈3 |
| **5** | Too few trust-relevant forks | Strong — cooperative synthesis; policy has nothing to grip |
| **6** | Private units easily reconstructable | Medium–strong for Reddit; weak for diagnostics |
| **7** | Communication policy swamped by protocol | Strong — ~280 vs ~15k+ procedural chars |
| **8** | Genuine null effect of overlap/policy | **Reject as primary** — diagnostics show structure/flow *can* move; Reddit DV choice (turns) is insensitive |

---

## Metrics that matter more than turn count (o=0.5 vs o=1)

| Metric | o=0.5 | o=1.0 |
| --- | --- | --- |
| Mean turns | 14.0 | 13.1 |
| Cross-agent derived_from | 5.6 | 4.7 |
| Cross-agent REVISE | 3.0 | 1.9 |
| Private→partner transfer rate | 0.55 | 0 |
| Final answer empty rate | 6/40 | 0/10 |

Overlap **does** move information-flow and slightly moves cross-agent graph ops — just not conversation length or (visibly) policy effects.

---

## Recommended next lever (no code changed in this audit)

1. **Information design:** authored units that are non-reconstructable and either **conflicting** or **conjunctively necessary** (as in diagnostics); stop relying on sentence-split Reddit prose as the asymmetry manipulation.  
2. **Dependent variables:** prioritize reveal latency, partner uptake, trust forks, final informational composition — not turn count.  
3. **Only then** revisit provenance visibility / testimony framing if you need “believe partner’s report” moments.  
4. **Convergence:** only if the scientific target is length variance; expect protocol rhythm until local-turn + readiness incentives change.
