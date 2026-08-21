/**
 * Deterministic moral/philosophical dynamics over versioned graph state.
 *
 * Run: npm run test:moral-dynamics
 */
import assert from "node:assert/strict";
import { computeMoralDynamics } from "../src/evaluation/moral/evaluator";
import { buildMoralJudgePrompt } from "../src/evaluation/moral/judge";
import { postHocProfileFor } from "../src/evaluation/posthoc/registry";
import type { ProblemConversation } from "../src/experiment/types";
import {
  applyReasoningMutations,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";

const ROOT = "moral:root";

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
  mutations: ReasoningMutation[],
  actor: "agent_a" | "agent_b",
  turn: number,
  extras: { finalAnswerText?: string } = {},
): ReasoningGraph {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    finalAnswerText: extras.finalAnswerText,
  }).graph;
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
    reasoningSchemaVersion: 2,
    reasoningSubjects: graph.subjects,
    reasoningVersions: graph.versions,
    reasoningEvents: graph.events,
  };
}

function evaluate(graph: ReasoningGraph, convo: ProblemConversation) {
  return computeMoralDynamics({
    conversation: {
      ...convo,
      reasoningSubjects: graph.subjects,
      reasoningVersions: graph.versions,
      reasoningEvents: graph.events,
    },
  });
}

{
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
  console.log("✓ post-hoc profile routing is universal");
}

{
  let g = emptyReasoningGraph(subjects());
  g = apply(
    g,
    [
      {
        type: "SET",
        subjectId: ROOT,
        content: "Do not override the patient's choice",
      },
    ],
    "agent_b",
    1,
  );
  g = apply(
    g,
    [
      {
        type: "REVISE",
        subjectId: ROOT,
        before: "Do not override the patient's choice",
        after: "Override only to prevent imminent harm",
      },
    ],
    "agent_a",
    2,
  );
  const result = evaluate(
    g,
    conversation(
      g,
      [
        {
          agentId: "agent_b",
          turnIndex: 1,
          content: "Do not override the patient's choice.",
        },
        {
          agentId: "agent_a",
          turnIndex: 2,
          content: "Override only to prevent imminent harm.",
        },
      ],
    ),
  );
  assert.ok(result.events.some((event) => event.type === "idea_introduced"));
  assert.ok(result.events.some((event) => event.type === "idea_revised"));
  console.log("✓ SET/REVISE become idea_introduced / idea_revised");
}

{
  const g = emptyReasoningGraph(subjects());
  const result = evaluate(
    g,
    conversation(g, [{ agentId: "agent_a", turnIndex: 1, content: "Hello." }]),
  );
  assert.ok(result.metadata.graphMissing || result.semanticAnnotations.ideaCount === 0);
  assert.equal(result.deterministic.adoption.adoption.overall.rate, null);
  assert.equal(
    result.events.filter((event) => event.type === "idea_introduced").length,
    0,
  );
  console.log("✓ empty graph: null rates, no fabricated graph events");
}

{
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

console.log("✓ moral dynamics fixtures passed");
