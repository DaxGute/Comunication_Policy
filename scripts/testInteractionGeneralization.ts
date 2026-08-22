/**
 * Cross-task generalization of the interaction evaluator over SET/REVISE.
 *
 * Run: npm run test:interaction
 */
import assert from "node:assert/strict";
import { computeInteractionDynamics } from "../src/evaluation/interaction/evaluator";
import { postHocProfileFor } from "../src/evaluation/posthoc/registry";
import type { ProblemConversation } from "../src/experiment/types";
import type { ProblemCategory } from "../src/problems/types";
import {
  applyReasoningMutations,
  emptyReasoningGraph,
  type ReasoningGraph,
  type ReasoningMutation,
} from "../src/reasoning";

const CATEGORIES: ProblemCategory[] = [
  "crossword",
  "hidden_profile",
  "moral_philosophical",
];

const COPY: Record<ProblemCategory, { first: string; second: string; subjectId: string }> = {
  crossword: {
    first: "EATEN",
    second: "EATER",
    subjectId: "crossword:across:5",
  },
  hidden_profile: {
    first: "Casey is the balanced hire",
    second: "Casey remains best once reliability is pooled",
    subjectId: "decision:root",
  },
  moral_philosophical: {
    first: "The action is immoral",
    second: "The action is immoral if harm was foreseeable",
    subjectId: "moral:root",
  },
};

function apply(
  graph: ReasoningGraph,
  mutations: ReasoningMutation[],
  actor: "agent_a" | "agent_b",
  turn: number,
): ReasoningGraph {
  return applyReasoningMutations(graph, mutations, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
  }).graph;
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
    problemText: COPY[category].first,
    messages: messages.map((m, i) => ({
      id: `m${i}`,
      agentId: m.agentId,
      role: "assistant" as const,
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

function fixture(category: ProblemCategory) {
  const copy = COPY[category];
  let graph = emptyReasoningGraph([
    {
      id: copy.subjectId,
      label: copy.subjectId,
      source: "task" as const,
    },
  ]);
  graph = apply(
    graph,
    [{ type: "SET", subjectId: copy.subjectId, content: copy.first }],
    "agent_a",
    1,
  );
  graph = apply(
    graph,
    [
      {
        type: "REVISE",
        subjectId: copy.subjectId,
        before: copy.first,
        after: copy.second,
      },
    ],
    "agent_b",
    2,
  );
  return evaluate(category, graph, [
    { agentId: "agent_a", turnIndex: 1, content: copy.first },
    { agentId: "agent_b", turnIndex: 2, content: copy.second },
  ]);
}

{
  assert.deepEqual(postHocProfileFor("crossword").components, [
    "marble",
    "interaction",
  ]);
  assert.deepEqual(postHocProfileFor("hidden_profile").components, [
    "marble",
    "interaction",
  ]);
  assert.deepEqual(postHocProfileFor("moral_philosophical").components, [
    "marble",
    "interaction",
  ]);
  console.log("✓ every task uses marble + interaction");
}

{
  const results = CATEGORIES.map((category) => fixture(category));
  const types = results.map((result) =>
    result.events.map((event) => event.type).sort(),
  );
  assert.deepEqual(types[0], types[1]);
  assert.deepEqual(types[1], types[2]);
  assert.ok(types[0]?.includes("introduced"));
  assert.ok(types[0]?.includes("revised"));
  assert.ok(!types[0]?.includes("adopted"));
  console.log("✓ SET/REVISE event types are identical across crossword, hidden profile, and philosophy");
}

{
  for (const category of CATEGORIES) {
    const copy = COPY[category];
    const g = emptyReasoningGraph([
      {
        id: copy.subjectId,
        label: "root",
        prompt: "x",
        source: "task",
      },
    ]);
    const result = evaluate(category, g, [
      { agentId: "agent_a", turnIndex: 1, content: "Hello." },
    ]);
    assert.equal(result.interaction.adoption.adoption.overall.rate, null);
    assert.equal(result.events.filter((event) => event.source === "graph").length, 0);
  }
  console.log("✓ empty graph: null rates, no fabricated events, all tasks");
}

console.log("✓ interaction generalization fixtures passed");
