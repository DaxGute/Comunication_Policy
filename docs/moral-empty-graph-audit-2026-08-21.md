# Moral empty-graph + mutual convergence audit — 2026-08-21

**Baseline:** `run_mt3c9crw_k036xp` (seeded lanes + A→B→A eligibility; no `readyToFinalize`)  
**New audit artifact:** `.data/moral-empty-graph-audit-1787341608731.json`  
**Intervention:** empty moral graph + agent-created considerations + mutual readiness (no new dialogue pressure)

Problems (paired): `0073, 0047, 0069, 0057, 0029, 0034, 0059, 0067, 0007, 0076`.  
Model / effort / temperature matched baseline (`gpt-5.6-luna`, `low`, `0.4`, maxTurns 40).

---

## Definition of done — verified

| Check | Result |
| --- | --- |
| Turn-1 persisted `modelRequest` empty | **Pass** — `No persistent considerations have been established yet.` |
| No question / stance / seeded tension rows | **Pass** |
| Mutual `readyToFinalize` present in served protocol | **Pass** |
| Canonical mutation refs (`pv-N` / `fromVersionId`) | **Pass** — **0** rejected mutations across 10 conversations |
| Same 10 moral IDs rerun | **Pass** |
| Before/after audit | this document |

Smoke memory excerpt (persisted):

```text
CURRENT SHARED REASONING STATE

No persistent considerations have been established yet.

Create only considerations that are important enough to survive after this message leaves context.
```

---

## Headline comparison

| Metric | Old (seeded + A-B-A gate) | New (empty + mutual ready) |
| --- | --- | --- |
| Mean / median turns | **3.5 / 3** | **5.3 / 5** |
| Turn distribution | 3,3,3,5,3,3,4,3,5,3 | 6,5,5,4,7,6,5,5,5,5 |
| FINAL on first eligible turn | 9/10 at turn 3 | endogenous; modal 5 |
| Turn-1 seeded lanes | **10/10** | **0/10** |
| `readyToFinalize` in request | **0/10** | **10/10** |
| Rejected mutations | (present; version-ref noise) | **0** |
| Questions (`?` in non-final) | 0/10 | **0/10** |
| Lexical disagreement cues | 0/10 | **0/10** |

Conversation length increased under mutual convergence without any new minimum-turn or forced-disagreement rules.

---

## Did removing seeding change framing?

**Yes.** Agents no longer populate the benchmark’s three tension labels.

Example — `0073` (blocking / unwanted attention):

| Old (seeded) | New (agent-created) |
| --- | --- |
| Personal Safety vs. Guilt | Autonomy / boundaries |
| Boundaries vs. Empathy | Self-protection |
| Self-Protection vs. Social Pressure | Proportionality under social pressure |
| | **+ Escalation / safety** (created by B, turn 2) |

Example — `0047` (shared-space noise): A invents etiquette, communication/escalation, contextual accommodation; B adds proportionality/support. Benchmark labels (Respect vs. Entitlement, etc.) are **not** recovered as labels — coverage is partial by token overlap, and most agent lanes are **novel** relative to the rubric.

So: framing is now an agent decomposition of the dilemma, not annotation of a pre-labeled skeleton.

---

## Did B become more than an editor?

**Partially, and in a more interesting way than soft revision of slots.**

| Behavior | Count |
| --- | --- |
| B creates ≥1 consideration | **5 / 10** |
| B REVISE of A’s lanes (message-level) | **4 / 10** |
| Mean considerations created by A / B | **3.5 / 0.5** |
| Considerations created after turn 1 | mean **0.6** |

When B contributes a SET, it is often a missing dimension A did not open:

- `0073`: B adds **escalation-safety**
- `0047`: B adds **proportionality-and-support**
- `0069`: B adds **necessity-and-alternatives**
- `0076`: B adds **relational-trust**
- `0029`: B later adds **proportionality** (turn 4)

That is restructuring / gap-filling, not only polishing predefined slots. Ownership remains A-heavy on first decomposition — expected when A speaks into an empty graph.

---

## Did interaction naturally become longer?

**Yes, modestly and endogenously.**

- Mean turns **3.5 → 5.3** (+1.8)
- No conversation stopped at the old modal of 3
- Readiness appears after graph work; material change can reset (mean convergence resets **0.1**)

This is not forced length. Mutual readiness + empty start both contribute: A must SET before anyone can treat the graph as developed, and both agents must judge the same stable fingerprint ready.

---

## Did disagreement / questions emerge naturally?

**No.** Still **0** questions and **0** disagreement cues across 10 conversations.

Per the experimental stance: **do not treat this as an implementation bug.** After empty-graph init, agent-created decomposition, working convergence, and zero mutation rejects, thin dialectical texture remains. That points to task genre / shared information / same-model agents / synthesis-oriented framing — not missing protocol pressure.

Next experimental lever, if desired: **asymmetric or conflicting task information**, not more behavioral prompting.

---

## Mechanical reliability

| Failure mode | New batch |
| --- | --- |
| Rejected mutations | **0** |
| Bad `fromVersionId` / stale before | **0** |
| REVISE-before-SET | **0** |

One canonical agent-facing version format: **`pv-N`**.

---

## Architecture notes shipped with this audit

1. Moral seeding removed from the active path; config always normalizes to `agent-created`.
2. Runtime asserts empty canonical graph **and** empty turn-1 serialized memory before the first model call.
3. Benchmark `issues` remain evaluator metadata only (`referenceMoralConsiderations`).
4. Mutual `readyToFinalize` is present in system + turn cue; premature FINAL_ANSWER blocked until mutual readiness on a stable fingerprint.
5. Inspector / serializer show `Created by Agent X · Turn N`; historical runs keep persisted `modelRequest` (legacy seeded memory stays labeled as served).

---

## Bottom line

The non-negotiable change works: **agents construct the consideration graph themselves**, and the served protocol is empty-graph + mutual convergence. Conversation depth increased without forcing disagreement. Dialectical thinness persists as an empirical property of this task setup — not as evidence that seeding leaked back into the request.