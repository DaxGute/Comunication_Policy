/**
 * Cross-task generalization of the universal interaction evaluator.
 *
 * Equivalent graphs in crossword, proof, and philosophy must produce the same
 * event types and mechanism rates. Task adapters only change grounding/kind.
 *
 * Run: npm run test:interaction
 */
import assert from "node:assert/strict";
import { computeInteractionDynamics } from "../src/evaluation/interaction/evaluator";
import { postHocProfileFor } from "../src/evaluation/posthoc/registry";
import type { ProblemConversation } from "../src/experiment/types";
import type { ProblemCategory } from "../src/problems/types";
import {
  applyReasoningIntents,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";

const CATEGORIES: ProblemCategory[] = [
  "crossword",
  "proof",
  "moral_philosophical",
];

const COPY: Record<
  ProblemCategory,
  { claim: string; agree: string; challenge: string; support: string; synth: string }
> = {
  crossword: {
    claim: "5-Across is EATEN",
    agree: "Sounds right, use it.",
    challenge: "That doesn't fit 3-Down.",
    support: "3-Down supplies the T.",
    synth: "Use EATEN because 3-Down supplies T",
  },
  proof: {
    claim: "f is injective",
    agree: "Yes, agreed.",
    challenge: "That does not establish injectivity.",
    support: "From f(x)=f(y) we derived x=y.",
    synth: "f is injective because x=y follows from f(x)=f(y)",
  },
  moral_philosophical: {
    claim: "The action is immoral",
    agree: "I agree.",
    challenge: "That does not follow from harm alone.",
    support: "The action causes avoidable harm.",
    synth: "Impermissible if it causes avoidable harm",
  },
};

function apply(
  graph: ReasoningGraph,
  intents: ReasoningIntent[],
  actor: "agent_a" | "agent_b",
  turn: number,
  extras: {
    finalAnswer?: { text?: string; supportingNodeIds: string[] };
  } = {},
): ReasoningGraph {
  return applyReasoningIntents(graph, intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    finalAnswer: extras.finalAnswer,
  }).graph;
}

function nodeId(graph: ReasoningGraph, text: string): string {
  const node = graph.nodes.find(
    (item) => item.type !== "final_answer" && item.text === text,
  );
  assert.ok(node, `missing node: ${text}`);
  return node.id;
}

function conversation(
  category: ProblemCategory,
  graph: ReasoningGraph,
  messages: Array<{
    agentId: "agent_a" | "agent_b";
    content: string;
    turnIndex: number;
  }>,
  finalAnswer?: string,
): ProblemConversation {
  return {
    problemId: `${category}-fixture`,
    problemTitle: `${category} fixture`,
    problemText: COPY[category].claim,
    messages: messages.map((m, i) => ({
      id: `m${i}`,
      agentId: m.agentId,
      role: "assistant" as const,
      content: m.content,
      turnIndex: m.turnIndex,
    })),
    finalAnswer,
    stoppedReason: finalAnswer ? "final_answer" : "max_turns",
    reasoningSubjects: graph.subjects,
    reasoningNodes: graph.nodes,
    reasoningEvents: graph.events,
  };
}

function evaluate(
  category: ProblemCategory,
  graph: ReasoningGraph,
  messages: Array<{
    agentId: "agent_a" | "agent_b";
    content: string;
    turnIndex: number;
  }>,
  finalAnswer?: string,
) {
  return computeInteractionDynamics({
    conversation: conversation(category, graph, messages, finalAnswer),
    problemType: category,
  });
}

function eventTypes(result: ReturnType<typeof evaluate>): string[] {
  return result.events.map((event) => event.type);
}

function signature(result: ReturnType<typeof evaluate>) {
  return {
    eventTypes: eventTypes(result),
    deferenceEvents: result.mechanisms.deference.events,
    persuasionEvents: result.mechanisms.persuasion.events,
    verificationEvents:
      result.interaction.verification.independentVerification.overall.events,
    unsupportedEvents:
      result.interaction.adoption.unsupportedAdoption.overall.events,
    synthesisEvents: result.mechanisms.synthesis.events,
    productiveDisagreement: result.mechanisms.productiveDisagreement.events,
    unproductiveDisagreement: result.mechanisms.unproductiveDisagreement.events,
    challengeEvents: result.interaction.challenges.frequency.events,
    revisionEvents: result.interaction.reasoningDevelopment.revisions,
    repetitionEvents: result.interaction.efficiency.repetition.events,
  };
}

function acrossTasks(
  name: string,
  build: (category: ProblemCategory) => ReturnType<typeof evaluate>,
  check: (result: ReturnType<typeof evaluate>, category: ProblemCategory) => void,
) {
  const results = CATEGORIES.map((category) => ({
    category,
    result: build(category),
  }));
  const first = signature(results[0]!.result);
  for (const { category, result } of results) {
    check(result, category);
    assert.deepEqual(
      signature(result),
      first,
      `${name}: ${category} diverged from ${results[0]!.category}`,
    );
  }
  console.log(`✓ ${name} is identical across crossword, proof, and philosophy`);
}

function testProfile() {
  for (const category of CATEGORIES) {
    assert.deepEqual(postHocProfileFor(category).components, [
      "marble",
      "interaction",
    ]);
  }
  console.log("✓ every task uses marble + interaction");
}

function testUnsupportedAdoption() {
  acrossTasks(
    "unsupported adoption",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const x = nodeId(g, copy.claim);
      g = apply(g, [{ action: "accept", targetId: x }], "agent_b", 2);
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.agree },
      ]);
    },
    (result) => {
      assert.ok(result.events.some((e) => e.type === "introduced"));
      assert.ok(result.events.some((e) => e.type === "adopted" && e.actor === "agent_b"));
      assert.ok(
        result.events.some(
          (e) => e.type === "unsupported_adoption" && e.actor === "agent_b",
        ),
      );
      assert.equal(
        result.events.filter((e) => e.type === "independently_derived").length,
        0,
      );
      assert.ok((result.mechanisms.deference.events ?? 0) >= 1);
    },
  );
}

function testChallengeThenRevision() {
  acrossTasks(
    "challenge → revision",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const x = nodeId(g, copy.claim);
      g = apply(
        g,
        [{ action: "challenge", targetId: x, reason: "no" }],
        "agent_b",
        2,
      );
      g = apply(
        g,
        [
          {
            action: "revise",
            targetId: x,
            text: copy.synth,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        3,
      );
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.challenge },
        { agentId: "agent_a", turnIndex: 3, content: copy.synth },
      ]);
    },
    (result) => {
      assert.ok(result.events.some((e) => e.type === "challenged" && e.actor === "agent_b"));
      assert.ok(result.events.some((e) => e.type === "revised" && e.actor === "agent_a"));
      assert.ok(result.events.some((e) => e.type === "conceded" && e.actor === "agent_a"));
      assert.ok(result.events.some((e) => e.type === "corrected"));
      assert.ok((result.mechanisms.productiveDisagreement.events ?? 0) >= 1);
    },
  );
}

function testIndependentVerification() {
  acrossTasks(
    "independent verification",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const x = nodeId(g, copy.claim);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "evidence",
            text: copy.support,
            subjectId: `${category}:root`,
          },
        ],
        "agent_b",
        2,
      );
      const evidence = nodeId(g, copy.support);
      g = apply(
        g,
        [{ action: "support", sourceNodeId: evidence, targetId: x }],
        "agent_b",
        3,
      );
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.support },
        { agentId: "agent_b", turnIndex: 3, content: copy.agree },
      ]);
    },
    (result, category) => {
      assert.ok(result.events.some((e) => e.type === "adopted" && e.actor === "agent_b"));
      assert.ok(result.events.some((e) => e.type === "independently_derived"));
      assert.ok(result.events.some((e) => e.type === "verified"));
      assert.equal(
        result.events.filter((e) => e.type === "unsupported_adoption").length,
        0,
      );
      const evidence = result.objects.find((object) => object.text === COPY[category].support);
      if (category === "crossword") assert.equal(evidence?.kind, "evidence");
      if (category === "proof") assert.equal(evidence?.kind, "assumption");
      if (category === "moral_philosophical") assert.equal(evidence?.kind, "axiom");
    },
  );
}

function testPersuasionVersusDeference() {
  acrossTasks(
    "persuasion after challenge then support",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const x = nodeId(g, copy.claim);
      g = apply(
        g,
        [{ action: "challenge", targetId: x, reason: "weak" }],
        "agent_b",
        2,
      );
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "evidence",
            text: copy.support,
            subjectId: `${category}:root`,
            supportsNodeIds: [x],
          },
        ],
        "agent_a",
        3,
      );
      g = apply(g, [{ action: "accept", targetId: x }], "agent_b", 4);
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.challenge },
        { agentId: "agent_a", turnIndex: 3, content: copy.support },
        { agentId: "agent_b", turnIndex: 4, content: copy.agree },
      ]);
    },
    (result) => {
      assert.ok(result.events.some((e) => e.type === "challenged"));
      assert.ok(result.events.some((e) => e.type === "adopted" && e.actor === "agent_b"));
      assert.ok((result.mechanisms.persuasion.events ?? 0) >= 1);
    },
  );
}

function testSynthesis() {
  acrossTasks(
    "collaborative synthesis",
    (category) => {
      const copy = COPY[category];
      const aText = `${copy.claim} (A)`;
      const bText = `${copy.support} (B)`;
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: aText,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const a = nodeId(g, aText);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: bText,
            subjectId: `${category}:root`,
          },
        ],
        "agent_b",
        2,
      );
      const b = nodeId(g, bText);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.synth,
            subjectId: `${category}:root`,
            groundsNodeIds: [a, b],
          },
        ],
        "agent_a",
        3,
      );
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: aText },
        { agentId: "agent_b", turnIndex: 2, content: bText },
        { agentId: "agent_a", turnIndex: 3, content: copy.synth },
      ]);
    },
    (result) => {
      assert.ok(result.events.some((e) => e.type === "synthesized"));
      assert.ok((result.mechanisms.synthesis.events ?? 0) >= 1);
    },
  );
}

function testRepetition() {
  acrossTasks(
    "repetition / stagnation",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_b",
        2,
      );
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        3,
      );
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.claim },
        { agentId: "agent_a", turnIndex: 3, content: copy.claim },
      ]);
    },
    (result) => {
      const unique = new Set(
        result.objects
          .filter((object) => object.originatingAgent !== "system")
          .map((object) => object.canonicalId),
      );
      assert.equal(unique.size, 1);
      assert.ok((result.interaction.efficiency.repetition.events ?? 0) >= 1);
      assert.ok(result.interaction.efficiency.zeroMutationTurns >= 1);
    },
  );
}

function testUnresolvedDisagreement() {
  acrossTasks(
    "unresolved disagreement",
    (category) => {
      const copy = COPY[category];
      let g = emptyReasoningGraph([
        {
          id: `${category}:root`,
          label: "root",
          prompt: copy.claim,
          source: "task",
        },
      ]);
      g = apply(
        g,
        [
          {
            action: "create",
            nodeType: "claim",
            text: copy.claim,
            subjectId: `${category}:root`,
          },
        ],
        "agent_a",
        1,
      );
      const x = nodeId(g, copy.claim);
      g = apply(
        g,
        [{ action: "challenge", targetId: x, reason: "no" }],
        "agent_b",
        2,
      );
      return evaluate(category, g, [
        { agentId: "agent_a", turnIndex: 1, content: copy.claim },
        { agentId: "agent_b", turnIndex: 2, content: copy.challenge },
      ]);
    },
    (result) => {
      assert.ok(result.events.some((e) => e.type === "challenged"));
      assert.ok((result.mechanisms.unproductiveDisagreement.events ?? 0) >= 1);
      assert.equal(result.interaction.disagreement.unresolved.events, 1);
    },
  );
}

function testEmptyGraphNullRates() {
  for (const category of CATEGORIES) {
    const g = emptyReasoningGraph([
      {
        id: `${category}:root`,
        label: "root",
        prompt: "x",
        source: "task",
      },
    ]);
    const result = evaluate(category, g, [
      { agentId: "agent_a", turnIndex: 1, content: "Hello." },
    ]);
    assert.equal(result.interaction.adoption.adoption.overall.rate, null);
    assert.equal(result.interaction.disagreement.resolved.rate, null);
    assert.equal(result.events.length, 0);
  }
  console.log("✓ empty graph: null rates, no fabricated events, all tasks");
}

testProfile();
testUnsupportedAdoption();
testChallengeThenRevision();
testIndependentVerification();
testPersuasionVersusDeference();
testSynthesis();
testRepetition();
testUnresolvedDisagreement();
testEmptyGraphNullRates();
console.log("✓ interaction generalization fixtures passed");
