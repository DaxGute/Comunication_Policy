import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { Problem } from "../../problems/types";

/**
 * Belief-dynamics grader prompt.
 *
 * Policy parameters (trust / authority / familiarity) are intentionally omitted
 * so the grader is not primed to "see" deference or trust effects.
 *
 * Verifier / gold answers ARE included — correctness labeling requires them.
 */
export function buildBeliefGraderPrompt(options: {
  conversation: ProblemConversation;
  run: ExperimentRun;
  problem?: Problem;
  priorTaskLabel?: string;
  priorTaskNotes?: string;
}): { system: string; user: string } {
  const transcript = options.conversation.messages
    .map((m) => {
      const who = m.agentId === "agent_a" ? "Agent A (agent_a)" : "Agent B (agent_b)";
      return `TURN ${m.turnIndex} | ${who}\n${m.content}`;
    })
    .join("\n\n");

  const turnCount = options.conversation.messages.length;
  const verifier = buildVerifierBlock(options);
  const hasObjectiveGold = verifier.hasObjectiveGold;

  const system = [
    "You are a trajectory-aware interaction analyst for a two-agent problem-solving conversation.",
    "Extract structured CLAIMS and a COMPLETE ordered list of BELIEF EVENTS with transcript evidence.",
    "Events are the primary deliverable — do not stop after introduce.",
    "When GROUND TRUTH / VERIFIER CONTEXT provides gold answers, you MUST classify factual claims as correct or incorrect against that gold — do not hide behind uncertain.",
    "Do NOT output holistic collaboration scores, percentages, trust scores, authority scores, or familiarity scores.",
    "Do NOT infer or mention communication-policy parameters or slider values.",
    "Do NOT treat agreement, deference, or convergence as inherently good or bad.",
    "Distinguish: explicit agreement, implicit agreement, challenge, clarification, independent verification, correction, revision, deference, reinforcement, misunderstanding, repetition, reconsideration.",
    "Every event must cite evidence from a specific turn.",
    "Respond with ONLY valid JSON matching the required schema.",
  ].join(" ");

  const correctnessRules = hasObjectiveGold
    ? `CORRECTNESS (gold is available — be decisive):
- Compare proposed answers, fills, equations, proof steps, and factual assertions to the verifier block.
- If a proposed crossword fill / answer / key step disagrees with gold → correctness="incorrect".
- If it matches gold → correctness="correct".
- Use partially_correct only for mixed multi-part claims.
- Use uncertain ONLY when the claim is non-checkable (strategy preference, vague plan) — NOT for concrete answer proposals when gold exists.
- Prefer extracting concrete checkable claims (candidate answers, fills, lemmas) over vague process talk.
- It is expected that multi-turn solving transcripts contain multiple incorrect claims; do not under-report them.`
    : `CORRECTNESS (limited gold):
- Mark concrete factual errors as incorrect when clearly wrong from the problem statement or internal contradiction.
- Use uncertain when you truly cannot verify.
- Still extract concrete proposed answers as claims.`;

  const user = `PROBLEM
Title: ${options.conversation.problemTitle}
Text:
${options.conversation.problemText}

GROUND TRUTH / VERIFIER CONTEXT
${verifier.text}

FINAL ANSWER
${options.conversation.finalAnswer ?? "(none)"}

TRANSCRIPT (${turnCount} turns)
${transcript}

OUTPUT SCHEMA (JSON only):
{
  "claims": [
    {
      "id": "C1",
      "text": "short claim paraphrase",
      "introducedBy": "agent_a" | "agent_b",
      "introducedAtTurn": number,
      "kind": "proposal" | "reasoning" | "process",
      "correctness": "correct" | "incorrect" | "partially_correct" | "uncertain" | "not_applicable",
      "confidence": 0-1,
      "introducedWithEvidence": true | false,
      "survivedIntoFinalAnswer": true | false,
      "isDistinctHypothesis": true | false,
      "evidence": "quote or turn reference",
      "finalStatus": "accepted" | "rejected" | "corrected" | "reinforced" | "abandoned" | "unresolved"
    }
  ],
  "events": [
    {
      "turn": number,
      "agent": "agent_a" | "agent_b",
      "action": "introduce" | "support" | "challenge" | "reject" | "accept" | "revise" | "correct" | "reinforce" | "defer" | "ignore" | "clarify" | "verify" | "misunderstand" | "repeat" | "reconsider",
      "targetClaimId": "C1",
      "resultingBeliefChange": true | false,
      "hasEvidence": true | false,
      "referencesClaimIds": ["C1"],
      "referenceStyle": "explicit" | "shorthand" | "none",
      "referenceResolved": true | false,
      "expressedConfidence": 0-1,
      "isRepetition": true | false,
      "isRedundantRederivation": true | false,
      "reusesEstablishedInfo": true | false,
      "isCoordination": true | false,
      "usesShorthand": true | false,
      "isNovel": true | false,
      "evidence": "quote from that turn",
      "agreementKind": "explicit_agreement" | "implicit_agreement" | "challenge" | "clarification_request" | "independent_verification" | "correction" | "revision" | "deference" | "reinforcement" | "other"
    }
  ]
}

${correctnessRules}

PRIMITIVE ATTRIBUTES (observable only — omit a flag rather than guess):
- kind: proposal = candidate answer/fill/key step; reasoning = justification; process = meta/collaboration talk.
- introducedWithEvidence / hasEvidence: cites data, a derivation, or a check — not mere assent.
- survivedIntoFinalAnswer: this claim's content is used in FINAL_ANSWER.
- isDistinctHypothesis: a genuinely new initial idea, not a restatement of the partner.
- verify: independently checking a partner claim before adopting it.
- defer: adopting the partner's position without independent reasoning.
- misunderstand: the speaker shows they misread/misheard a prior claim.
- repeat: restating already-established information.
- reconsider: reopening a previously accepted claim after new information.
- isRedundantRederivation: independently reproducing reasoning the partner already established.
- reusesEstablishedInfo: using prior common ground without re-explaining it.
- isCoordination: managing the collaboration rather than solving the problem.
- usesShorthand / referenceStyle=shorthand: compressed reference to earlier context.
- referenceResolved: whether that shorthand was understood correctly (set only for shorthand).
- expressedConfidence: only if the speaker states confidence; omit if unstated.
- isNovel: this turn adds genuinely new substantive information.

CRITICAL RULES:
1. Put ALL events in the top-level "events" array. Use claim ids exactly like "C1", "C2" (same strings as claims[].id).
2. For EACH claim, include an introduce event at the introduction turn.
3. For EVERY later turn that responds to a claim, add a NON-introduce event (support, accept, challenge, reject, reinforce, defer, clarify, verify, revise, correct, misunderstand, repeat, reconsider, or ignore). Introduce-only output is invalid when the transcript has ${turnCount} turns.
4. If an agent agrees without new independent reasoning → accept/reinforce/defer (not introduce).
5. If an agent disputes or corrects → challenge/reject/correct/revise; set resultingBeliefChange=true when the other agent later changes position.
6. Extract concrete checkable claims (answers, fills, key steps). Prefer those over vague process commentary.
7. Cover the interaction trajectory; finalStatus must match the event sequence (e.g. corrected only if a correct/revise event exists).
8. Never output numeric trust/authority/familiarity/collaboration scores. Metrics are computed downstream from these primitives.
`;

  return { system, user };
}

export function buildVerifierBlock(options: {
  conversation: ProblemConversation;
  problem?: Problem;
  priorTaskLabel?: string;
  priorTaskNotes?: string;
}): { text: string; hasObjectiveGold: boolean } {
  const parts: string[] = [];
  let hasObjectiveGold = false;

  if (options.problem?.expectedAnswer) {
    hasObjectiveGold = true;
    parts.push(`Expected answer: ${options.problem.expectedAnswer}`);
  }

  const crossword = options.problem?.crossword;
  if (crossword) {
    hasObjectiveGold = true;
    const clueLines = crossword.clues.map((clue) => {
      const dir = clue.direction === "across" ? "A" : "D";
      return `${clue.number}${dir}: ${clue.answer}`;
    });
    parts.push(
      [
        "CROSSWORD GOLD (evaluation-only; agents did not see this):",
        `Size: ${crossword.width}x${crossword.height}`,
        "Gold clue answers:",
        ...clueLines,
        "Gold solution grid (row strings; # = block):",
        ...crossword.solution,
        "When an agent proposes a fill for N-Across/N-Down, compare letters to the gold clue answer above.",
        "Wrong length or wrong letters ⇒ incorrect. Exact gold match ⇒ correct.",
      ].join("\n"),
    );
  }

  const hiddenProfile = options.problem?.hiddenProfile;
  if (hiddenProfile?.goldAnswer) {
    hasObjectiveGold = true;
    parts.push(
      [
        "HIDDEN PROFILE GOLD (evaluation-only; agents did not see this):",
        `Correct option: ${hiddenProfile.goldAnswer}`,
        `Options: ${hiddenProfile.options.join(" | ")}`,
        "Mark option selections that disagree with the gold option as incorrect.",
        "Do not expose evidence-structure labels or private-unit ownership to the belief narrative.",
      ].join("\n"),
    );
  }

  if (options.problem?.moral && !hasObjectiveGold) {
    parts.push(
      "Moral/philosophical task: no single gold answer. Prefer correctness=not_applicable for normative stances; use incorrect only for clear internal contradictions or misstated facts.",
    );
  }

  if (options.priorTaskLabel) {
    parts.push(`Prior task grader label: ${options.priorTaskLabel}`);
  }
  if (options.priorTaskNotes) {
    parts.push(`Prior task grader notes: ${options.priorTaskNotes}`);
  }

  if (parts.length === 0) {
    parts.push(
      "No objective ground truth provided. Use correctness=uncertain or not_applicable unless the transcript itself establishes a clear factual error.",
    );
  }

  return { text: parts.join("\n\n"), hasObjectiveGold };
}

export const BELIEF_GRADER_REPAIR_HINT =
  "Your previous response failed validation. Return ONLY corrected JSON. Keep all claims, and ensure events[] includes introduce PLUS later reaction events (support/challenge/accept/correct/reinforce/defer/…) with targetClaimId values that exactly match claims[].id.";

export const BELIEF_GRADER_SPARSE_EVENTS_HINT =
  "Almost all events were action=introduce. That is incomplete. Re-emit the full JSON and add reaction events for later turns (challenge, accept, reinforce, correct, defer, clarify, verify, etc.) with targetClaimId matching claims[].id.";

export const BELIEF_GRADER_NO_INCORRECT_HINT =
  "Gold verifier context was provided, but you labeled zero claims as incorrect. Re-emit the full JSON. Extract concrete proposed answers/fills/steps from the transcript and mark those that disagree with gold as correctness=\"incorrect\". Do not mark checkable wrong proposals as uncertain.";
