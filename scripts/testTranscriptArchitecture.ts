/**
 * Graph-memory transcript architecture: persist the full conversation,
 * but feed the model only the previous partner utterance plus the graph.
 *
 * Run: npm run test:transcript
 */
import assert from "node:assert/strict";
import { agentDefinitionFromPrompt, buildAgentPromptPair } from "../src/agents/buildAgentPrompt";
import { createCommunicationPolicy } from "../src/communication/policy";
import type { CommunicationPolicy } from "../src/communication/types";
import { toMarblePosthocRequest } from "../src/evaluation/marble/adapter";
import { buildBeliefGraderPrompt } from "../src/evaluation/belief/prompt";
import { deriveConversationEfficiency } from "../src/experiment/conversationEfficiency";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { serializeConversation, serializeRun } from "../src/experiment/serializeConversation";
import { GRAPH_MEMORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol";
import type { ExperimentRun } from "../src/experiment/types";
import type { Problem } from "../src/problems/types";
import { runExperiment } from "../src/runtime/runExperiment";
import { runInteractionLoop } from "../src/runtime/interactionLoop";
import {
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../src/runtime/modelClient";
import { MOCK_MODEL_ID } from "../src/runtime/models";
import { runProblem } from "../src/runtime/runProblem";
import {
  assistantHistoryContents,
  buildAgentTurnRequest,
  buildTurnRequestForAgent,
  previousPartnerUtterance,
} from "../src/runtime/renderModelRequest";
import { type AgentUtterance } from "../src/runtime/transcript";
import type { AgentId } from "../src/agents/types";

function policy(partial: Partial<CommunicationPolicy> = {}): CommunicationPolicy {
  return createCommunicationPolicy({
    trustA: 0.5,
    trustB: 0.5,
    authority: 0.5,
    familiarity: 0.5,
    ...partial,
  });
}

function mockConfig(overrides: Partial<typeof DEFAULT_RUN_CONFIG> = {}) {
  return normalizeRunConfig(
    {
      problemCategory: "hidden_profile",
      problemCount: 1,
      runModel: MOCK_MODEL_ID,
      maxTurns: 8,
      temperature: 0,
      ...overrides,
    },
    { ...DEFAULT_RUN_CONFIG, runModel: MOCK_MODEL_ID, provider: "mock" },
  );
}

function problem(id: string, secret: string): Problem {
  return {
    id,
    category: "hidden_profile",
    title: `Title ${id}`,
    text: `Solve the marked problem. TOKEN=${secret}`,
    kind: "generic",
  };
}

function utterance(
  sender: AgentId,
  turn: number,
  content: string,
): AgentUtterance {
  return {
    id: `u${turn}`,
    sender,
    recipient: sender === "agent_a" ? "agent_b" : "agent_a",
    turn,
    content,
  };
}

const prompts = buildAgentPromptPair(policy());

const ordered: AgentUtterance[] = [
  utterance("agent_a", 1, "A1 proposal"),
  utterance("agent_b", 2, "B1 reply"),
  utterance("agent_a", 3, "A2 revision"),
  utterance("agent_b", 4, "B2 lock-in"),
];

// --- 1–2. Previous partner utterance only; no full transcript in model history ---
for (let turn = 1; turn <= 5; turn++) {
  const speaker = turn % 2 === 1 ? "agent_a" : "agent_b";
  const request = buildTurnRequestForAgent({
    agentId: speaker,
    agentPrompts: prompts,
    problemText: "P",
    utterances: ordered,
    turn,
    maxTurns: 8,
  });
  assert.equal(
    assistantHistoryContents(request.messages).length,
    0,
    `turn ${turn} must not include assistant transcript history`,
  );
  const partner = previousPartnerUtterance(ordered, speaker, turn);
  const partnerMsg = request.messages.find((m) =>
    m.content.startsWith("MOST RECENT PARTNER MESSAGE"),
  );
  if (partner) {
    assert.ok(partnerMsg, `turn ${turn} should include the previous partner utterance`);
    assert.match(partnerMsg.content, new RegExp(partner.content));
  } else {
    assert.equal(partnerMsg, undefined);
  }
  assert.equal(request.telemetry.historicalTranscriptCharsIncluded, 0);
  assert.equal(request.telemetry.transcriptMessagesBeforeTurn, Math.min(turn - 1, ordered.length));
  assert.equal(request.telemetry.turnNumber, turn);
}

// --- 3. Both agents receive equivalent historical information ---
const turn4A = buildAgentTurnRequest({
  speaker: "agent_a",
  systemPrompt: prompts.agentA,
  problemText: "P",
  utterances: ordered,
  turn: 4,
  maxTurns: 8,
});
const turn4B = buildAgentTurnRequest({
  speaker: "agent_b",
  systemPrompt: prompts.agentB,
  problemText: "P",
  utterances: ordered,
  turn: 4,
  maxTurns: 8,
});
assert.deepEqual(
  assistantHistoryContents(turn4A.messages),
  assistantHistoryContents(turn4B.messages),
  "history must not depend on which agent is speaking",
);
assert.equal(assistantHistoryContents(turn4A.messages).length, 0);
assert.notEqual(turn4A.messages[0]?.content, turn4B.messages[0]?.content);
assert.match(turn4A.messages.at(-1)?.content ?? "", /Respond as Agent A/);
assert.match(turn4B.messages.at(-1)?.content ?? "", /Respond as Agent B/);

// --- 4. Policy sliders do not change transcript visibility ---
const lowFam = buildAgentPromptPair(policy({ familiarity: 0.1, trustA: 0.1, authority: 0.1 }));
const highFam = buildAgentPromptPair(policy({ familiarity: 0.9, trustA: 0.9, authority: 0.9 }));
assert.notEqual(lowFam.agentA, highFam.agentA, "policy must change system prompts");
const histLow = assistantHistoryContents(
  buildTurnRequestForAgent({
    agentId: "agent_b",
    agentPrompts: lowFam,
    problemText: "P",
    utterances: ordered,
    turn: 5,
    maxTurns: 8,
  }).messages,
);
const histHigh = assistantHistoryContents(
  buildTurnRequestForAgent({
    agentId: "agent_b",
    agentPrompts: highFam,
    problemText: "P",
    utterances: ordered,
    turn: 5,
    maxTurns: 8,
  }).messages,
);
assert.deepEqual(histLow, histHigh);
assert.equal(histLow.length, 0);

const partnerLow = buildTurnRequestForAgent({
  agentId: "agent_a",
  agentPrompts: lowFam,
  problemText: "P",
  utterances: ordered,
  turn: 5,
  maxTurns: 8,
}).messages.find((m) => m.content.startsWith("MOST RECENT PARTNER MESSAGE"));
const partnerHigh = buildTurnRequestForAgent({
  agentId: "agent_a",
  agentPrompts: highFam,
  problemText: "P",
  utterances: ordered,
  turn: 5,
  maxTurns: 8,
}).messages.find((m) => m.content.startsWith("MOST RECENT PARTNER MESSAGE"));
assert.deepEqual(partnerLow, partnerHigh);
assert.match(partnerLow?.content ?? "", /B2 lock-in/);

type RecordedCall = {
  serial: number;
  problemId: string;
  problemText: string;
  turn: number;
  agentId: AgentId;
  messages: ModelRequest["messages"];
  content: string;
};

class RecordingClient implements ModelClient {
  serial = 0;
  log: RecordedCall[] = [];
  constructor(
    private readonly opts: {
      tag: string;
      finalAnswerAtTurn?: number;
    },
  ) {}

  async generate(input: ModelRequest): Promise<ModelResponse> {
    const serial = ++this.serial;
    const meta = input.meta;
    if (!meta) throw new Error("missing meta");
    const closing =
      typeof this.opts.finalAnswerAtTurn === "number"
        ? meta.turnIndex >= this.opts.finalAnswerAtTurn
        : meta.turnIndex >= 4;
    const content = [
      `SERIAL:${serial}:TAG:${this.opts.tag}:PROBLEM:${meta.problem.id}:TURN:${meta.turnIndex}`,
      closing ? `FINAL_ANSWER: ${this.opts.tag}-${meta.problem.id}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    this.log.push({
      serial,
      problemId: meta.problem.id,
      problemText: meta.problem.text,
      turn: meta.turnIndex,
      agentId: meta.agentId,
      messages: input.messages,
      content,
    });
    await new Promise((r) => setTimeout(r, 8));
    return {
      content,
      provider: "mock",
      usage: {
        inputTokens: 20 + serial,
        outputTokens: 10,
        totalTokens: 30 + serial,
        source: "estimated",
      },
    };
  }
}

function partnerMessage(messages: ModelRequest["messages"]): string | undefined {
  return messages.find((m) => m.content.startsWith("MOST RECENT PARTNER MESSAGE"))
    ?.content;
}

function historySerials(messages: ModelRequest["messages"]): number[] {
  const partner = partnerMessage(messages);
  if (!partner) return [];
  const match = partner.match(/SERIAL:(\d+)/);
  return match ? [Number(match[1])] : [];
}

function assertLineageIsolated(log: RecordedCall[]): void {
  const bySerial = new Map(log.map((row) => [row.serial, row]));
  const byProblemTurn = new Map(
    log.map((row) => [`${row.problemId}:${row.turn}`, row]),
  );
  for (const call of log) {
    const history = assistantHistoryContents(call.messages);
    assert.equal(history.length, 0, "model request must not include assistant transcript history");
    const problemMsg = call.messages.find(
      (m) => m.role === "user" && m.content.startsWith("Shared problem:"),
    );
    assert.ok(problemMsg, "request must include shared problem");
    // Agent-facing views may be asymmetric packets (shared context + unit
    // subsets) rather than the legacy monolithic problem.text.
    assert.ok(
      problemMsg.content.includes(call.problemText) ||
        problemMsg.content.includes("SHARED INFORMATION") ||
        problemMsg.content.includes("PRIVATE INFORMATION") ||
        problemMsg.content.includes("YOUR INFORMATION PACKET") ||
        problemMsg.content.includes("Statement to prove"),
      "request problem text must match this problem or its information packet",
    );

    const serials = historySerials(call.messages);
    if (call.turn === 1) {
      assert.equal(serials.length, 0, "turn 1 has no previous partner utterance");
      continue;
    }
    assert.equal(serials.length, 1, `turn ${call.turn} should see only the previous partner utterance`);
    const prior = bySerial.get(serials[0]!);
    assert.ok(prior, `serial ${serials[0]} must exist`);
    assert.equal(prior.problemId, call.problemId);
    assert.equal(prior.turn, call.turn - 1);
    const expectedPrior = byProblemTurn.get(`${call.problemId}:${call.turn - 1}`);
    assert.equal(prior, expectedPrior);
  }
}

function assertNoCrossSecret(log: RecordedCall[], secrets: Record<string, string>): void {
  for (const call of log) {
    const blob = call.messages.map((m) => m.content).join("\n");
    for (const [problemId, secret] of Object.entries(secrets)) {
      if (problemId === call.problemId) {
        assert.ok(blob.includes(secret), `${call.problemId} must see its own secret`);
      } else {
        assert.ok(
          !blob.includes(secret),
          `${call.problemId} must not see secret of ${problemId}`,
        );
      }
    }
  }
}

// --- 5–8. Problem / run / parallel isolation ---
const isoA = problem("iso-a", "SECRET_A_ONLY");
const isoB = problem("iso-b", "SECRET_B_ONLY");
const isoConfig = mockConfig({ maxTurns: 6 });
const parallelClient = new RecordingClient({ tag: "parallel-problems" });

const [convA, convB] = await Promise.all([
  runProblem({
    problem: isoA,
    policy: policy(),
    config: isoConfig,
    client: parallelClient,
    agentPrompts: prompts,
  }),
  runProblem({
    problem: isoB,
    policy: policy(),
    config: isoConfig,
    client: parallelClient,
    agentPrompts: prompts,
  }),
]);

assert.notEqual(convA.problemId, convB.problemId);
assertLineageIsolated(parallelClient.log);
assertNoCrossSecret(parallelClient.log, {
  "iso-a": "SECRET_A_ONLY",
  "iso-b": "SECRET_B_ONLY",
});

const runClient = new RecordingClient({ tag: "parallel-runs" });
const [run1, run2] = await Promise.all([
  runExperiment({
    policy: policy({ familiarity: 0.2 }),
    config: mockConfig({ problemCount: 2, maxTurns: 6 }),
    client: runClient,
    runId: "run-iso-1",
  }),
  runExperiment({
    policy: policy({ familiarity: 0.8 }),
    config: mockConfig({ problemCount: 2, maxTurns: 6 }),
    client: runClient,
    runId: "run-iso-2",
  }),
]);

assert.equal(run1.id, "run-iso-1");
assert.equal(run2.id, "run-iso-2");
assert.deepEqual(run1.transcriptProtocol, GRAPH_MEMORY_TRANSCRIPT_PROTOCOL);
assert.deepEqual(run2.transcriptProtocol, GRAPH_MEMORY_TRANSCRIPT_PROTOCOL);
assert.notEqual(run1.agentPrompts.agentA, run2.agentPrompts.agentA);
assert.equal(run1.conversations.length, 2);
assert.equal(run2.conversations.length, 2);

assertLineageIsolated(runClient.log);

// --- 9–11. FINAL_ANSWER terminates live interaction but is persisted & evaluated ---
const finalClient = new RecordingClient({ tag: "final", finalAnswerAtTurn: 2 });
const finalProblem = problem("final-p", "SECRET_FINAL");
const finalConv = await runProblem({
  problem: finalProblem,
  policy: policy(),
  config: mockConfig({ maxTurns: 8 }),
  client: finalClient,
  agentPrompts: prompts,
});

assert.equal(finalConv.stoppedReason, "final_answer");
assert.equal(finalConv.messages.length, 2);
assert.ok(finalConv.finalAnswer);
assert.match(finalConv.messages[1]!.content, /FINAL_ANSWER:/);
assert.equal(finalClient.log.length, 2, "loop must not request a third turn");

const finalRun: ExperimentRun = {
  id: "run-final",
  createdAt: new Date().toISOString(),
  policy: policy(),
  agentPrompts: prompts,
  transcriptProtocol: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL,
  config: isoConfig,
  conversations: [finalConv],
  status: "completed",
};

const marble = toMarblePosthocRequest({
  run: finalRun,
  conversation: finalConv,
  evaluatorModel: MOCK_MODEL_ID,
});
assert.equal(marble.messages.length, 2);
assert.match(marble.messages[1]!.content, /FINAL_ANSWER:/);
assert.ok(marble.finalAnswer);
assert.match(marble.results, /FINAL_ANSWER:/);
assert.match(marble.results, /Terminal utterance/);

const belief = buildBeliefGraderPrompt({
  conversation: finalConv,
  run: finalRun,
});
assert.match(belief.user, /FINAL_ANSWER:/);
assert.match(belief.user, /SERIAL:/);
assert.match(belief.user, /TURN 2/);

const exported = serializeConversation(finalConv, finalRun);
assert.equal(exported.schema_version, "1.5");
assert.equal(exported.result.status, "final_answer");
assert.ok(exported.result.final_answer);
assert.equal(exported.messages.length, 2);
assert.match(exported.messages[1]!.content, /FINAL_ANSWER:/);
assert.deepEqual(exported.transcript_protocol, GRAPH_MEMORY_TRANSCRIPT_PROTOCOL);

// --- 12. Token/usage telemetry is associated with the correct run/problem/turn ---
for (const conversation of [convA, convB, finalConv]) {
  conversation.messages.forEach((message, index) => {
    assert.ok(message.requestTelemetry, "every turn records request telemetry");
    assert.equal(message.requestTelemetry.turnNumber, message.turnIndex);
    assert.equal(message.requestTelemetry.speaker, message.agentId);
    assert.equal(message.requestTelemetry.transcriptMessagesBeforeTurn, index);
    assert.ok(message.usage, "recording client always returns usage");
    assert.equal(message.usage.source, "estimated");
    assert.ok((message.usage.inputTokens ?? 0) > 0);
    assert.ok((message.usage.outputTokens ?? 0) > 0);
    assert.equal(message.requestTelemetry.historicalTranscriptCharsIncluded, 0);
    if (index > 0) {
      assert.ok(
        (message.requestTelemetry.previousUtteranceChars ?? 0) > 0,
        "turns after the first include the previous partner utterance",
      );
    } else {
      assert.equal(message.requestTelemetry.previousUtteranceChars ?? 0, 0);
    }
  });
  assert.ok(conversation.conversationEfficiency);
  assert.equal(
    conversation.conversationEfficiency.turnCount,
    conversation.messages.length,
  );
  assert.equal(conversation.conversationEfficiency.usageSource, "estimated");
}

assert.equal(
  finalConv.messages[0]!.requestTelemetry?.problemCharacters,
  buildTurnRequestForAgent({
    agentId: "agent_a",
    agentPrompts: prompts,
    problemText:
      finalConv.problemTextByAgent?.agent_a ?? finalConv.problemText,
    utterances: [],
    turn: 1,
    maxTurns: 8,
  }).telemetry.problemCharacters,
);

const efficiency = deriveConversationEfficiency(finalConv);
assert.equal(efficiency.turnCount, 2);
assert.ok((efficiency.totalInputTokens ?? 0) > 0);
assert.ok((efficiency.averageOutputTokensPerUtterance ?? 0) > 0);

const runExport = serializeRun(finalRun);
assert.equal(runExport.schema_version, "1.5");
assert.deepEqual(runExport.transcript_protocol, GRAPH_MEMORY_TRANSCRIPT_PROTOCOL);
assert.equal(runExport.conversations[0]?.efficiency.turn_count, 2);

// Direct loop: FINAL_ANSWER on turn 1 still persisted.
const instant = await runInteractionLoop({
  problem: problem("instant", "SECRET_INSTANT"),
  agentA: agentDefinitionFromPrompt("agent_a", prompts.agentA),
  agentB: agentDefinitionFromPrompt("agent_b", prompts.agentB),
  policy: policy(),
  model: MOCK_MODEL_ID,
  temperature: 0,
  maxTurns: 6,
  client: new RecordingClient({ tag: "instant", finalAnswerAtTurn: 1 }),
});
assert.equal(instant.stoppedReason, "final_answer");
assert.equal(instant.messages.length, 1);
assert.match(instant.messages[0]!.content, /FINAL_ANSWER:/);

// Determinism: same inputs → same request.
const once = buildTurnRequestForAgent({
  agentId: "agent_b",
  agentPrompts: prompts,
  problemText: "P",
  utterances: ordered,
  turn: 3,
  maxTurns: 8,
});
const twice = buildTurnRequestForAgent({
  agentId: "agent_b",
  agentPrompts: prompts,
  problemText: "P",
  utterances: ordered,
  turn: 3,
  maxTurns: 8,
});
assert.deepEqual(once, twice);

console.log(
  "ok — transcript architecture: previous-utterance-only model context, persisted full transcript, isolation, FINAL_ANSWER persist+eval, telemetry",
);
