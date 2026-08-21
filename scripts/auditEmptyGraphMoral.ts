/**
 * Empty-graph moral protocol: smoke-verify turn-1 modelRequest, then rerun the
 * same 10 problem IDs as run_mt3c9crw_k036xp for a paired before/after audit.
 *
 * Usage: npm run audit:empty-graph-moral
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt.ts";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy.ts";
import { normalizeRunConfig } from "../src/experiment/configAccessors.ts";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults.ts";
import { GRAPH_MEMORY_TRANSCRIPT_PROTOCOL } from "../src/experiment/transcriptProtocol.ts";
import { getProblemById } from "../src/problems/registry.ts";
import type { Problem } from "../src/problems/types.ts";
import {
  currentValue,
  formatReasoningState,
  hydrateReasoningGraph,
  versionsForSubject,
  type ReasoningGraph,
  type ReasoningSubject,
} from "../src/reasoning/index.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import type { ProblemConversation } from "../src/experiment/types.ts";
import { runProblem } from "../src/runtime/runProblem.ts";

/** Exact problem IDs from run_mt3c9crw_k036xp. */
const PAIRED_IDS = [
  "reddit_ethics_0073",
  "reddit_ethics_0047",
  "reddit_ethics_0069",
  "reddit_ethics_0057",
  "reddit_ethics_0029",
  "reddit_ethics_0034",
  "reddit_ethics_0059",
  "reddit_ethics_0067",
  "reddit_ethics_0007",
  "reddit_ethics_0076",
] as const;

const SMOKE_ID = PAIRED_IDS[0]!;
const BASELINE_RUN_ID = "run_mt3c9crw_k036xp";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireProblem(id: string): Problem {
  const problem = getProblemById("moral_philosophical", id);
  if (!problem) throw new Error(`missing problem ${id}`);
  return problem;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4),
  );
}

function overlapRatio(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function questionCount(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function disagreementCue(text: string): boolean {
  return /\b(disagree|but I|I push back|challenge|counter|instead,|on the contrary|I don't think)\b/i.test(
    text,
  );
}

function describeSubject(graph: ReasoningGraph, subject: ReasoningSubject) {
  const history = versionsForSubject(graph, subject.id);
  const current = history.find((version) => version.status === "active");
  return {
    id: subject.id,
    label: subject.label ?? subject.id,
    source: subject.source,
    createdBy: subject.createdBy,
    createdAtTurn: subject.createdAtTurn,
    current: current?.content ?? null,
    versionCount: history.length,
  };
}

function graphOf(conversation: ProblemConversation): ReasoningGraph {
  return hydrateReasoningGraph({
    reasoningSchemaVersion: conversation.reasoningSchemaVersion,
    reasoningSubjects: conversation.reasoningSubjects,
    reasoningVersions: conversation.reasoningVersions,
    reasoningEvents: conversation.reasoningEvents,
  });
}

function turn1Memory(conversation: ProblemConversation): string | undefined {
  const turn1 = conversation.messages.find((message) => message.turnIndex === 1);
  return turn1?.modelRequest?.find((item) =>
    item.content.startsWith("CURRENT SHARED REASONING STATE"),
  )?.content;
}

function requestHasReady(conversation: ProblemConversation): boolean {
  const turn1 = conversation.messages.find((message) => message.turnIndex === 1);
  const joined = (turn1?.modelRequest ?? [])
    .map((item) => item.content)
    .join("\n");
  return /readyToFinalize/i.test(joined);
}

function verifySmokeRequest(conversation: ProblemConversation): {
  ok: boolean;
  checks: Record<string, boolean>;
  memoryExcerpt: string;
} {
  const memory = turn1Memory(conversation) ?? "";
  const turn1 = conversation.messages.find((message) => message.turnIndex === 1);
  const joined = (turn1?.modelRequest ?? [])
    .map((item) => item.content)
    .join("\n");
  const checks = {
    hasEmptyMemoryPhrase: /No persistent considerations have been established yet/i.test(
      memory,
    ),
    noConsiderationRows: !/\bCONSIDERATION:/i.test(memory),
    noSeededOrigin: !/Origin:\s*seeded from task/i.test(joined),
    noMoralQuestionId: !/\bmoral:question\b/i.test(memory),
    noMoralStanceId: !/\bmoral:stance\b/i.test(memory),
    hasReadyToFinalize: /readyToFinalize/i.test(joined),
    hasMutualReadinessLanguage:
      /mutual readyToFinalize|both agents have independently judged/i.test(joined),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    memoryExcerpt: memory.slice(0, 400),
  };
}

function analyzeConversation(
  problem: Problem,
  conversation: ProblemConversation,
): Record<string, unknown> {
  const graph = graphOf(conversation);
  const collab = conversation.reasoningDiagnostics?.collaboration;
  const moral = conversation.reasoningDiagnostics?.moralSynthesis;
  const rejected = (conversation.reasoningEvents ?? []).filter(
    (event) => !event.accepted && event.mutation.type !== "final_answer",
  );
  const created = graph.subjects.filter((subject) => subject.source === "agent");
  const createdA = created.filter((subject) => subject.createdBy === "agent_a");
  const createdB = created.filter((subject) => subject.createdBy === "agent_b");
  const afterTurn1 = created.filter(
    (subject) => (subject.createdAtTurn ?? 0) > 1,
  );
  const nonFinal = conversation.messages.filter(
    (message) => !/^FINAL_ANSWER:/m.test(message.content),
  );
  const questions = nonFinal.reduce(
    (sum, message) => sum + questionCount(message.content),
    0,
  );
  const disagreementTurns = nonFinal.filter((message) =>
    disagreementCue(message.content),
  ).length;

  const aRevisesB = (conversation.reasoningEvents ?? []).filter((event) => {
    if (!event.accepted || event.mutation.type !== "REVISE") return false;
    if (event.agentId !== "agent_a") return false;
    const subject = graph.subjects.find(
      (item) =>
        "subjectId" in event.mutation && item.id === event.mutation.subjectId,
    );
    return subject?.createdBy === "agent_b";
  }).length;
  const bRevisesA = (conversation.reasoningEvents ?? []).filter((event) => {
    if (!event.accepted || event.mutation.type !== "REVISE") return false;
    if (event.agentId !== "agent_b") return false;
    const subject = graph.subjects.find(
      (item) =>
        "subjectId" in event.mutation && item.id === event.mutation.subjectId,
    );
    return subject?.createdBy === "agent_a";
  }).length;

  const reference = problem.moral?.issues ?? [];
  const recovered: string[] = [];
  const missed: string[] = [];
  for (const issue of reference) {
    const hit = created.some((subject) => {
      const content = currentValue(graph, subject.id) ?? "";
      return (
        overlapRatio(subject.label ?? subject.id, issue) >= 0.4 ||
        overlapRatio(content, issue) >= 0.35
      );
    });
    if (hit) recovered.push(issue);
    else missed.push(issue);
  }
  const novel = created.filter((subject) => {
    const content = currentValue(graph, subject.id) ?? "";
    return !reference.some(
      (issue) =>
        overlapRatio(subject.label ?? subject.id, issue) >= 0.4 ||
        overlapRatio(content, issue) >= 0.35,
    );
  });

  const nearDuplicates: Array<[string, string]> = [];
  for (let i = 0; i < created.length; i++) {
    for (let j = i + 1; j < created.length; j++) {
      const a = created[i]!;
      const b = created[j]!;
      const aContent = currentValue(graph, a.id) ?? "";
      const bContent = currentValue(graph, b.id) ?? "";
      if (
        overlapRatio(a.label ?? a.id, b.label ?? b.id) >= 0.6 ||
        overlapRatio(aContent, bContent) >= 0.55
      ) {
        nearDuplicates.push([a.label ?? a.id, b.label ?? b.id]);
      }
    }
  }

  return {
    problemId: problem.id,
    title: problem.title,
    referenceIssues: reference,
    stoppedReason: conversation.stoppedReason,
    turnCount: conversation.messages.length,
    finalizer: conversation.messages.at(-1)?.agentId,
    finalAnswer: conversation.finalAnswer,
    considerationsCreatedA: createdA.length,
    considerationsCreatedB: createdB.length,
    considerationsCreatedAfterTurn1: afterTurn1.length,
    considerations: created.map((subject) => describeSubject(graph, subject)),
    referenceRecovered: recovered,
    referenceMissed: missed,
    novelConsiderations: novel.map((subject) => subject.label ?? subject.id),
    nearDuplicates,
    questions,
    disagreementTurns,
    aRevisesBCreated: aRevisesB,
    bRevisesACreated: bRevisesA,
    rejectedMutationCount: rejected.length,
    reviseBeforeSet: rejected.filter((event) =>
      event.errors.some((error) => /use SET|unknown/i.test(error)),
    ).length,
    badVersionRefs: rejected.filter((event) =>
      event.errors.some((error) => /fromVersionId|stale before/i.test(error)),
    ).length,
    collaboration: collab,
    moralSynthesis: moral,
    turnProtocol: conversation.messages.map((message) => ({
      turn: message.turnIndex,
      agent: message.agentId,
      materialGraphChange: message.materialGraphChange === true,
      readyToFinalize: message.readyToFinalize === true,
      readinessInvalidated: message.readinessInvalidated === true,
      setCount: (message.reasoningMutations ?? []).filter(
        (mutation) => mutation.type === "SET",
      ).length,
      reviseCount: (message.reasoningMutations ?? []).filter(
        (mutation) => mutation.type === "REVISE",
      ).length,
    })),
    turn1MemoryEmpty: /No persistent considerations have been established yet/i.test(
      turn1Memory(conversation) ?? "",
    ),
    readyProtocolPresent: requestHasReady(conversation),
    graphSerialization: formatReasoningState(graph),
  };
}

function loadBaseline(): {
  runId: string;
  conversations: Array<{
    problemId: string;
    turnCount: number;
    seededInTurn1: boolean;
    readyInTurn1: boolean;
    considerations: string[];
  }>;
} | null {
  const path = resolve(process.cwd(), ".data/runs.json");
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { runs?: unknown }).runs)
      ? ((raw as { runs: unknown[] }).runs)
      : Object.values(raw as Record<string, unknown>);
  const run = list.find(
    (item) =>
      item &&
      typeof item === "object" &&
      (item as { id?: string }).id === BASELINE_RUN_ID,
  ) as
    | {
        id: string;
        conversations?: Array<{
          problemId: string;
          messages?: Array<{
            turnIndex?: number;
            modelRequest?: Array<{ content: string }>;
          }>;
          reasoningSubjects?: Array<{ id: string; label?: string }>;
        }>;
      }
    | undefined;
  if (!run?.conversations) return null;
  return {
    runId: run.id,
    conversations: run.conversations.map((conversation) => {
      const turn1 = conversation.messages?.find(
        (message) => message.turnIndex === 1,
      );
      const memory =
        turn1?.modelRequest?.find((item) =>
          item.content.startsWith("CURRENT SHARED REASONING STATE"),
        )?.content ?? "";
      const joined = (turn1?.modelRequest ?? [])
        .map((item) => item.content)
        .join("\n");
      return {
        problemId: conversation.problemId,
        turnCount: conversation.messages?.length ?? 0,
        seededInTurn1: /Origin:\s*seeded from task/i.test(memory),
        readyInTurn1: /readyToFinalize/i.test(joined),
        considerations: (conversation.reasoningSubjects ?? []).map(
          (subject) => subject.label ?? subject.id,
        ),
      };
    }),
  };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const server = createServer((req, res) => {
    if (!isGenerateApiPath(req.url)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    void handleGenerateApiRequest(req, res, apiKey);
  });
  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const generateUrl = `http://127.0.0.1:${addr.port}/api/generate`;
  const client = createModelClient({ generateUrl });
  const prompts = buildAgentPromptPair(DEFAULT_COMMUNICATION_POLICY);
  const config = normalizeRunConfig(
    {
      problemCategory: "moral_philosophical",
      problemCount: 1,
      // Match baseline run model/effort where possible.
      runModel: "gpt-5.6-luna",
      runReasoningEffort: "low",
      evaluationEnabled: false,
      maxTurns: 40,
      temperature: 0.4,
      moralSubjectInitialization: "agent-created",
      moralSubjectSeeding: "agent-created",
    },
    DEFAULT_RUN_CONFIG,
  );

  console.log("======== SMOKE: one conversation, inspect persisted modelRequest ========");
  const smokeProblem = requireProblem(SMOKE_ID);
  const smokeConversation = await runProblem({
    problem: smokeProblem,
    policy: DEFAULT_COMMUNICATION_POLICY,
    config,
    client,
    agentPrompts: prompts,
  });
  const smoke = verifySmokeRequest(smokeConversation);
  console.log(JSON.stringify(smoke, null, 2));
  if (!smoke.ok) {
    server.close();
    throw new Error(
      "Smoke test failed: turn-1 persisted modelRequest is not empty-graph + readyToFinalize",
    );
  }
  console.log(
    `✓ Smoke OK — turns=${smokeConversation.messages.length} stopped=${smokeConversation.stoppedReason}`,
  );

  console.log("\n======== PAIRED BATCH: same 10 IDs as", BASELINE_RUN_ID, "========");
  const reports: Array<Record<string, unknown>> = [];
  for (const id of PAIRED_IDS) {
    const problem = requireProblem(id);
    console.log(`\n=== ${problem.id} ===`);
    const conversation =
      id === SMOKE_ID
        ? smokeConversation
        : await runProblem({
            problem,
            policy: DEFAULT_COMMUNICATION_POLICY,
            config,
            client,
            agentPrompts: prompts,
          });
    const row = analyzeConversation(problem, conversation);
    console.log(
      JSON.stringify(
        {
          turns: row.turnCount,
          stopped: row.stoppedReason,
          createdA: row.considerationsCreatedA,
          createdB: row.considerationsCreatedB,
          afterT1: row.considerationsCreatedAfterTurn1,
          questions: row.questions,
          disagreeTurns: row.disagreementTurns,
          rejected: row.rejectedMutationCount,
          novel: row.novelConsiderations,
          recovered: row.referenceRecovered,
          missed: row.referenceMissed,
        },
        null,
        2,
      ),
    );
    reports.push(row);
  }

  const turns = reports.map((row) => Number(row.turnCount));
  const createdCounts = reports.map(
    (row) =>
      Number(row.considerationsCreatedA) + Number(row.considerationsCreatedB),
  );
  const baseline = loadBaseline();
  const summary = {
    protocol: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version,
    moralInitialization: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.moralInitialization,
    config: {
      runModel: config.runModel,
      runReasoningEffort: config.runReasoningEffort,
      temperature: config.temperature,
      maxTurns: config.maxTurns,
      moralSubjectInitialization: config.moralSubjectInitialization,
      moralSubjectSeeding: config.moralSubjectSeeding,
    },
    smoke,
    n: reports.length,
    meanTurns: mean(turns),
    medianTurns: median(turns),
    turnDistribution: turns,
    meanConsiderationCount: mean(createdCounts),
    meanCreatedA: mean(reports.map((row) => Number(row.considerationsCreatedA))),
    meanCreatedB: mean(reports.map((row) => Number(row.considerationsCreatedB))),
    meanCreatedAfterTurn1: mean(
      reports.map((row) => Number(row.considerationsCreatedAfterTurn1)),
    ),
    conversationsWithQuestions: reports.filter(
      (row) => Number(row.questions) > 0,
    ).length,
    conversationsWithDisagreementCues: reports.filter(
      (row) => Number(row.disagreementTurns) > 0,
    ).length,
    meanBRevisesA: mean(reports.map((row) => Number(row.bRevisesACreated))),
    meanARevisesB: mean(reports.map((row) => Number(row.aRevisesBCreated))),
    rejectedMutationTotal: reports.reduce(
      (sum, row) => sum + Number(row.rejectedMutationCount),
      0,
    ),
    badVersionRefsTotal: reports.reduce(
      (sum, row) => sum + Number(row.badVersionRefs),
      0,
    ),
    reviseBeforeSetTotal: reports.reduce(
      (sum, row) => sum + Number(row.reviseBeforeSet),
      0,
    ),
    meanConvergenceResets: mean(
      reports.map((row) =>
        Number(
          (row.collaboration as { convergenceResets?: number } | undefined)
            ?.convergenceResets ?? 0,
        ),
      ),
    ),
    baselineComparison: baseline
      ? {
          baselineRunId: baseline.runId,
          baselineMeanTurns: mean(
            baseline.conversations.map((row) => row.turnCount),
          ),
          baselineTurnDistribution: baseline.conversations.map(
            (row) => row.turnCount,
          ),
          baselineAllSeededTurn1: baseline.conversations.every(
            (row) => row.seededInTurn1,
          ),
          baselineAnyReadyTurn1: baseline.conversations.some(
            (row) => row.readyInTurn1,
          ),
          newMeanTurns: mean(turns),
          newTurnDistribution: turns,
          paired: PAIRED_IDS.map((id) => {
            const oldRow = baseline.conversations.find(
              (row) => row.problemId === id,
            );
            const newRow = reports.find((row) => row.problemId === id);
            return {
              problemId: id,
              oldTurns: oldRow?.turnCount ?? null,
              newTurns: Number(newRow?.turnCount ?? 0),
              oldSeeded: oldRow?.seededInTurn1 ?? null,
              newEmpty: newRow?.turn1MemoryEmpty === true,
              oldReady: oldRow?.readyInTurn1 ?? null,
              newReady: newRow?.readyProtocolPresent === true,
              newConsiderations: newRow?.considerations,
              newNovel: newRow?.novelConsiderations,
              newRecovered: newRow?.referenceRecovered,
              newMissed: newRow?.referenceMissed,
            };
          }),
        }
      : null,
  };

  console.log("\n======== SUMMARY ========");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = resolve(process.cwd(), ".data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(
    outDir,
    `moral-empty-graph-audit-${Date.now()}.json`,
  );
  writeFileSync(outPath, JSON.stringify({ summary, reports }, null, 2));
  console.log(`\nWrote ${outPath}`);
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
