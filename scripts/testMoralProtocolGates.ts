/**
 * Moral protocol gates: empty init, mutual readyToFinalize convergence,
 * material-change reset, premature FINAL_ANSWER rejection, fromVersionId.
 *
 * Run: npm run test:moral-protocol
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import { GRAPH_MEMORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import type { Problem } from "../src/problems/types";
import {
  NOT_CONVERGED_FEEDBACK,
  PERSISTENCE_REQUIRED_FEEDBACK,
  activeVersion,
  computeTurnScopes,
  currentValue,
  hydrateReasoningGraph,
} from "../src/reasoning";
import { runProblem } from "../src/runtime/runProblem";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import type { AgentId } from "../src/agents/types";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";

function moralProblem(): Problem {
  return {
    id: "moral-protocol-gate",
    category: "moral_philosophical",
    kind: "moral",
    title: "Gratitude",
    text: "Discussion question:\nIs gratitude required?\n\nThe shared reasoning graph is currently empty.",
    moral: {
      title: "Gratitude",
      description: "A gift is offered.",
      issues: ["Gratitude"],
      question: "Is gratitude required?",
      source: "reddit_ethics",
      sourceIndex: 1,
    },
  };
}

const policy = createCommunicationPolicy({});
const prompts = buildAgentPromptPair(policy);
const config = normalizeRunConfig(
  {
    problemCategory: "moral_philosophical",
    problemCount: 1,
    runModel: MOCK_MODEL_ID,
    maxTurns: 16,
    temperature: 0,
  },
  DEFAULT_RUN_CONFIG,
);

type ScriptedTurn = {
  message: string;
  mutations?: unknown[];
  nothingToAdd?: boolean;
  readyToFinalize?: boolean;
  focusSubjectIds?: string[];
  finalBasis?: string[];
};

class ScriptedClient implements ModelClient {
  readonly log: ModelRequest[] = [];
  constructor(private readonly turns: Record<number, ScriptedTurn>) {}
  async generate(input: ModelRequest): Promise<ModelResponse> {
    this.log.push(input);
    const turn = input.meta?.turnIndex ?? this.log.length;
    const spec = this.turns[turn] ?? {
      message: "noop",
      mutations: [],
      readyToFinalize: false,
    };
    const payload: Record<string, unknown> = {
      message: spec.message,
      mutations: spec.mutations ?? [],
      readyToFinalize: spec.readyToFinalize === true,
    };
    if (spec.nothingToAdd) payload.nothingToAdd = true;
    if (spec.focusSubjectIds?.length) payload.focusSubjectIds = spec.focusSubjectIds;
    if (spec.finalBasis?.length) payload.finalBasis = spec.finalBasis;
    return {
      content: JSON.stringify(payload),
      provider: "mock",
      usage: { totalTokens: 8, source: "estimated" },
    };
  }
}

function graphOf(conversation: Awaited<ReturnType<typeof runProblem>>) {
  return hydrateReasoningGraph({
    reasoningSchemaVersion: conversation.reasoningSchemaVersion,
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningVersions: conversation.reasoningVersions,
    reasoningEvents: conversation.reasoningEvents,
  });
}

function speakerOf(request: ModelRequest): AgentId {
  return request.meta?.agentId ?? "agent_a";
}

{
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.moralInitialization, "agent-created");
  assert.match(prompts.agentA, /readyToFinalize/);
  assert.match(prompts.agentA, /LOCAL TURN SCOPE/);
  assert.match(prompts.agentA, /FINAL SYNTHESIS is the first point/);
  assert.match(prompts.agentA, /Do not manufacture disagreement/);
  assert.match(prompts.agentA, /no minimum turn count/i);
  assert.doesNotMatch(prompts.agentA, /joint stance/i);
  assert.doesNotMatch(prompts.agentA, /You must challenge|must ask a question/i);
  console.log("✓ Case 0 — agent-created init + local-turn readyToFinalize protocol");
}

{
  const client = new ScriptedClient({
    1: {
      message: "FINAL_ANSWER: Gratitude is required whenever a gift is given.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message:
        "Gratitude is understandable, but it should not be treated as the moral price of kindness.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-1",
          after:
            "Gratitude is understandable, but it should not be treated as the moral price of kindness.",
        },
      ],
      readyToFinalize: false,
    },
    3: {
      message:
        "FINAL_ANSWER: Gratitude may be hoped for, but it is not the moral price of kindness.",
      mutations: [],
      readyToFinalize: true,
    },
    4: {
      message: "Still reviewing.",
      mutations: [],
      readyToFinalize: true,
    },
    5: {
      message:
        "FINAL_ANSWER: Gratitude may be hoped for, but it is not the moral price of kindness.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  assert.ok(conversation.messages.length >= 2, "B must receive a turn");
  assert.equal(conversation.messages[1]?.agentId, "agent_b");
  const firstFeedback = client.log[1]?.messages.some((item) =>
    item.content.includes("FINAL_ANSWER is not eligible yet"),
  );
  assert.equal(firstFeedback, true);
  assert.ok(
    conversation.messages.length >= 4,
    "premature FINAL_ANSWER on turn 3 must not terminate before mutual readiness",
  );
  console.log("✓ Case A — premature FINAL_ANSWER blocked until mutual convergence");
}

{
  const client = new ScriptedClient({
    1: {
      message: "Gratitude is appropriate after a gift.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message:
        "Gratitude is understandable, but it should not be treated as the moral price of kindness.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-1",
          after:
            "Gratitude is understandable, but it should not be treated as the moral price of kindness.",
        },
      ],
      readyToFinalize: false,
    },
    3: {
      message: "That revision looks right; the graph is stable.",
      mutations: [],
      readyToFinalize: true,
    },
    4: {
      message: "Agreed — nothing further to change.",
      mutations: [],
      readyToFinalize: true,
    },
    5: {
      message:
        "FINAL_ANSWER: Gratitude may be hoped for, but it is not owed as the price of kindness.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  const graph = graphOf(conversation);
  assert.match(currentValue(graph, "moral:gratitude") ?? "", /moral price of kindness/);
  assert.equal(activeVersion(graph, "moral:gratitude")?.agentId, "agent_b");
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.equal(conversation.messages.at(-1)?.agentId, "agent_b");
  assert.ok(
    (conversation.reasoningDiagnostics?.collaboration?.convergenceAttempts ?? 0) >= 2,
  );
  console.log("✓ Case B — mutual readyToFinalize then second confirmer synthesizes");
}

{
  const client = new ScriptedClient({
    1: {
      message: "Gratitude is appropriate after a gift.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message: "I agree with that framing.",
      mutations: [],
      readyToFinalize: true,
    },
    3: {
      message: "Still thinking.",
      mutations: [],
      readyToFinalize: false,
    },
    4: {
      message: "I still agree.",
      mutations: [],
      readyToFinalize: true,
      nothingToAdd: true,
    },
    5: {
      message: "Ready as well.",
      mutations: [],
      readyToFinalize: true,
    },
    6: {
      message: "FINAL_ANSWER: Gratitude is appropriate after a gift.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  const graph = graphOf(conversation);
  assert.equal(currentValue(graph, "moral:gratitude"), "Gratitude is appropriate.");
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.equal(conversation.messages[1]?.reasoningMutations?.length ?? 0, 0);
  console.log("✓ Case C — empty mutations + mutual readiness without forcing length");
}

{
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version, "graph-memory-v3");
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.reviseContract, "from-version-id");
  assert.equal(GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.moralInitialization, "agent-created");
  console.log("✓ Case D — protocol snapshot remains agent-created");
}

{
  const client = new ScriptedClient({
    1: {
      message: "Gratitude is appropriate.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message: "Updating from an old version.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-7",
          after: "Should not apply.",
        },
      ],
      readyToFinalize: false,
    },
    3: {
      message: "Waiting.",
      mutations: [],
      readyToFinalize: false,
    },
    4: {
      message: "Correct revision.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-1",
          after: "Gratitude is understandable but not required.",
        },
      ],
      readyToFinalize: false,
    },
    5: {
      message: "Looks stable.",
      mutations: [],
      readyToFinalize: true,
    },
    6: {
      message: "Agreed.",
      mutations: [],
      readyToFinalize: true,
    },
    7: {
      message: "FINAL_ANSWER: Gratitude is understandable but not required.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  const graph = graphOf(conversation);
  const rejected = (conversation.reasoningEvents ?? []).find(
    (event) => !event.accepted && event.turnIndex === 2,
  );
  assert.ok(rejected);
  assert.match(rejected?.errors[0] ?? "", /stale fromVersionId/);
  assert.equal(currentValue(graph, "moral:gratitude"), "Gratitude is understandable but not required.");
  console.log("✓ Case E — stale fromVersionId is rejected");
}

{
  const client = new ScriptedClient({
    1: {
      message: "Gratitude is appropriate after a gift.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message:
        "Gratitude is understandable, but it should not be treated as the moral price of kindness because withdrawing help can be boundary-setting rather than punishment.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          before: 'v1 — Agent A, turn 1\n"Gratitude is appropriate."',
          after: "v2 — Agent B, turn 2\n\"Not the moral price of kindness.\"",
        },
      ],
      readyToFinalize: false,
    },
    3: {
      message:
        "FINAL_ANSWER: Gratitude is appropriate after a gift and we can stop here.",
      mutations: [],
      readyToFinalize: true,
    },
    4: {
      message:
        "Persisting the qualification now that the chrome REVISE failed.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-1",
          after:
            "Gratitude is understandable, but it should not be treated as the moral price of kindness.",
        },
      ],
      readyToFinalize: false,
    },
    5: {
      message: "That captures it.",
      mutations: [],
      readyToFinalize: true,
    },
    6: {
      message: "Same state; ready.",
      mutations: [],
      readyToFinalize: true,
    },
    7: {
      message:
        "FINAL_ANSWER: Gratitude may be hoped for, but it is not the moral price of kindness.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  assert.ok(conversation.messages.length > 3, "A cannot finalize immediately after rejected B write");
  const turn4Request = client.log.find((item) => item.meta?.turnIndex === 4);
  assert.ok(
    turn4Request?.messages.some((item) =>
      item.content.includes("PERSISTENCE REQUIRED"),
    ),
    "persistence-repair feedback is delivered before a later FINAL_ANSWER",
  );
  assert.equal(
    turn4Request?.messages.some((item) => item.content === PERSISTENCE_REQUIRED_FEEDBACK),
    true,
  );
  const graph = graphOf(conversation);
  assert.match(currentValue(graph, "moral:gratitude") ?? "", /moral price of kindness/);
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.equal(
    conversation.reasoningDiagnostics?.collaboration?.finalizedBeforeBPersisted,
    false,
  );
  console.log("✓ Case F — rejected B write blocks immediate FINAL_ANSWER once");
}

{
  const client = new ScriptedClient({
    1: {
      message: "Create gratitude.",
      mutations: [
        {
          type: "SET",
          subjectId: "moral:gratitude",
          content: "Gratitude is appropriate.",
        },
      ],
      readyToFinalize: false,
    },
    2: {
      message: "Looks good.",
      mutations: [],
      readyToFinalize: true,
    },
    3: {
      message: "Ready.",
      mutations: [],
      readyToFinalize: true,
    },
    4: {
      message: "Actually revising after readiness.",
      mutations: [
        {
          type: "REVISE",
          subjectId: "moral:gratitude",
          fromVersionId: "pv-1",
          after: "Gratitude is optional under pressure.",
        },
      ],
      readyToFinalize: true,
    },
    5: {
      message: "Re-evaluating after the change.",
      mutations: [],
      readyToFinalize: true,
    },
    6: {
      message: "Stable again.",
      mutations: [],
      readyToFinalize: true,
    },
    7: {
      message: "FINAL_ANSWER: Gratitude is optional under pressure.",
      mutations: [],
      readyToFinalize: true,
    },
  });
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client,
    agentPrompts: prompts,
  });
  assert.ok(
    (conversation.reasoningDiagnostics?.collaboration?.convergenceResets ?? 0) >= 1,
    "material revise after readiness must reset convergence",
  );
  assert.equal(conversation.stoppedReason, "final_answer");
  assert.match(
    currentValue(graphOf(conversation), "moral:gratitude") ?? "",
    /optional under pressure/,
  );
  console.log("✓ Case G — material change after readiness resets convergence");
}

{
  assert.ok(NOT_CONVERGED_FEEDBACK.includes("has not yet converged"));
  const empty = graphOf(
    await runProblem({
      problem: moralProblem(),
      policy,
      config: { ...config, maxTurns: 1 },
      client: new ScriptedClient({
        1: {
          message: "Starting empty.",
          mutations: [
            {
              type: "SET",
              subjectId: "moral:gratitude",
              content: "x",
            },
          ],
          readyToFinalize: false,
        },
      }),
      agentPrompts: prompts,
    }),
  );
  assert.equal(empty.subjects.every((s) => (s.createdAtTurn ?? 0) >= 1), true);
  assert.equal(empty.subjects.every((s) => s.createdBy != null), true);
  console.log("✓ Case H — every moral subject has agent provenance from turn ≥ 1");
}

{
  const conversation = await runProblem({
    problem: moralProblem(),
    policy,
    config,
    client: new ScriptedClient({
      1: {
        message: "Start with gratitude as the first live issue.",
        mutations: [
          {
            type: "SET",
            subjectId: "moral:gratitude",
            content: "Gratitude is worth examining.",
            subjectLabel: "Gratitude",
          },
        ],
        readyToFinalize: false,
        focusSubjectIds: ["moral:gratitude"],
      },
      2: {
        message: "Pressure can make gratitude optional.",
        mutations: [
          {
            type: "REVISE",
            subjectId: "moral:gratitude",
            fromVersionId: "pv-1",
            after: "Gratitude is optional under severe pressure.",
          },
        ],
        readyToFinalize: false,
      },
      3: {
        message: "That revision looks stable.",
        mutations: [],
        readyToFinalize: true,
      },
      4: {
        message: "Agreed — ready.",
        mutations: [],
        readyToFinalize: true,
      },
      5: {
        message: "FINAL_ANSWER: Gratitude is optional under severe pressure.",
        mutations: [],
        readyToFinalize: true,
        finalBasis: ["pv-2"],
      },
    }),
    agentPrompts: prompts,
  });
  const scopes =
    conversation.reasoningDiagnostics?.collaboration?.turnScopes ??
    computeTurnScopes(
      hydrateReasoningGraph(conversation),
      conversation.messages.map((message) => ({
        turnIndex: message.turnIndex,
        agentId: message.agentId,
        content: message.content,
        readyToFinalize: message.readyToFinalize,
        materialGraphChange: message.materialGraphChange,
        focusSubjectIds: message.focusSubjectIds,
      })),
    );
  const turn1 = scopes.find((scope) => scope.turnIndex === 1);
  const turn2 = scopes.find((scope) => scope.turnIndex === 2);
  const turn3 = scopes.find((scope) => scope.turnIndex === 3);
  assert.equal(turn1?.considerationsCreated, 1);
  assert.equal(turn1?.considerationsTouched, 1);
  assert.equal(turn1?.focusSubjectIds?.[0], "moral:gratitude");
  assert.equal(turn1?.partnerPriorGraphChange, false);
  assert.equal(turn2?.considerationsRevised, 1);
  assert.equal(turn2?.partnerPriorGraphChange, true);
  assert.equal(turn3?.graphChanged, false);
  assert.equal(turn3?.partnerPriorGraphChange, true);
  assert.equal(turn3?.readyToFinalize, true);
  assert.equal(conversation.messages[0]?.focusSubjectIds?.[0], "moral:gratitude");
  console.log("✓ Case I — turn-scope diagnostics + optional focusSubjectIds");
}

console.log("ok — moral protocol gates A–I");
