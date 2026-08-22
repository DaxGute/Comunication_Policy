/**
 * Live paired Hidden Profile overlap dose-response (costs API).
 *
 * Samples 10 tasks once, then runs o ∈ {0, .25, .50, .75, 1} with the same
 * problem IDs, same draw nonce, neutral policy, evaluation enabled.
 *
 * Usage:
 *   vite-node scripts/runHiddenProfileOverlapSweep.ts [sampleSeed]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { generateWithOpenAI } from "../server/generateApi.ts";
import { createCommunicationPolicy } from "../src/communication/policy";
import { normalizeRunConfig } from "../src/experiment/configAccessors";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { selectProblems } from "../src/problems/registry";
import {
  createModelClient,
  type ModelRequest,
  type ModelResponse,
} from "../src/runtime/modelClient";
import { runExperiment } from "../src/runtime/runExperiment";

function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
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

loadEnvLocal();
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error("OPENAI_API_KEY missing (.env.local)");
}

const sampleSeed = process.argv[2]?.trim() || `hp-sweep-${Date.now()}`;
const overlaps = [0, 0.25, 0.5, 0.75, 1] as const;
const problems = selectProblems("hidden_profile", 10, { seed: sampleSeed });
const problemIds = problems.map((p) => p.id);
const drawNonce = `info-draw|${sampleSeed}`;

const policy = createCommunicationPolicy({
  trustA: 0.5,
  trustB: 0.5,
  authority: 0.5,
  familiarity: 0.5,
});

const client = createModelClient({
  directOpenAIGenerate: async (input: ModelRequest): Promise<ModelResponse> => {
    const result = await generateWithOpenAI(
      {
        model: input.model,
        temperature: input.temperature,
        messages: input.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(input.reasoningEffort
          ? { reasoningEffort: input.reasoningEffort }
          : {}),
        runId: "hp-overlap-sweep",
      },
      apiKey,
      input.signal,
    );
    return {
      content: result.content,
      provider: "openai",
      durationMs: result.durationMs,
      usage: result.usage
        ? {
            inputTokens: result.usage.inputTokens,
            promptTokens: result.usage.promptTokens,
            cachedInputTokens: result.usage.cachedInputTokens,
            outputTokens: result.usage.outputTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
            source: "provider",
          }
        : undefined,
    };
  },
});

const outDir = path.join(process.cwd(), ".data");
mkdirSync(outDir, { recursive: true });

type SummaryRow = Record<string, string | number | boolean | null>;
const rows: SummaryRow[] = [];

console.log(`sampleSeed=${sampleSeed}`);
console.log(`problemIds=${problemIds.join(", ")}`);

for (const o of overlaps) {
  console.log(`\n=== running overlap=${o} ===`);
  const config = normalizeRunConfig(
    {
      ...DEFAULT_RUN_CONFIG,
      problemCategory: "hidden_profile",
      problemCount: problemIds.length,
      problemIds,
      informationOverlap: o,
      informationStructure: {
        overlapRequested: o,
        splitSeed: drawNonce,
        assignmentMode: "balanced-cover",
        counterbalanced: false,
        packetDirection: "standard",
      },
      evaluationEnabled: true,
      maxTurns: 40,
      temperature: 0.4,
    },
    DEFAULT_RUN_CONFIG,
  );

  const run = await runExperiment({
    policy,
    config,
    client,
  });

  for (const c of run.conversations) {
    const t = c.informationAssignment?.hiddenProfileTreatment;
    const ifm = c.informationFlowMetrics;
    const evalRow = run.evaluation?.problems.find((p) => p.problemId === c.problemId);
    rows.push({
      runId: run.id,
      problem: c.problemId,
      requested_overlap: o,
      private_promotion_rate: t?.privatePromotionRate ?? null,
      a_private_remaining: t?.realizedAPrivateCount ?? null,
      b_private_remaining: t?.realizedBPrivateCount ?? null,
      turns: c.messages.length,
      accuracy: evalRow?.label === "correct"
        ? true
        : evalRow?.label === "incorrect"
          ? false
          : null,
      stall: c.stoppedReason === "reasoning_protocol_stalled",
      stopped: c.stoppedReason,
      reveal_A: ifm?.timeToRevealA ?? null,
      reveal_B: ifm?.timeToRevealB ?? null,
      partner_uptake: ifm?.timeToPartnerUptake ?? null,
      cross_agent_revisions: ifm?.crossAgentRevisionCount ?? null,
      transfer_rate: ifm?.crossAgentPrivateInfoTransferRate ?? null,
      decisive_coverage: ifm?.decisiveInformationCoverage ?? null,
      final: (c.finalAnswer ?? "").split("\n")[0] ?? "",
    });
  }
}

const outPath = path.join(outDir, `hp-overlap-sweep-${sampleSeed}.json`);
writeFileSync(
  outPath,
  JSON.stringify({ sampleSeed, problemIds, drawNonce, rows }, null, 2),
);
console.log(`\nWrote ${outPath}`);
console.log("CSV");
const headers = Object.keys(rows[0] ?? {});
console.log(headers.join(","));
for (const row of rows) {
  console.log(headers.map((h) => JSON.stringify(row[h] ?? "")).join(","));
}
