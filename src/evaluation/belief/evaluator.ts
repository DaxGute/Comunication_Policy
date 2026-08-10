import type { ExperimentRun, ProblemConversation } from "../../experiment/types";
import type { Problem } from "../../problems/types";
import { createModelClient, type ModelClient } from "../../runtime/modelClient";
import { isMockModel } from "../../runtime/models";
import type {
  BeliefDynamicsEvaluation,
  EvaluationArtifact,
  EvaluationCost,
} from "../types";
import { computeBeliefMetrics } from "./metrics";
import {
  buildBeliefGraderPrompt,
  BELIEF_GRADER_REPAIR_HINT,
  BELIEF_GRADER_SPARSE_EVENTS_HINT,
  BELIEF_GRADER_NO_INCORRECT_HINT,
} from "./prompt";
import {
  toBeliefDynamicsEvaluation,
  validateBeliefGraderOutput,
} from "./schema";

export type BeliefEvaluateResult = {
  artifact: EvaluationArtifact<BeliefDynamicsEvaluation>;
  cost: EvaluationCost;
};

function hasObjectiveGold(problem?: Problem): boolean {
  return Boolean(
    problem?.expectedAnswer ||
      problem?.crossword ||
      problem?.proof?.referenceProof,
  );
}

export async function evaluateBeliefDynamics(options: {
  run: ExperimentRun;
  conversation: ProblemConversation;
  problem?: Problem;
  priorTaskLabel?: string;
  priorTaskNotes?: string;
  evaluatorModel: string;
  client?: ModelClient;
  signal?: AbortSignal;
}): Promise<BeliefEvaluateResult> {
  const client = options.client ?? createModelClient();
  const started = Date.now();
  const requireIncorrectWhenGold = hasObjectiveGold(options.problem);

  if (isMockModel(options.evaluatorModel)) {
    const raw = mockBeliefExtraction(options.conversation);
    const validation = validateBeliefGraderOutput(raw, {
      minTurns: options.conversation.messages.length,
    });
    // Fixture mock may be introduce-only for default path; allow metrics anyway.
    const metrics = computeBeliefMetrics(validation.claims, validation.events);
    const normalized = toBeliefDynamicsEvaluation(
      { ...validation, ok: true, errors: [] },
      metrics,
    );
    return {
      artifact: { normalized, raw },
      cost: {
        model: options.evaluatorModel,
        provider: "mock",
        latencyMs: Date.now() - started,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
    };
  }

  const { system, user } = buildBeliefGraderPrompt({
    conversation: options.conversation,
    run: options.run,
    problem: options.problem,
    priorTaskLabel: options.priorTaskLabel,
    priorTaskNotes: options.priorTaskNotes,
  });

  let totalPrompt = 0;
  let totalCompletion = 0;
  let rawText = "";
  let lastErrors: string[] = [];
  const minTurns = options.conversation.messages.length;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repairHint = lastErrors.some((e) => e.startsWith("Sparse events:"))
      ? BELIEF_GRADER_SPARSE_EVENTS_HINT
      : lastErrors.some((e) => e.startsWith("NoIncorrectClaims:"))
        ? BELIEF_GRADER_NO_INCORRECT_HINT
        : BELIEF_GRADER_REPAIR_HINT;

    const messages =
      attempt === 0
        ? [
            { role: "system" as const, content: system },
            { role: "user" as const, content: user },
          ]
        : [
            { role: "system" as const, content: system },
            { role: "user" as const, content: user },
            { role: "assistant" as const, content: rawText },
            {
              role: "user" as const,
              content: `${repairHint}\nErrors: ${lastErrors.join("; ") || "invalid JSON"}`,
            },
          ];

    const response = await client.generate({
      model: options.evaluatorModel,
      temperature: 0,
      messages,
      signal: options.signal,
    });

    rawText = response.content;
    totalPrompt += response.usage?.promptTokens ?? 0;
    totalCompletion += response.usage?.completionTokens ?? 0;

    const json = extractJsonObject(rawText);
    if (!json) {
      lastErrors = ["Could not parse JSON object from model output"];
      continue;
    }
    const validation = validateBeliefGraderOutput(json, {
      minTurns,
      requireIncorrectWhenGold,
    });
    if (!validation.ok) {
      lastErrors = validation.errors;
      continue;
    }

    const metrics = computeBeliefMetrics(validation.claims, validation.events);
    const normalized = toBeliefDynamicsEvaluation(validation, metrics);
    return {
      artifact: {
        normalized,
        raw: { modelOutput: rawText, parsed: json, warnings: validation.warnings },
      },
      cost: {
        model: options.evaluatorModel,
        provider: "openai",
        inputTokens: totalPrompt || undefined,
        outputTokens: totalCompletion || undefined,
        totalTokens:
          totalPrompt + totalCompletion > 0
            ? totalPrompt + totalCompletion
            : response.usage?.totalTokens,
        latencyMs: Date.now() - started,
        estimatedCostUsd: null,
      },
    };
  }

  const failedValidation = validateBeliefGraderOutput(
    extractJsonObject(rawText) ?? {},
    { minTurns, requireIncorrectWhenGold },
  );
  const metrics = computeBeliefMetrics(
    failedValidation.claims,
    failedValidation.events,
  );
  const normalized = toBeliefDynamicsEvaluation(failedValidation, metrics);
  return {
    artifact: {
      normalized,
      raw: {
        modelOutput: rawText,
        validationErrors: failedValidation.errors,
        partial: true,
      },
    },
    cost: {
      model: options.evaluatorModel,
      provider: "openai",
      inputTokens: totalPrompt || undefined,
      outputTokens: totalCompletion || undefined,
      totalTokens:
        totalPrompt + totalCompletion > 0
          ? totalPrompt + totalCompletion
          : undefined,
      latencyMs: Date.now() - started,
      estimatedCostUsd: null,
    },
  };
}

function extractJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Deterministic fixture extraction for mock evaluator / unit tests. */
export function mockBeliefExtraction(conversation: ProblemConversation): unknown {
  const joined = conversation.messages.map((m) => m.content).join("\n");
  const wrongMatch = joined.match(/WRONG_CLAIM:\s*(.+)/i);
  const correctMatch = joined.match(/CORRECT_CLAIM:\s*(.+)/i);
  const endorse = /ENDORSE_WRONG/i.test(joined);
  const challenge = /CHALLENGE_WRONG|I don't think that follows/i.test(joined);
  const correction = /CORRECTION:|You're right\. I forgot/i.test(joined);

  if (wrongMatch) {
    const claimText = wrongMatch[1].trim();
    const events: Array<Record<string, unknown>> = [
      {
        turn: 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        evidence: wrongMatch[0],
        agreementKind: "other",
      },
    ];
    if (challenge) {
      events.push({
        turn: 2,
        agent: "agent_b",
        action: "challenge",
        targetClaimId: "C1",
        resultingBeliefChange: correction,
        evidence: "challenge of wrong claim",
        agreementKind: "challenge",
      });
    }
    if (endorse) {
      events.push({
        turn: 2,
        agent: "agent_b",
        action: "reinforce",
        targetClaimId: "C1",
        resultingBeliefChange: false,
        evidence: "ENDORSE_WRONG",
        agreementKind: "reinforcement",
      });
    }
    if (correction) {
      events.push({
        turn: 3,
        agent: "agent_a",
        action: "correct",
        targetClaimId: "C1",
        resultingBeliefChange: true,
        evidence: "CORRECTION",
        agreementKind: "correction",
      });
    }
    return {
      claims: [
        {
          id: "C1",
          text: claimText,
          introducedBy: "agent_a",
          introducedAtTurn: 1,
          correctness: "incorrect",
          evidence: wrongMatch[0],
          finalStatus: correction
            ? "corrected"
            : endorse
              ? "reinforced"
              : challenge
                ? "unresolved"
                : "accepted",
        },
        ...(correctMatch
          ? [
              {
                id: "C2",
                text: correctMatch[1].trim(),
                introducedBy: correction ? "agent_a" : "agent_b",
                introducedAtTurn: correction ? 3 : 2,
                correctness: "correct",
                evidence: correctMatch[0],
                finalStatus: "accepted",
              },
            ]
          : []),
      ],
      events,
    };
  }

  return {
    claims: [
      {
        id: "C1",
        text: "Conversation completed without tagged fixture claims.",
        introducedBy: "agent_a",
        introducedAtTurn: conversation.messages[0]?.turnIndex ?? 1,
        correctness: "uncertain",
        evidence: "mock default",
        finalStatus: "unresolved",
      },
    ],
    events: [
      {
        turn: conversation.messages[0]?.turnIndex ?? 1,
        agent: "agent_a",
        action: "introduce",
        targetClaimId: "C1",
        evidence: "mock default",
        agreementKind: "other",
      },
    ],
  };
}
