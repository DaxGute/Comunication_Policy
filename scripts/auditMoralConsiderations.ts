/**
 * Fresh moral audit after agent-created init + convergence handshake.
 *
 * Runs 10 moral conversations and reports initialization, decomposition,
 * dialogue depth, participation, fidelity, and mechanical reliability.
 *
 * Usage: npm run audit:moral-considerations
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
  mutationSubjectId,
  versionsForSubject,
  type ReasoningGraph,
  type ReasoningSubject,
} from "../src/reasoning/index.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import { OPENAI_MODEL_ID } from "../src/runtime/models.ts";
import { runProblem } from "../src/runtime/runProblem.ts";

const TARGET_IDS = [
  "reddit_ethics_0034",
  "reddit_ethics_0001",
  "reddit_ethics_0005",
  "reddit_ethics_0002",
  "reddit_ethics_0003",
  "reddit_ethics_0004",
  "reddit_ethics_0006",
  "reddit_ethics_0007",
  "reddit_ethics_0008",
  "reddit_ethics_0009",
] as const;

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

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 5),
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
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
      runModel: OPENAI_MODEL_ID,
      maxTurns: 16,
      temperature: 0.4,
      moralSubjectInitialization: "agent-created",
    },
    DEFAULT_RUN_CONFIG,
  );

  const reports: Array<Record<string, unknown>> = [];
  for (const id of TARGET_IDS) {
    const problem = requireProblem(id);
    console.log(`\n======== ${problem.id} ========`);
    console.log(problem.title);
    const conversation = await runProblem({
      problem,
      policy: DEFAULT_COMMUNICATION_POLICY,
      config,
      client,
      agentPrompts: prompts,
    });
    const graph = hydrateReasoningGraph({
      reasoningSchemaVersion: conversation.reasoningSchemaVersion,
      reasoningSubjects: conversation.reasoningSubjects,
      reasoningVersions: conversation.reasoningVersions,
      reasoningEvents: conversation.reasoningEvents,
    });
    const collab = conversation.reasoningDiagnostics?.collaboration;
    const moral = conversation.reasoningDiagnostics?.moralSynthesis;
    const rejected = (conversation.reasoningEvents ?? []).filter(
      (event) => !event.accepted && event.mutation.type !== "final_answer",
    );
    const reviseBeforeSet = rejected.filter((event) =>
      event.errors.some((error) => /use SET|unknown/i.test(error)),
    ).length;
    const badVersion = rejected.filter((event) =>
      event.errors.some((error) => /fromVersionId|stale before/i.test(error)),
    ).length;
    const badBasis = rejected.filter((event) =>
      event.errors.some((error) => /basis|malformed/i.test(error)),
    ).length;
    const created = graph.subjects.filter((subject) => subject.source === "agent");
    const answer = conversation.finalAnswer?.trim() ?? "";
    const considerationText = graph.subjects
      .map((subject) => currentValue(graph, subject.id) ?? "")
      .join(" ");
    const missingFromGraph =
      answer.length > 0
        ? [...tokens(answer)].filter(
            (token) => !considerationText.toLowerCase().includes(token),
          )
        : [];

    const row = {
      protocol: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version,
      moralInitialization: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.moralInitialization,
      problemId: problem.id,
      title: problem.title,
      referenceIssues: problem.moral?.issues ?? [],
      preAgentSubjectCount: 0,
      stoppedReason: conversation.stoppedReason,
      turnCount: conversation.messages.length,
      finalizer: conversation.messages.at(-1)?.agentId,
      finalAnswer: conversation.finalAnswer,
      collaboration: collab,
      moralSynthesis: moral,
      considerations: created.map((subject) => describeSubject(graph, subject)),
      rejectedMutationCount: rejected.length,
      reviseBeforeSet,
      badVersionRefs: badVersion,
      badBasisIds: badBasis,
      finalAnswerTokensMissingFromConsiderations: missingFromGraph.slice(0, 12),
      turnProtocol: conversation.messages.map((message) => ({
        turn: message.turnIndex,
        agent: message.agentId,
        materialGraphChange: message.materialGraphChange === true,
        readyToFinalize: message.readyToFinalize === true,
        readinessInvalidated: message.readinessInvalidated === true,
      })),
      graphSerialization: formatReasoningState(graph),
    };
    console.log(
      JSON.stringify(
        {
          turns: row.turnCount,
          stopped: row.stoppedReason,
          finalizer: row.finalizer,
          createdA: moral?.considerationsCreatedA,
          createdB: moral?.considerationsCreatedB,
          materialTurns: collab?.materialGraphChangeTurns,
          convergenceResets: collab?.convergenceResets,
          rejected: row.rejectedMutationCount,
          refCoverage: moral?.referenceConsiderationCoverage,
        },
        null,
        2,
      ),
    );
    reports.push(row);
  }

  const turns = reports.map((row) => Number(row.turnCount));
  const summary = {
    n: reports.length,
    preAgentSubjectCountMax: Math.max(
      ...reports.map((row) => Number(row.preAgentSubjectCount)),
    ),
    meanTurns: turns.reduce((a, b) => a + b, 0) / Math.max(turns.length, 1),
    medianTurns: median(turns),
    turnDistribution: turns,
    meanMaterialGraphChangeTurns:
      reports.reduce(
        (sum, row) =>
          sum +
          Number(
            (row.collaboration as { materialGraphChangeTurns?: number } | undefined)
              ?.materialGraphChangeTurns ?? 0,
          ),
        0,
      ) / Math.max(reports.length, 1),
    meanConvergenceResets:
      reports.reduce(
        (sum, row) =>
          sum +
          Number(
            (row.collaboration as { convergenceResets?: number } | undefined)
              ?.convergenceResets ?? 0,
          ),
        0,
      ) / Math.max(reports.length, 1),
    rejectedMutationTotal: reports.reduce(
      (sum, row) => sum + Number(row.rejectedMutationCount),
      0,
    ),
    reviseBeforeSetTotal: reports.reduce(
      (sum, row) => sum + Number(row.reviseBeforeSet),
      0,
    ),
    badVersionRefsTotal: reports.reduce(
      (sum, row) => sum + Number(row.badVersionRefs),
      0,
    ),
    badBasisIdsTotal: reports.reduce(
      (sum, row) => sum + Number(row.badBasisIds),
      0,
    ),
    finalizerCounts: reports.reduce(
      (acc, row) => {
        const who = String(row.finalizer ?? "none");
        acc[who] = (acc[who] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    ),
  };

  console.log("\n======== SUMMARY ========");
  console.log(JSON.stringify(summary, null, 2));

  const outDir = resolve(process.cwd(), ".data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(
    outDir,
    `moral-convergence-audit-${Date.now()}.json`,
  );
  writeFileSync(outPath, JSON.stringify({ summary, reports }, null, 2));
  console.log(`\nWrote ${outPath}`);
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
