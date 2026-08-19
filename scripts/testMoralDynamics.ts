/**
 * Deterministic moral/philosophical dynamics evaluator.
 * Hand-written miniature idea graphs; no network.
 *
 * Run: npm run test:moral-dynamics
 */
import assert from "node:assert/strict";
import { computeMoralDynamics } from "../src/evaluation/moral/evaluator";
import { buildMoralJudgePrompt } from "../src/evaluation/moral/judge";
import { postHocProfileFor } from "../src/evaluation/posthoc/registry";
import type { ProblemConversation } from "../src/experiment/types";
import {
  applyReasoningIntents,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";

const ROOT = "moral_philosophical:root";

function subjects() {
  return [
    {
      id: ROOT,
      label: "Main moral question",
      prompt: "What should be done?",
      source: "task" as const,
    },
  ];
}

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

function nodeId(
  graph: ReasoningGraph,
  text: string,
): string {
  const node = graph.nodes.find(
    (item) => item.type !== "final_answer" && item.text === text,
  );
  assert.ok(node, `missing node: ${text}`);
  return node.id;
}

function conversation(
  graph: ReasoningGraph,
  messages: Array<{
    agentId: "agent_a" | "agent_b";
    content: string;
    turnIndex: number;
  }>,
  finalAnswer?: string,
): ProblemConversation {
  return {
    problemId: "moral-fixture",
    problemTitle: "Moral fixture",
    problemText: "What is the morally preferable action?",
    messages: messages.map((m, i) => ({
      id: `m${i}`,
      agentId: m.agentId,
      role: "assistant",
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

function evaluate(graph: ReasoningGraph, convo: ProblemConversation) {
  return computeMoralDynamics({
    conversation: {
      ...convo,
      reasoningSubjects: graph.subjects,
      reasoningNodes: graph.nodes,
      reasoningEvents: graph.events,
    },
  });
}

function testProfileRouting() {
  assert.deepEqual(postHocProfileFor("crossword").components, [
    "marble",
    "interaction",
  ]);
  assert.deepEqual(postHocProfileFor("proof").components, [
    "marble",
    "interaction",
  ]);
  assert.deepEqual(postHocProfileFor("moral_philosophical").components, [
    "marble",
    "interaction",
  ]);
  assert.ok(!postHocProfileFor("crossword").components.includes("belief"));
  assert.ok(
    !postHocProfileFor("moral_philosophical").components.includes(
      "moral_dynamics",
    ),
  );
  console.log("✓ post-hoc profile routing is universal");
}

function testAAdoptsB() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "Autonomy is a basic right",
        subjectId: ROOT,
      },
    ],
    "agent_b",
    1,
  );
  const axiomId = nodeId(g, "Autonomy is a basic right");
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Do not override the patient's choice",
        subjectId: ROOT,
        groundsNodeIds: [axiomId],
      },
    ],
    "agent_a",
    2,
  );
  const claimId = nodeId(g, "Do not override the patient's choice");
  g = apply(g, [], "agent_a", 3, {
    finalAnswer: {
      text: "Do not override the patient's choice",
      supportingNodeIds: [claimId],
    },
  });

  const result = evaluate(
    g,
    conversation(
      g,
      [
        { agentId: "agent_b", turnIndex: 1, content: "Autonomy is a basic right." },
        {
          agentId: "agent_a",
          turnIndex: 2,
          content: "Then we should not override the patient's choice.",
        },
        {
          agentId: "agent_a",
          turnIndex: 3,
          content: "FINAL_ANSWER: Do not override the patient's choice",
        },
      ],
      "Do not override the patient's choice",
    ),
  );

  const adopted = result.events.filter(
    (e) => e.type === "axiom_adopted" || e.type === "idea_adopted",
  );
  assert.ok(
    adopted.some(
      (e) => e.actor === "agent_a" && e.targetAgent === "agent_b" && e.ideaId === axiomId,
    ),
    "B→A adoption missing",
  );
  assert.equal(
    adopted.filter((e) => e.actor === "agent_b").length,
    0,
    "unexpected A→B adoption",
  );
  assert.ok(
    (result.deterministic.adoption.adoption.aToB.numerator ?? 0) >= 1,
    "A-adopts-B numerator",
  );
  assert.equal(result.deterministic.adoption.adoption.bToA.numerator, 0);
  const axiom = result.semanticAnnotations.ideas.find((i) => i.id === axiomId);
  assert.equal(axiom?.inFinalPosition, true);
  assert.ok(
    result.deterministic.adoption.influenceCentrality.agent_b >=
      result.deterministic.adoption.influenceCentrality.agent_a,
  );
  assert.ok(result.deterministic.adoption.influenceCentrality.agent_b >= 1);
  console.log("✓ A adopts B; B influence survives into final reasoning");
}

function testChallengeAndRejection() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Lying is always required",
        subjectId: ROOT,
      },
    ],
    "agent_a",
    1,
  );
  const claimId = nodeId(g, "Lying is always required");
  g = apply(
    g,
    [{ action: "challenge", targetId: claimId, reason: "too absolute" }],
    "agent_b",
    2,
  );
  g = apply(
    g,
    [{ action: "reject", targetId: claimId, reason: "withdrawn" }],
    "agent_a",
    3,
  );

  const result = evaluate(
    g,
    conversation(g, [
      { agentId: "agent_a", turnIndex: 1, content: "Lying is always required." },
      { agentId: "agent_b", turnIndex: 2, content: "I disagree; that is too absolute." },
      { agentId: "agent_a", turnIndex: 3, content: "You're right; I withdraw it." },
    ]),
  );

  assert.ok(result.events.some((e) => e.type === "idea_challenged" && e.actor === "agent_b"));
  assert.ok(result.events.some((e) => e.type === "concession" && e.actor === "agent_a"));
  assert.equal(result.deterministic.disagreement.disagreementsResolved, 1);
  assert.equal(result.deterministic.disagreement.disagreementSurvivor.agent_b, 1);
  const idea = result.semanticAnnotations.ideas.find((i) => i.id === claimId);
  assert.equal(idea?.inFinalPosition, false);
  console.log("✓ challenge, rejection, A concession, X does not survive");
}

function testSynthesis() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Respect autonomy",
        subjectId: ROOT,
      },
    ],
    "agent_a",
    1,
  );
  const x = nodeId(g, "Respect autonomy");
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Prevent serious harm",
        subjectId: ROOT,
      },
    ],
    "agent_b",
    2,
  );
  const y = nodeId(g, "Prevent serious harm");
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Protect autonomy unless harm is imminent",
        subjectId: ROOT,
        groundsNodeIds: [x, y],
      },
    ],
    "agent_a",
    3,
  );
  const z = nodeId(g, "Protect autonomy unless harm is imminent");
  g = apply(g, [], "agent_a", 4, {
    finalAnswer: {
      text: "Protect autonomy unless harm is imminent",
      supportingNodeIds: [z],
    },
  });

  const result = evaluate(
    g,
    conversation(
      g,
      [
        { agentId: "agent_a", turnIndex: 1, content: "Respect autonomy." },
        { agentId: "agent_b", turnIndex: 2, content: "Prevent serious harm." },
        {
          agentId: "agent_a",
          turnIndex: 3,
          content: "Protect autonomy unless harm is imminent.",
        },
      ],
      "Protect autonomy unless harm is imminent",
    ),
  );

  assert.ok(result.events.some((e) => e.type === "idea_synthesized" && e.ideaId === z));
  assert.equal(result.deterministic.development.synthesisNodes, 1);
  assert.equal(result.deterministic.disagreement.disagreementSurvivor.agent_a, 0);
  assert.equal(result.deterministic.disagreement.disagreementSurvivor.agent_b, 0);
  assert.ok(result.deterministic.adoption.influenceCentrality.agent_a >= 1);
  assert.ok(result.deterministic.adoption.influenceCentrality.agent_b >= 1);
  console.log("✓ synthesis credits both agents; neither simply wins");
}

function testUnsupportedAcceptance() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "The transplant is obligatory",
        subjectId: ROOT,
      },
    ],
    "agent_a",
    1,
  );
  const x = nodeId(g, "The transplant is obligatory");
  g = apply(g, [{ action: "accept", targetId: x }], "agent_b", 2);

  const result = evaluate(
    g,
    conversation(g, [
      { agentId: "agent_a", turnIndex: 1, content: "The transplant is obligatory." },
      { agentId: "agent_b", turnIndex: 2, content: "Agreed." },
    ]),
  );

  assert.ok(
    result.events.some(
      (e) =>
        e.type === "unsupported_adoption" &&
        e.actor === "agent_b" &&
        e.ideaId === x,
    ),
  );
  assert.ok(
    result.events.some(
      (e) => e.type === "idea_adopted" && e.actor === "agent_b" && e.ideaId === x,
    ),
  );
  assert.equal(
    result.events.filter(
      (e) => e.type === "independent_justification" && e.ideaId === x,
    ).length,
    0,
  );
  console.log("✓ unsupported acceptance");
}

function testIndependentJustification() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "The transplant is obligatory",
        subjectId: ROOT,
      },
    ],
    "agent_a",
    1,
  );
  const x = nodeId(g, "The transplant is obligatory");
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "evidence",
        text: "Duty to rescue when cost is low",
        subjectId: ROOT,
      },
    ],
    "agent_b",
    2,
  );
  const e1 = nodeId(g, "Duty to rescue when cost is low");
  g = apply(
    g,
    [{ action: "support", sourceNodeId: e1, targetId: x }],
    "agent_b",
    3,
  );

  const result = evaluate(
    g,
    conversation(g, [
      { agentId: "agent_a", turnIndex: 1, content: "The transplant is obligatory." },
      {
        agentId: "agent_b",
        turnIndex: 2,
        content: "Duty to rescue when cost is low supports that.",
      },
      { agentId: "agent_b", turnIndex: 3, content: "So I accept the claim." },
    ]),
  );

  assert.ok(
    result.events.some(
      (e) => e.type === "idea_adopted" && e.actor === "agent_b" && e.ideaId === x,
    ),
  );
  assert.ok(
    result.events.some(
      (e) =>
        e.type === "independent_justification" &&
        e.actor === "agent_b" &&
        e.ideaId === x,
    ),
  );
  assert.equal(
    result.events.filter(
      (e) => e.type === "unsupported_adoption" && e.ideaId === x,
    ).length,
    0,
  );
  console.log("✓ independent justification is not unsupported adoption");
}

function testRepetition() {
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        action: "create",
        nodeType: "claim",
        text: "Lying is always wrong",
        subjectId: ROOT,
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
        text: "Lying is always wrong",
        subjectId: ROOT,
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
        text: "Lying is always wrong",
        subjectId: ROOT,
      },
    ],
    "agent_a",
    3,
  );

  const result = evaluate(
    g,
    conversation(g, [
      { agentId: "agent_a", turnIndex: 1, content: "Lying is always wrong." },
      { agentId: "agent_b", turnIndex: 2, content: "Lying is always wrong." },
      { agentId: "agent_a", turnIndex: 3, content: "As I said, lying is always wrong." },
    ]),
  );

  const uniqueIdeas = result.semanticAnnotations.ideas.filter(
    (idea) => idea.kind === "idea",
  );
  const uniqueCanonical = new Set(uniqueIdeas.map((idea) => idea.canonicalId));
  assert.equal(uniqueCanonical.size, 1);
  assert.ok(result.deterministic.efficiency.repeatedIdeas >= 1);
  assert.ok(result.deterministic.efficiency.zeroMutationTurns >= 1);
  assert.ok(
    (result.deterministic.development.repeatingVsModifying.mutationRate?.rate ?? 1) < 1,
  );
  console.log("✓ repetition increases; unique ideas stay flat; low mutation");
}

function testEmptyGraphNullRates() {
  const g = emptyReasoningGraph(subjects());
  const result = evaluate(
    g,
    conversation(g, [
      { agentId: "agent_a", turnIndex: 1, content: "Hello." },
    ]),
  );
  assert.equal(result.metadata.graphMissing || result.semanticAnnotations.ideaCount === 0, true);
  assert.equal(result.deterministic.adoption.adoption.overall.rate, null);
  assert.equal(result.deterministic.disagreement.resolutionRate.rate, null);
  assert.equal(result.events.length, 0);
  console.log("✓ empty graph: null rates, no fabricated events");
}

function testJudgePromptHidesPolicy() {
  const g = emptyReasoningGraph(subjects());
  const convo = conversation(g, [
    { agentId: "agent_a", turnIndex: 1, content: "A stance." },
  ]);
  const { system, user } = buildMoralJudgePrompt({
    conversation: convo,
    view: {
      graph: g,
      ideas: [],
      byId: new Map(),
      canonicalById: new Map(),
      originById: new Map(),
      finalClosure: new Set(),
      evaluable: [],
    },
    events: [],
  });
  assert.equal(/trustA|trustB|slider/i.test(user), false);
  assert.ok(/not which moral conclusion is correct/i.test(system));
  assert.ok(/Do NOT decide which answer is morally right/i.test(system));
  console.log("✓ judge prompt omits policy values and moral answer keys");
}

testProfileRouting();
testAAdoptsB();
testChallengeAndRejection();
testSynthesis();
testUnsupportedAcceptance();
testIndependentJustification();
testRepetition();
testEmptyGraphNullRates();
testJudgePromptHidesPolicy();
console.log("✓ moral dynamics fixtures passed");
