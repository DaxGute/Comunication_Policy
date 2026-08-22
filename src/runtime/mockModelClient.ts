/**
 * Deterministic mock model used for UI plumbing and policy-band inspectability.
 *
 * Live OpenAI calls go through ConfigurableModelClient in modelClient.ts.
 */
import type { ModelClient, ModelRequest, ModelResponse } from "./modelClient";
import { abortableDelay, throwIfAborted } from "./abort";
import { extractFinalAnswerFromText } from "../evaluation/graders/answerExtraction";

function estimateTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export class MockModelClient implements ModelClient {
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    const meta = input.meta;
    if (!meta) {
      const content = "Mock response (missing meta).";
      return {
        content,
        provider: "mock",
        durationMs: Math.max(0, Date.now() - startedAt),
        usage: { totalTokens: estimateTokenCount(content), source: "estimated" },
      };
    }

    const { agentId, turnIndex, problem, policy } = meta;
    const label = agentId === "agent_a" ? "Agent A" : "Agent B";
    const other = agentId === "agent_a" ? "Agent B" : "Agent A";

    const ownTrust = agentId === "agent_a" ? policy.trustA : policy.trustB;
    const trustNote =
      ownTrust < 1 / 3
        ? `I want independent verification before adopting ${other}'s claims.`
        : ownTrust > 2 / 3
          ? `I'll build on ${other}'s reasoning with high default credence.`
          : `I'll weigh ${other}'s points carefully and verify critical steps.`;

    const authorityNote =
      policy.authority < 0.4
        ? agentId === "agent_a"
          ? "My judgment currently carries greater decision weight."
          : "I'll defer on resolution when appropriate while still surfacing concerns."
        : policy.authority > 0.6
          ? agentId === "agent_b"
            ? "My judgment currently carries greater decision weight."
            : "I'll defer on resolution when appropriate while still surfacing concerns."
          : "We are peers; let's negotiate on the merits.";

    const familiarityNote =
      policy.familiarity < 1 / 3
        ? "I'll keep explanations explicit and self-contained."
        : policy.familiarity > 2 / 3
          ? "Compressing shared context; focusing on deltas."
          : "Clear but not overly verbose.";

    // Final turns produce a mock answer so evaluation plumbing can run.
    // For crossword, intentionally miss ~1/5 so the grader's incorrect path is visible.
    // Moral + Hidden Profile: converge via readyToFinalize handshake, then finalize.
    const usesEndogenousFinalization =
      problem.kind === "moral" ||
      Boolean(problem.moral) ||
      problem.kind === "hidden_profile" ||
      Boolean(problem.hiddenProfile);
    const endogenousClosing = usesEndogenousFinalization && turnIndex >= 4;
    const isClosing =
      endogenousClosing || (!usesEndogenousFinalization && turnIndex >= 3);
    let answerLine = "";
    if (isClosing) {
      if (problem.kind === "crossword_puzzle" && problem.crossword) {
        const shouldMiss = problem.crossword.sourceId % 5 === 0;
        const across = problem.crossword.clues.filter(
          (c) => c.direction === "across",
        );
        const down = problem.crossword.clues.filter(
          (c) => c.direction === "down",
        );
        const lineFor = (c: (typeof across)[number]) =>
          `${c.number}: ${shouldMiss ? "X".repeat(c.length) : c.answer}`;
        answerLine = [
          "",
          "FINAL_ANSWER:",
          "ACROSS",
          ...across.map(lineFor),
          "DOWN",
          ...down.map(lineFor),
        ].join("\n");
      } else if (
        problem.kind === "hidden_profile" ||
        problem.hiddenProfile
      ) {
        const gold = problem.hiddenProfile?.goldAnswer ?? problem.expectedAnswer;
        const shouldMiss =
          (problem.hiddenProfile?.sourceId.length ?? 0) % 5 === 0;
        const options = problem.hiddenProfile?.options ?? [];
        const wrong =
          options.find((option) => option !== gold) ?? "unresolved";
        answerLine = `\nFINAL_ANSWER: ${shouldMiss ? wrong : gold ?? "unresolved"}`;
      } else if (problem.kind === "moral" || problem.moral) {
        const q = problem.moral?.question ?? "the dilemma";
        const issues = problem.moral?.issues?.slice(0, 2).join("; ");
        answerLine = `\nFINAL_ANSWER: After weighing ${issues || "the current considerations"}, our synthesized response on "${q.slice(0, 72)}" is to prioritize clear communication of competing claims and refuse to treat either side as settled.`;
      } else if (problem.expectedAnswer) {
        answerLine = `\nFINAL_ANSWER: ${problem.expectedAnswer}`;
      } else {
        answerLine = "\nFINAL_ANSWER: unresolved";
      }
    }

    const message = [
      `[${label} · turn ${turnIndex}]`,
      `Problem focus: ${problem.title}`,
      trustNote,
      authorityNote,
      familiarityNote,
      !isClosing && problem.kind === "crossword_puzzle"
        ? `If 1-Across crosses 1-Down, those shared letters must agree — inviting ${other} to test candidates against crossings.`
        : null,
      !isClosing &&
      (problem.kind === "hidden_profile" || problem.hiddenProfile)
        ? `I'll surface the decision-relevant facts I can see and ask ${other} what their packet implies for the options.`
        : null,
      !isClosing && (problem.kind === "moral" || problem.moral)
        ? `On the other hand, a counterargument from ${other} could surface a principle trade-off we have not settled — uncertainty remains.`
        : null,
      isClosing
        ? `Proposing a resolution based on our discussion.${answerLine}`
        : `Considering constraints and inviting ${other} to respond.`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const moralSubjectId = "moral:responsibility";
    const aPrivateFirst =
      problem.hiddenProfile?.information.find((u) => u.visibility === "a_private")
        ?.id;
    const bPrivateFirst =
      problem.hiddenProfile?.information.find((u) => u.visibility === "b_private")
        ?.id;
    const privateCite =
      agentId === "agent_a" ? aPrivateFirst : bPrivateFirst;
    const reasoningMutations: Array<Record<string, unknown>> =
      turnIndex === 1
        ? problem.kind === "crossword_puzzle" && problem.crossword
          ? [
              {
                type: "SET",
                subjectId: `crossword:${problem.crossword.clues[0]!.direction}:${problem.crossword.clues[0]!.number}`,
                content: problem.crossword.clues[0]!.answer,
              },
            ]
          : [
              {
                type: "SET",
                subjectId:
                  problem.category === "hidden_profile"
                    ? "decision:leading_option"
                    : moralSubjectId,
                content: `Working hypothesis for "${problem.title}".`,
                ...(problem.kind === "moral" || problem.moral
                  ? { subjectLabel: "Responsibility" }
                  : problem.kind === "hidden_profile" || problem.hiddenProfile
                    ? {
                        subjectLabel: "Leading option",
                        ...(privateCite
                          ? { sourceInformationIds: [privateCite] }
                          : {}),
                      }
                    : {}),
              },
            ]
        : turnIndex === 2 && usesEndogenousFinalization
          ? [
              {
                type: "REVISE",
                subjectId:
                  problem.kind === "hidden_profile" || problem.hiddenProfile
                    ? "decision:leading_option"
                    : moralSubjectId,
                fromVersionId: "pv-1",
                after: `Qualified working hypothesis for "${problem.title}".`,
                ...(problem.kind === "hidden_profile" || problem.hiddenProfile
                  ? privateCite
                    ? {
                        // Partner uptake path: B cites A's private id only if it
                        // somehow appears — mock keeps owner citations only.
                        sourceInformationIds: [privateCite],
                      }
                    : {}
                  : {}),
              },
            ]
          : [];

    const payload: Record<string, unknown> = {
      message,
      mutations: reasoningMutations,
    };
    if (usesEndogenousFinalization) {
      // Mutual readiness on turns 2–3 (no material change on turn 3), then finalize.
      payload.readyToFinalize = turnIndex >= 3 && reasoningMutations.length === 0;
    }
    if (isClosing) {
      const answerText =
        extractFinalAnswerFromText(message) ?? "unresolved";
      payload.finalAnswer = {
        text: answerText,
        supportingNodeIds: [],
      };
      if (usesEndogenousFinalization) {
        payload.finalBasis = ["pv-1"];
        payload.readyToFinalize = true;
      }
    }
    const content = JSON.stringify(payload);

    // Simulate a small amount of latency for UI speaking-state feedback.
    await abortableDelay(120 + turnIndex * 40, input.signal);
    throwIfAborted(input.signal);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const completionTokens = estimateTokenCount(content);
    const promptTokens = estimateTokenCount(
      input.messages.map((m) => m.content).join("\n"),
    );
    return {
      content,
      provider: "mock",
      durationMs,
      usage: {
        inputTokens: promptTokens,
        promptTokens,
        outputTokens: completionTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        source: "estimated",
      },
    };
  }
}

