/**
 * Live moral collaboration sample after protocol-v2.
 *
 * Usage: npm run sample:moral-collaboration
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
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
import { hydrateReasoningGraph } from "../src/reasoning/index.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import { runProblem } from "../src/runtime/runProblem.ts";

const TARGET_IDS = [
  "reddit_ethics_0042",
  "reddit_ethics_0021",
  "reddit_ethics_0027",
  "reddit_ethics_0016",
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
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
      runModel: "gpt-5.4-nano",
      runReasoningEffort: "low",
      maxTurns: 40,
      temperature: 0.4,
    },
    DEFAULT_RUN_CONFIG,
  );

  const rows: Array<{
    id: string;
    turns: number;
    aSpoke: boolean;
    bSpoke: boolean;
    ownA: boolean;
    ownB: boolean;
    crossRevise: number;
    crossDerived: number;
    finalizedBeforeBPersisted: boolean;
    rejected: number;
    zeroA: number;
    zeroB: number;
    stopped: string;
  }> = [];

  for (const id of TARGET_IDS) {
    const problem = requireProblem(id);
    console.log(`\n=== ${problem.id} ===`);
    const conversation = await runProblem({
      problem,
      policy: DEFAULT_COMMUNICATION_POLICY,
      config,
      client,
      agentPrompts: prompts,
    });
    const collab = conversation.reasoningDiagnostics?.collaboration;
    const graph = hydrateReasoningGraph({
      reasoningSchemaVersion: conversation.reasoningSchemaVersion,
      reasoningSubjects: conversation.reasoningSubjects,
      reasoningVersions: conversation.reasoningVersions,
      reasoningEvents: conversation.reasoningEvents,
    });
    const liveA = graph.versions.some(
      (version) => version.status === "active" && version.agentId === "agent_a",
    );
    const liveB = graph.versions.some(
      (version) => version.status === "active" && version.agentId === "agent_b",
    );
    rows.push({
      id: problem.id,
      turns: conversation.messages.length,
      aSpoke: collab?.aSpoke ?? false,
      bSpoke: collab?.bSpoke ?? false,
      ownA: liveA,
      ownB: liveB,
      crossRevise: collab?.crossAgentRevisionCount ?? 0,
      crossDerived: collab?.crossAgentDerivedFromCount ?? 0,
      finalizedBeforeBPersisted: collab?.finalizedBeforeBPersisted ?? false,
      rejected: conversation.reasoningDiagnostics?.rejectedMutationCount ?? 0,
      zeroA: collab?.turnsWithNoPersistentChangeA ?? 0,
      zeroB: collab?.turnsWithNoPersistentChangeB ?? 0,
      stopped: conversation.stoppedReason,
    });
    console.log(
      JSON.stringify(
        {
          stopped: conversation.stoppedReason,
          turns: conversation.messages.length,
          collaboration: collab,
        },
        null,
        2,
      ),
    );
  }

  const n = rows.length;
  const turns = rows.map((row) => row.turns);
  const mean = turns.reduce((sum, value) => sum + value, 0) / n;
  const pct = (count: number) => `${((count / n) * 100).toFixed(0)}%`;
  const rejected = rows.reduce((sum, row) => sum + row.rejected, 0);
  const eventsGuess = rows.reduce((sum, row) => sum + row.turns, 0);
  console.log("\n======== collaboration sample ========");
  console.log("protocol", GRAPH_MEMORY_TRANSCRIPT_PROTOCOL.version);
  console.log("conversation count", n);
  console.log("mean turns", mean.toFixed(2));
  console.log("median turns", median(turns));
  console.log("min/max turns", Math.min(...turns), Math.max(...turns));
  console.log("% with both agents speaking", pct(rows.filter((row) => row.aSpoke && row.bSpoke).length));
  console.log(
    "% with both agents owning >=1 persistent proposition",
    pct(rows.filter((row) => row.ownA && row.ownB).length),
  );
  console.log(
    "% with at least one cross-agent REVISE",
    pct(rows.filter((row) => row.crossRevise > 0).length),
  );
  console.log(
    "% with at least one cross-agent derived_from",
    pct(rows.filter((row) => row.crossDerived > 0).length),
  );
  console.log(
    "% finalized before B persisted anything",
    pct(rows.filter((row) => row.finalizedBeforeBPersisted).length),
  );
  console.log("rejected mutation count (sum)", rejected);
  console.log(
    "zero-mutation turns A/B (sum)",
    rows.reduce((sum, row) => sum + row.zeroA, 0),
    rows.reduce((sum, row) => sum + row.zeroB, 0),
  );
  console.log("turn volume (sum)", eventsGuess);
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
