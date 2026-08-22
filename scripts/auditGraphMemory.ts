/**
 * Fresh graph-memory working-state audit.
 *
 * Runs 3 crossword + 3 moral + 3 hidden-profile conversations and prints persistence
 * diagnostics plus enough transcript/graph evidence to classify capture.
 *
 * Usage: npm run audit:graph-memory
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
import type { Problem, ProblemCategory } from "../src/problems/types.ts";
import {
  computePersistenceDiagnostics,
  coverageForTurn,
  currentValue,
  formatReasoningState,
  hydrateReasoningGraph,
} from "../src/reasoning/index.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import { OPENAI_MODEL_ID } from "../src/runtime/models.ts";
import { runProblem } from "../src/runtime/runProblem.ts";

type Target = { category: ProblemCategory; id: string };

const TARGETS: Target[] = [
  { category: "crossword", id: "crosswordbench_0007" },
  { category: "crossword", id: "crosswordbench_0013" },
  { category: "crossword", id: "crosswordbench_0003" },
  { category: "moral_philosophical", id: "reddit_ethics_0034" },
  { category: "moral_philosophical", id: "reddit_ethics_0001" },
  { category: "moral_philosophical", id: "reddit_ethics_0005" },
  { category: "hidden_profile", id: "hp_hiring_complementary" },
  { category: "hidden_profile", id: "hp_route_conflicting" },
  { category: "hidden_profile", id: "hp_candidate_classic" },
];

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

function requireProblem(target: Target): Problem {
  const problem = getProblemById(target.category, target.id);
  if (!problem) throw new Error(`missing problem ${target.id}`);
  return problem;
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
      problemCategory: "crossword",
      problemCount: 1,
      runModel: OPENAI_MODEL_ID,
      maxTurns: 8,
      temperature: 0.4,
    },
    DEFAULT_RUN_CONFIG,
  );

  const reports: unknown[] = [];
  for (const target of TARGETS) {
    const problem = requireProblem(target);
    console.log(`\n=== ${problem.id} (${problem.category}) ===`);
    const conversation = await runProblem({
      problem,
      policy: DEFAULT_COMMUNICATION_POLICY,
      config: { ...config, problemCategory: target.category },
      client,
      agentPrompts: prompts,
    });
    const graph = hydrateReasoningGraph({
      reasoningSchemaVersion: conversation.reasoningSchemaVersion,
      reasoningSubjects: conversation.reasoningSubjects,
      reasoningVersions: conversation.reasoningVersions,
      reasoningEvents: conversation.reasoningEvents,
    });
    const persistence = computePersistenceDiagnostics(
      graph,
      conversation.messages.map((message) => ({
        id: message.id,
        turnIndex: message.turnIndex,
        content: message.content,
      })),
    );
    const turns = conversation.messages.map((message) => {
      const coverage = coverageForTurn(graph, message.turnIndex, message);
      return {
        turn: message.turnIndex,
        agent: message.agentId,
        message: message.content,
        mutations: message.reasoningMutations ?? [],
        coverage,
      };
    });
    const current = Object.fromEntries(
      graph.subjects.map((subject) => [
        subject.id,
        currentValue(graph, subject.id) ?? null,
      ]),
    );
    console.log("stopped:", conversation.stoppedReason);
    console.log("turns:", conversation.messages.length);
    console.log("persistence:", JSON.stringify(persistence, null, 2));
    console.log("subjects:", Object.keys(current).join(", ") || "(none)");
    for (const turn of turns) {
      const flags = [
        turn.coverage.persistentChange ? "PERSISTED" : "NO PERSISTENT CHANGE",
        turn.coverage.persistenceReview ? "PERSISTENCE REVIEW" : null,
        turn.coverage.protocolFailure ? "PROTOCOL FAILURE" : null,
        turn.coverage.structuredReasoningMissing ? "STRUCTURED MISSING" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`\n[t${turn.turn} ${turn.agent}] ${flags}`);
      console.log(turn.message.slice(0, 700));
      if (turn.coverage.subjectsChanged.length > 0) {
        console.log("  subjects:", turn.coverage.subjectsChanged.join(", "));
      }
      if (turn.coverage.basisRefs.length > 0) {
        console.log("  basis:", turn.coverage.basisRefs.join(", "));
      }
    }
    console.log("\n--- canonical state ---");
    console.log(formatReasoningState(graph));
    reports.push({
      protocol: GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version,
      problemId: problem.id,
      category: problem.category,
      stoppedReason: conversation.stoppedReason,
      finalAnswer: conversation.finalAnswer,
      persistence,
      current,
      turns,
      graphSerialization: formatReasoningState(graph),
      diagnostics: conversation.reasoningDiagnostics,
    });
  }

  const outDir = resolve(process.cwd(), ".data");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `graph-memory-audit-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(reports, null, 2));
  console.log(`\nWrote ${outPath}`);
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
