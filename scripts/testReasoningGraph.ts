/**
 * Structured reasoning graph protocol.
 *
 * Run: npm run test:reasoning
 */
import assert from "node:assert/strict";
import { buildAgentPromptPair, splitAgentPromptLayers } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import { serializeConversation } from "../src/experiment/serializeConversation";
import { FULL_HISTORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";
import type { ExperimentRun } from "../src/experiment/types";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import type { Problem } from "../src/problems/types";
import {
  applyReasoningIntents,
  emptyReasoningGraph,
  hasStructuredReasoning,
  hydrateReasoningGraph,
  layoutReasoningGraph,
  materializeGraph,
  parseAgentTurn,
  snapshotBeforeTurn,
  stancesForNode,
  type ReasoningGraph,
  type ReasoningIntent,
} from "../src/reasoning";
import { formatReasoningState } from "../src/reasoning/renderState";
import { parseReasoningEvent } from "../src/reasoning/parseStored";
import { runProblem } from "../src/runtime/runProblem";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/runtime/modelClient";
import { buildTurnRequestForAgent } from "../src/runtime/renderModelRequest";

function apply(
  g: ReasoningGraph,
  intents: ReasoningIntent[],
  actor: "agent_a" | "agent_b" = "agent_a",
  turn = 1,
  extras: {
    protocolFailure?: string;
    finalAnswer?: { text?: string; supportingNodeIds: string[] };
  } = {},
) {
  return applyReasoningIntents(g, intents, {
    actor,
    turnIndex: turn,
    messageId: `msg-${turn}-${actor}`,
    protocolFailure: extras.protocolFailure,
    finalAnswer: extras.finalAnswer,
  });
}

function createProposal(
  text: string,
  extras: Partial<Extract<ReasoningIntent, { action: "create" }>> = {},
): ReasoningIntent {
  return {
    action: "create",
    nodeType: "proposal",
    text,
    ...extras,
  };
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  assert.equal(created.events.at(-1)?.accepted, true);
  assert.equal(created.graph.nodes[0]?.id, "P1");
  assert.equal(created.graph.nodes[0]?.createdBy, "agent_a");
  assert.equal(created.graph.nodes[0]?.status, "open");
  assert.equal(created.graph.nodes[0]?.createdAtTurn, 1);
  assert.equal(created.graph.nodes[0]?.sourceMessageId, "msg-1-agent_a");

  const revised = apply(
    created.graph,
    [
      {
        action: "revise",
        targetId: "P1",
        text: "4 Across is EON",
      },
    ],
    "agent_a",
    2,
  );
  const p1 = revised.graph.nodes.find((n) => n.id === "P1");
  const p2 = revised.graph.nodes.find((n) => n.id === "P2");
  assert.equal(p1?.text, "4 Across is ERA");
  assert.equal(p1?.status, "superseded");
  assert.equal(p2?.text, "4 Across is EON");
  assert.equal(p2?.supersedes, "P1");
  assert.ok(p2?.parents.includes("P1"));
}

{
  const turn1 = apply(
    emptyReasoningGraph(),
    [createProposal("root proposal")],
    "agent_a",
    1,
  );
  const turn2 = apply(
    turn1.graph,
    [
      createProposal("supporting branch", { parents: ["P1"] }),
      createProposal("parallel branch"),
    ],
    "agent_b",
    2,
  );
  const turn5 = apply(
    turn2.graph,
    [{ action: "revise", targetId: "P2", text: "revised branch" }],
    "agent_a",
    5,
  );
  const layout = layoutReasoningGraph(turn5.graph);
  const at = (id: string) => layout.nodes.find((node) => node.id === id)!;

  assert.ok(at("P1").y < at("P2").y);
  assert.equal(at("P2").y, at("P3").y);
  assert.ok(at("P3").y < at("P4").y);
  assert.equal(at("P1").turnIndex, 1);
  assert.deepEqual(
    layout.turnBands.map((band) => band.turnIndex),
    [1, 2, 3, 4, 5],
  );

  const extended = apply(
    turn5.graph,
    [createProposal("later independent branch")],
    "agent_b",
    6,
  );
  const extendedLayout = layoutReasoningGraph(extended.graph);
  for (const id of ["P1", "P2", "P3", "P4"]) {
    const before = at(id);
    const after = extendedLayout.nodes.find((node) => node.id === id)!;
    assert.deepEqual(
      { x: after.x, y: after.y },
      { x: before.x, y: before.y },
    );
  }
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const passed = apply(
    created.graph,
    [{ action: "pass", targetId: "P1", reason: "not evaluating yet" }],
    "agent_b",
    2,
  );
  assert.equal(passed.graph.nodes.find((n) => n.id === "P1")?.status, "open");
  assert.equal(stancesForNode(passed.graph, "P1")[0]?.kind, "pass");
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const one = apply(
    created.graph,
    [{ action: "accept", targetId: "P1", reason: "looks good" }],
    "agent_b",
    2,
  );
  assert.equal(one.graph.nodes.find((n) => n.id === "P1")?.status, "open");
  const both = apply(
    one.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_a",
    3,
  );
  assert.equal(both.graph.nodes.find((n) => n.id === "P1")?.status, "accepted");
}

{
  const self = apply(emptyReasoningGraph(), [
    createProposal("depends on itself", {
      localId: "p",
      dependencies: ["p"],
    }),
  ]);
  assert.equal(self.graph.nodes.length, 0);
  assert.equal(self.events.at(-1)?.accepted, false);
  assert.match(self.events.at(-1)?.errors.join(" ") ?? "", /unknown target p|itself|cycle/);

  const created = apply(emptyReasoningGraph(), [createProposal("root")]);
  const unknown = apply(
    created.graph,
    [{ action: "challenge", targetId: "P99", reason: "no such node" }],
    "agent_b",
    2,
  );
  assert.equal(unknown.events.at(-1)?.accepted, false);
  assert.match(unknown.events.at(-1)?.errors.join(" ") ?? "", /unknown target P99/);
  assert.equal(unknown.events.at(-1)?.intent.action, "challenge");
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("4 Across is ERA")]);
  const dup = apply(
    created.graph,
    [createProposal("4 Across is ERA")],
    "agent_b",
    2,
  );
  assert.equal(dup.events.at(-1)?.accepted, false);
  assert.match(dup.events.at(-1)?.errors.join(" ") ?? "", /duplicate of P1/);
  assert.equal(dup.graph.nodes.filter((n) => n.type === "proposal").length, 1);
}

{
  const chained = apply(emptyReasoningGraph(), [
    createProposal("root claim", { localId: "root" }),
    createProposal("depends on root", {
      localId: "mid",
      dependencies: ["root"],
    }),
    createProposal("depends on mid", { dependencies: ["mid"] }),
  ]);
  assert.equal(
    chained.events.filter((e) => e.operation.type === "create").every((e) => e.accepted),
    true,
  );
  assert.deepEqual(
    chained.graph.nodes.find((n) => n.id === "P3")?.dependencies,
    ["P2"],
  );
  assert.equal(chained.graph.nodes.find((n) => n.id === "P3")?.status, "unresolved");
}

{
  const cycle = apply(emptyReasoningGraph(), [
    createProposal("one", { localId: "one" }),
    createProposal("two", { localId: "two", dependencies: ["one"] }),
  ]);
  const closer = apply(cycle.graph, [
    {
      action: "create",
      nodeType: "proposal",
      text: "self loop",
      localId: "loop",
      dependencies: ["loop"],
    },
  ]);
  assert.equal(closer.events.at(-1)?.accepted, false);
  assert.match(closer.events.at(-1)?.errors.join(" ") ?? "", /itself/);
}

{
  const malformed = apply(emptyReasoningGraph(), [
    { action: "invalid", raw: { nope: true } },
    { action: "create" },
    { action: "reject", targetId: "P1" },
    { action: "support" },
  ]);
  assert.equal(malformed.events.length, 4);
  assert.equal(malformed.events.every((event) => event.accepted === false), true);
  assert.equal(malformed.graph.nodes.length, 0);
  assert.match(malformed.events[0]?.errors.join(" ") ?? "", /malformed/);
  assert.match(malformed.events[1]?.errors.join(" ") ?? "", /node type|node text/);
  assert.match(malformed.events[2]?.errors.join(" ") ?? "", /unknown target|reason/);
  assert.match(malformed.events[3]?.errors.join(" ") ?? "", /missing targetId/);
}

{
  const parsedBad = parseAgentTurn("Just chatting.\nFINAL_ANSWER: 42", "agent_b", 2);
  assert.equal(parsedBad.parsedAsJson, false);
  assert.ok(parsedBad.protocolFailure);
  assert.equal(parsedBad.intents.length, 0);
  const failed = apply(emptyReasoningGraph(), parsedBad.intents, "agent_b", 2, {
    protocolFailure: parsedBad.protocolFailure,
    finalAnswer: parsedBad.finalAnswerSupport,
  });
  assert.equal(failed.events[0]?.operation.type, "protocol_failure");
  assert.equal(failed.events[0]?.accepted, false);
  assert.equal(failed.graph.nodes.length, 0);
}

{
  const parsed = parseAgentTurn(
    JSON.stringify({
      message: "I think 4-Across is EON.",
      reasoningIntents: [
        {
          action: "create",
          nodeType: "proposal",
          text: "4-Across is EON",
          createdBy: "agent_b",
          id: "HACK",
          status: "accepted",
          createdAtTurn: 99,
        },
      ],
      finalAnswer: { text: "EON", supportingNodeIds: ["P1"] },
    }),
    "agent_a",
    1,
  );
  assert.equal(parsed.parsedAsJson, true);
  assert.equal(parsed.intents[0]?.action, "create");
  const applied = apply(emptyReasoningGraph(), parsed.intents, "agent_a", 1, {
    finalAnswer: parsed.finalAnswerSupport,
  });
  const node = applied.graph.nodes[0];
  assert.equal(node?.id, "P1");
  assert.equal(node?.createdBy, "agent_a");
  assert.equal(node?.createdAtTurn, 1);
  assert.equal(node?.status, "open");
  assert.notEqual(node?.id, "HACK");
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("live claim")]);
  const text = formatReasoningState(created.graph);
  assert.match(text, /CURRENT REASONING STATE/);
  assert.match(text, /P1/);
  assert.match(text, /Agent A proposed/);
  assert.doesNotMatch(text, /trustA|authority|familiarity/i);
}

{
  const t1 = apply(emptyReasoningGraph(), [createProposal("claim")], "agent_a", 1);
  const t2 = apply(
    t1.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    2,
  );
  const before2 = snapshotBeforeTurn(t2.graph, 2);
  assert.equal(before2.nodes.length, 1);
  assert.ok(before2.events.every((e) => e.turnIndex < 2));
  const replayed = materializeGraph(t2.graph.events);
  assert.deepEqual(
    replayed.nodes.map((n) => ({ id: n.id, status: n.status, text: n.text })),
    t2.graph.nodes.map((n) => ({ id: n.id, status: n.status, text: n.text })),
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("first")]);
  const onSuperseded = apply(
    apply(created.graph, [{ action: "revise", targetId: "P1", text: "second" }], "agent_a", 2)
      .graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    3,
  );
  assert.equal(onSuperseded.events.at(-1)?.accepted, false);
  assert.match(
    onSuperseded.events.at(-1)?.errors.join(" ") ?? "",
    /superseded; reference the live revision P2/,
  );
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("bad idea")]);
  const rejected = apply(
    created.graph,
    [{ action: "reject", targetId: "P1", reason: "no" }],
    "agent_a",
    2,
  );
  assert.equal(rejected.graph.nodes[0]?.status, "rejected");
  const acceptRejected = apply(
    rejected.graph,
    [{ action: "accept", targetId: "P1" }],
    "agent_b",
    3,
  );
  assert.equal(acceptRejected.events.at(-1)?.accepted, false);
  assert.match(acceptRejected.events.at(-1)?.errors.join(" ") ?? "", /rejected; revise/);
  const reopen = apply(
    rejected.graph,
    [{ action: "revise", targetId: "P1", text: "better idea" }],
    "agent_a",
    3,
  );
  assert.equal(reopen.events.at(-1)?.accepted, true);
  assert.equal(reopen.graph.nodes.find((n) => n.id === "P2")?.text, "better idea");
}

{
  const seed = {
    id: "I1",
    type: "issue" as const,
    text: "A",
    createdBy: "agent_a" as const,
    createdAtTurn: 1,
    status: "open" as const,
    parents: ["I2"],
    dependencies: [],
  };
  const cyclicParents: ReasoningGraph = {
    nodes: [
      seed,
      { ...seed, id: "I2", text: "B", parents: ["I1"] },
    ],
    events: [],
  };
  const blocked = apply(cyclicParents, [createProposal("new")]);
  assert.equal(blocked.events.at(-1)?.accepted, false);
  assert.match(blocked.events.at(-1)?.errors.join(" ") ?? "", /parent cycle/);
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("answer")]);
  const unknownSupport = apply(created.graph, [], "agent_a", 2, {
    finalAnswer: { text: "42", supportingNodeIds: ["P88"] },
  });
  assert.equal(unknownSupport.finalAnswerSupport?.errors[0], "P88 does not exist");
  assert.equal(
    unknownSupport.events.at(-1)?.errors.join(" "),
    "Supporting-node linkage invalid: P88 does not exist",
  );
  assert.equal(unknownSupport.events.at(-1)?.accepted, false);

  const superseded = apply(
    created.graph,
    [{ action: "revise", targetId: "P1", text: "new answer" }],
    "agent_a",
    2,
  );
  const badLink = apply(superseded.graph, [], "agent_a", 3, {
    finalAnswer: { text: "x", supportingNodeIds: ["P1"] },
  });
  assert.match(badLink.finalAnswerSupport?.errors.join(" ") ?? "", /superseded/);

  const rejected = apply(
    created.graph,
    [{ action: "reject", targetId: "P1", reason: "nope" }],
    "agent_a",
    2,
  );
  const rejectedLink = apply(rejected.graph, [], "agent_a", 3, {
    finalAnswer: { text: "x", supportingNodeIds: ["P1"] },
  });
  assert.match(rejectedLink.finalAnswerSupport?.errors.join(" ") ?? "", /rejected/);
}

{
  const created = apply(emptyReasoningGraph(), [createProposal("keep")]);
  const json = created.graph.events.map((event) => JSON.parse(JSON.stringify(event)));
  const parsedEvents = json.map((raw) => parseReasoningEvent(raw));
  assert.equal(parsedEvents.every(Boolean), true);
  const reloaded = hydrateReasoningGraph({
    reasoningNodes: [{ ...created.graph.nodes[0]!, text: "stale cache", status: "accepted" }],
    reasoningEvents: parsedEvents.filter((e) => Boolean(e)),
  });
  assert.equal(reloaded.nodes[0]?.text, "keep");
  assert.equal(reloaded.nodes[0]?.status, "open");
  assert.equal(reloaded.events.length, created.graph.events.length);
}

{
  const low = splitAgentPromptLayers(
    buildAgentPromptPair(
      createCommunicationPolicy({
        trustA: 0.1,
        trustB: 0.1,
        authority: 0.1,
        familiarity: 0.1,
      }),
    ).agentA,
  );
  const high = splitAgentPromptLayers(
    buildAgentPromptPair(
      createCommunicationPolicy({
        trustA: 0.9,
        trustB: 0.9,
        authority: 0.9,
        familiarity: 0.9,
      }),
    ).agentA,
  );
  assert.equal(low.reasoning, high.reasoning);
  assert.match(low.reasoning, /reasoningIntents/);
  assert.doesNotMatch(low.reasoning, /One agent's accept does not globally settle/);
  assert.notEqual(low.trust, high.trust);
}

class JsonClient implements ModelClient {
  constructor(private readonly tag: string) {}
  async generate(input: ModelRequest): Promise<ModelResponse> {
    const problemId = input.meta?.problem.id ?? "unknown";
    const turn = input.meta?.turnIndex ?? 1;
    const payload = {
      message:
        turn >= 2
          ? `FINAL_ANSWER: ${this.tag}-${problemId}`
          : `Proposal for ${problemId}`,
      reasoningIntents:
        turn === 1
          ? [
              {
                action: "create",
                nodeType: "proposal",
                text: `${this.tag}:${problemId}`,
                createdBy: "agent_b",
                id: "SPOOF",
                status: "accepted",
              },
            ]
          : [
              {
                action: "accept",
                actor: "agent_a",
                targetId: "P1",
                reason: "locking the proposal",
              },
            ],
      finalAnswer:
        turn >= 2
          ? { text: `${this.tag}-${problemId}`, supportingNodeIds: ["P1"] }
          : undefined,
    };
    return { content: JSON.stringify(payload), provider: "mock" };
  }
}

const policy = createCommunicationPolicy({
  trustA: 0.5,
  trustB: 0.5,
  authority: 0.5,
  familiarity: 0.5,
});
const prompts = buildAgentPromptPair(policy);
const config = normalizeRunConfig(
  {
    problemCategory: "proof",
    problemCount: 1,
    runModel: MOCK_MODEL_ID,
    maxTurns: 4,
    temperature: 0,
  },
  { ...DEFAULT_RUN_CONFIG, runModel: MOCK_MODEL_ID, provider: "mock" },
);

function problem(id: string, secret: string): Problem {
  return {
    id,
    category: "proof",
    title: `Title ${id}`,
    text: `Solve. TOKEN=${secret}`,
    kind: "generic",
  };
}

const client = new JsonClient("iso");
const [left, right] = await Promise.all([
  runProblem({
    problem: problem("g-a", "SECRET_A"),
    policy,
    config,
    client,
    agentPrompts: prompts,
  }),
  runProblem({
    problem: problem("g-b", "SECRET_B"),
    policy,
    config,
    client,
    agentPrompts: prompts,
  }),
]);

assert.ok(hasStructuredReasoning(left));
assert.ok(hasStructuredReasoning(right));
assert.equal(left.reasoningNodes?.[0]?.text.includes("g-a"), true);
assert.equal(right.reasoningNodes?.[0]?.text.includes("g-b"), true);
assert.equal(left.reasoningNodes?.[0]?.text.includes("g-b"), false);
assert.equal(right.reasoningNodes?.[0]?.text.includes("g-a"), false);
assert.equal(left.reasoningNodes?.[0]?.id, "P1");
assert.equal(left.reasoningNodes?.[0]?.createdBy, "agent_a");
assert.deepEqual(left.finalAnswerSupport?.supportingNodeIds, ["P1"]);
assert.deepEqual(left.finalAnswerSupport?.errors, []);
assert.match(left.messages[0]?.content ?? "", /Proposal for g-a/);
assert.ok(left.messages[0]?.rawContent?.includes("reasoningIntents"));
assert.equal(left.stoppedReason, "final_answer");
assert.equal(
  left.reasoningEvents?.some((event) => event.operation.type === "accept" && event.actor === "agent_b"),
  true,
);

const request = buildTurnRequestForAgent({
  agentId: "agent_a",
  agentPrompts: prompts,
  problemText: "P",
  utterances: [],
  turn: 1,
  maxTurns: 8,
  reasoningGraph: emptyReasoningGraph(),
});
assert.ok(
  request.messages.some((m) => m.content.startsWith("CURRENT REASONING STATE")),
);
assert.match(request.messages.at(-1)?.content ?? "", /reasoningIntents/);

const run: ExperimentRun = {
  id: "run-r",
  createdAt: new Date().toISOString(),
  policy,
  agentPrompts: prompts,
  transcriptProtocol: FULL_HISTORY_TRANSCRIPT_PROTOCOL,
  config,
  conversations: [left],
  status: "completed",
};
const exported = serializeConversation(left, run);
assert.equal(exported.schema_version, "1.4");
assert.ok(exported.reasoning);
assert.equal(exported.reasoning.nodes.length, left.reasoningNodes?.length);
assert.ok(exported.messages[0]?.raw_content);
assert.deepEqual(exported.result.supporting_node_ids, ["P1"]);

assert.equal(hasStructuredReasoning({}), false);

console.log(
  "ok — reasoning graph: intent engine, no silent drops, replay, isolation, simplified prompt",
);
