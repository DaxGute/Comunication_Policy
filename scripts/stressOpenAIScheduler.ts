/**
 * Live stress test of the shared OpenAI scheduler against Tier 2 capacity.
 *
 * Usage: npm run stress:openai-scheduler
 *
 * Runs a representative 40-problem crossword experiment on gpt-5.6-terra
 * (1M TPM). Does not change conversation semantics.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateWithOpenAI } from "../server/generateApi.ts";
import { getOpenAIScheduler } from "../server/openaiScheduler.ts";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy.ts";
import { normalizeRunConfig } from "../src/experiment/configAccessors.ts";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults.ts";
import type { ExperimentRun } from "../src/experiment/types.ts";
import { getModelRateLimit } from "../src/models/modelRegistry.ts";
import { createModelClient, type ModelRequest, type ModelResponse } from "../src/runtime/modelClient.ts";
import { runExperiment } from "../src/runtime/runExperiment.ts";

const MODEL = "gpt-5.6-terra";
const PROBLEM_COUNT = 40;
const MAX_TURNS = 6;
const SAMPLE_MS = 500;
const PROBE_MODELS = ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-nano"] as const;

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

type Sample = {
  tMs: number;
  inFlight: number;
  queued: number;
  rpm: number;
  tpm: number;
  bottleneck: string | null;
  completed: number;
  retries: number;
  rateLimits: number;
};

function pct(n: number, d: number): string {
  if (!d) return "n/a";
  return `${((100 * n) / d).toFixed(1)}%`;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function probeSharedPools(apiKey: string): Promise<void> {
  const scheduler = getOpenAIScheduler();
  console.log("\n=== Rate-limit pool probe ===");

  const tiny = async (model: string, padChars = 0) => {
    const pad = padChars > 0 ? "x".repeat(padChars) : "Reply with OK.";
    const result = await generateWithOpenAI(
      {
        model,
        temperature: 0,
        messages: [
          { role: "user", content: padChars > 0 ? `Reply with OK.\n${pad}` : pad },
        ],
      },
      apiKey,
    );
    return result;
  };

  for (const model of PROBE_MODELS) {
    const started = Date.now();
    await tiny(model);
    const snap = scheduler.snapshot();
    const bucket = snap.buckets?.[model];
    console.log(
      `  ${model}: header RPM=${bucket?.headerRpm ?? "?"} TPM=${bucket?.headerTpm ?? "?"} registry=${getModelRateLimit(model).tpm} (${Date.now() - started}ms)`,
    );
  }

  console.log("  sending ~25k-token terra probe to move remaining-tokens...");
  await tiny("gpt-5.6-terra", 100_000);
  const afterTerra = scheduler.snapshot();
  await tiny("gpt-5.6-luna");
  await tiny("gpt-5.4-nano");
  const after = scheduler.snapshot();

  for (const [id, bucket] of Object.entries(after.buckets ?? {})) {
    console.log(
      `  bucket ${id}: models=[${bucket.models.join(", ")}] shared=${bucket.shared} headerTPM=${bucket.headerTpm ?? "?"} recentTPM=${bucket.recentTpm}`,
    );
  }
  const shared = Object.values(after.buckets ?? {}).filter((b) => b.shared);
  if (shared.length === 0) {
    console.log(
      "  result: models kept independent pools (matching distinct dashboard TPM, remaining did not track).",
    );
  } else {
    console.log(
      `  result: merged shared pool(s): ${shared.map((b) => b.models.join("+")).join("; ")}`,
    );
  }
  void afterTerra;
}

function simulateOldScheduler(
  chains: Array<Array<{ durationMs: number; tokens: number }>>,
  maxConcurrent: number,
  tpmLimit: number,
): { wallMs: number; peakInFlight: number; peakTpm: number } {
  type Job = { chain: number; idx: number; start: number; end: number; tokens: number };
  const nextIdx = chains.map(() => 0);
  const readyAt = chains.map(() => 0);
  const inflight: Job[] = [];
  const window: Array<{ at: number; tokens: number }> = [];
  let t = 0;
  let peakInFlight = 0;
  let peakTpm = 0;
  let launched = 0;
  const totalTurns = chains.reduce((sum, c) => sum + c.length, 0);

  const prune = (now: number) => {
    const cutoff = now - 60_000;
    while (window.length > 0 && window[0]!.at < cutoff) window.shift();
  };
  const tpmUsed = () => window.reduce((sum, s) => sum + s.tokens, 0);

  while (launched < totalTurns || inflight.length > 0) {
    prune(t);
    for (let i = inflight.length - 1; i >= 0; i--) {
      const job = inflight[i]!;
      if (job.end <= t) {
        window.push({ at: job.start, tokens: job.tokens });
        inflight.splice(i, 1);
        nextIdx[job.chain] = job.idx + 1;
        readyAt[job.chain] = job.end;
      }
    }
    prune(t);
    let launchedThisStep = false;
    for (let chain = 0; chain < chains.length; chain++) {
      const idx = nextIdx[chain]!;
      const turn = chains[chain]![idx];
      if (!turn || readyAt[chain]! > t) continue;
      if (inflight.some((j) => j.chain === chain)) continue;
      if (inflight.length >= maxConcurrent) continue;
      const reserved = inflight.reduce((sum, j) => sum + j.tokens, 0);
      if (inflight.length > 0 && tpmUsed() + reserved + turn.tokens > tpmLimit) {
        continue;
      }
      inflight.push({
        chain,
        idx,
        start: t,
        end: t + Math.max(1, turn.durationMs),
        tokens: turn.tokens,
      });
      launched += 1;
      launchedThisStep = true;
      peakInFlight = Math.max(peakInFlight, inflight.length);
    }
    peakTpm = Math.max(peakTpm, tpmUsed() + inflight.reduce((s, j) => s + j.tokens, 0));
    if (inflight.length === 0 && launched < totalTurns) {
      const nextReady = Math.min(
        ...readyAt.filter((at, i) => nextIdx[i]! < (chains[i]?.length ?? 0)),
      );
      if (!Number.isFinite(nextReady) || nextReady <= t) break;
      t = nextReady;
      continue;
    }
    if (!launchedThisStep) {
      const nextEnd = Math.min(...inflight.map((j) => j.end));
      if (!Number.isFinite(nextEnd)) break;
      t = nextEnd;
    }
  }
  return { wallMs: t, peakInFlight, peakTpm };
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing (.env.local or environment).");
  }

  const scheduler = getOpenAIScheduler();
  await probeSharedPools(apiKey);

  const config = normalizeRunConfig(
    {
      problemCategory: "crossword",
      problemCount: PROBLEM_COUNT,
      runModel: MODEL,
      runReasoningEffort: "medium",
      evaluationModel: MODEL,
      evaluationEnabled: false,
      maxTurns: MAX_TURNS,
      temperature: 0.4,
      provider: "openai",
    },
    DEFAULT_RUN_CONFIG,
  );

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
          runId: "stress-scheduler",
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

  const samples: Sample[] = [];
  const t0 = Date.now();
  const timer = setInterval(() => {
    const snap = scheduler.snapshot();
    samples.push({
      tMs: Date.now() - t0,
      inFlight: snap.inFlight,
      queued: snap.queued,
      rpm: snap.approxRecentRpm,
      tpm: snap.approxRecentTpm,
      bottleneck: snap.bottleneck,
      completed: snap.requestsCompleted,
      retries: snap.retryCount,
      rateLimits: snap.rateLimitCount,
    });
    if (samples.length % 10 === 0) {
      const last = samples[samples.length - 1]!;
      console.log(
        `  t=${(last.tMs / 1000).toFixed(0)}s inFlight=${last.inFlight} queued=${last.queued} rpm~${last.rpm} tpm~${last.tpm} bottleneck=${last.bottleneck ?? "none"} done=${last.completed}`,
      );
    }
  }, SAMPLE_MS);

  console.log(
    `\n=== Experiment: ${PROBLEM_COUNT} crossword problems, ${MODEL}, maxTurns=${MAX_TURNS} ===`,
  );
  const limits = getModelRateLimit(MODEL);
  console.log(
    `  configured ${limits.rpm} RPM / ${limits.tpm.toLocaleString()} TPM (scheduler targets ${(limits.tpm * 0.87).toLocaleString()} TPM @ 87%)`,
  );

  let run: ExperimentRun;
  try {
    run = await runExperiment({
      policy: DEFAULT_COMMUNICATION_POLICY,
      config,
      client,
      runId: "stress-scheduler",
    });
  } finally {
    clearInterval(timer);
  }

  const wallMs = Date.now() - t0;
  const finalSnap = scheduler.snapshot();
  const headerTpm =
    finalSnap.buckets?.[MODEL]?.headerTpm ??
    finalSnap.models?.[MODEL]?.advertisedTpm ??
    limits.tpm;
  const headerRpm =
    finalSnap.buckets?.[MODEL]?.headerRpm ??
    finalSnap.models?.[MODEL]?.advertisedRpm ??
    limits.rpm;
  const targetTpm = Math.floor(headerTpm * 0.87);

  const busy = samples.filter((s) => s.inFlight > 0 || s.queued > 0);
  const avgInFlight = mean(busy.map((s) => s.inFlight));
  const peakInFlight = Math.max(0, ...samples.map((s) => s.inFlight), finalSnap.peakConcurrency);
  const peakRpm = Math.max(0, ...samples.map((s) => s.rpm), finalSnap.peakRpm);
  const peakTpm = Math.max(0, ...samples.map((s) => s.tpm), finalSnap.peakTpm);
  const bottleneckCounts = new Map<string, number>();
  for (const s of busy) {
    const key = s.bottleneck ?? "none";
    bottleneckCounts.set(key, (bottleneckCounts.get(key) ?? 0) + 1);
  }

  const problemTimes = run.conversations.map((c) => {
    const start = Date.parse(run.startedAt ?? run.createdAt);
    const last = c.messages[c.messages.length - 1]?.timestamp;
    const end = last ? Date.parse(last) : start;
    return Math.max(0, end - start);
  });

  const chains = run.conversations.map((c) =>
    c.messages.map((m) => ({
      durationMs: m.durationMs ?? 1_000,
      tokens: m.usage?.totalTokens ?? 1,
    })),
  );
  const old = simulateOldScheduler(chains, 4, Math.floor(200_000 * 0.92));

  const est = finalSnap.estimator;
  const charsOver4Bias = est?.meanCharsOver4OverPrompt ?? 0;
  const rawOverActual = est?.meanRawOverActual ?? 0;

  const report = {
    model: MODEL,
    problemCount: PROBLEM_COUNT,
    maxTurns: MAX_TURNS,
    runStatus: run.status,
    failedProblems: run.conversations.filter((c) => c.stoppedReason === "error").length,
    configuredRpm: headerRpm,
    configuredTpm: headerTpm,
    targetTpm,
    peakInFlight,
    avgInFlight,
    processCeiling: 128,
    peakRpm,
    recentRpm: finalSnap.approxRecentRpm,
    peakTpm,
    recentTpm: finalSnap.approxRecentTpm,
    tpmUtilizedVsConfigured: headerTpm ? peakTpm / headerTpm : 0,
    tpmUtilizedVsTarget: targetTpm ? peakTpm / targetTpm : 0,
    rateLimits: finalSnap.rateLimitCount,
    retries: finalSnap.retryCount,
    holBypasses: finalSnap.holBypasses,
    wallMs,
    avgProblemMs: mean(problemTimes),
    bottleneckHistogram: Object.fromEntries(bottleneckCounts),
    estimator: est,
    buckets: finalSnap.buckets,
    oldScheduler: {
      maxConcurrent: 4,
      tpm: 200_000,
      simulatedWallMs: old.wallMs,
      peakInFlight: old.peakInFlight,
      peakTpm: old.peakTpm,
      speedup: old.wallMs > 0 ? old.wallMs / wallMs : null,
    },
    queuePeak: finalSnap.queuedPeak,
    samples,
  };

  const dir = resolve(process.cwd(), ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const outPath = resolve(dir, "scheduler-stress-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("\n=== Stress test results ===");
  console.log(`  status: ${run.status}  problems=${run.conversations.length}  errors=${report.failedProblems}`);
  console.log(`  wall-clock: ${(wallMs / 1000).toFixed(1)}s`);
  console.log(`  avg problem completion: ${(report.avgProblemMs / 1000).toFixed(1)}s`);
  console.log(`  peak simultaneous OpenAI requests: ${peakInFlight}  (process ceiling 128)`);
  console.log(`  average simultaneous requests (busy samples): ${avgInFlight.toFixed(2)}`);
  console.log(`  peak RPM: ${peakRpm}   recent RPM: ${finalSnap.approxRecentRpm}   limit: ${headerRpm}`);
  console.log(`  peak TPM: ${peakTpm.toLocaleString()}   recent TPM: ${finalSnap.approxRecentTpm.toLocaleString()}`);
  console.log(`  configured TPM: ${headerTpm.toLocaleString()}   87% target: ${targetTpm.toLocaleString()}`);
  console.log(`  peak TPM vs configured: ${pct(peakTpm, headerTpm)}   vs 87% target: ${pct(peakTpm, targetTpm)}`);
  console.log(`  429s: ${finalSnap.rateLimitCount}   retries: ${finalSnap.retryCount}   HOL bypasses: ${finalSnap.holBypasses}`);
  console.log(`  queue peak: ${finalSnap.queuedPeak}`);
  console.log("  bottleneck over time (busy samples):");
  for (const [key, count] of [...bottleneckCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key}: ${pct(count, busy.length)} (${count}/${busy.length})`);
  }
  if (est && est.samples > 0) {
    console.log("  estimator:");
    console.log(`    samples=${est.samples}  mean raw estimate=${est.meanRawEstimate.toFixed(0)}  mean actual total=${est.meanActualTotal.toFixed(0)}`);
    console.log(`    raw/actual=${rawOverActual.toFixed(2)}  (chars/4)/prompt=${charsOver4Bias.toFixed(2)}  last calibration ratio=${est.lastCalibrationRatio.toFixed(2)}`);
    if (charsOver4Bias > 1.15) {
      console.log("    chars/4 overestimates prompt tokens.");
    } else if (charsOver4Bias < 0.85) {
      console.log("    chars/4 underestimates prompt tokens.");
    } else {
      console.log("    chars/4 is reasonably close to actual prompt tokens.");
    }
  }
  console.log("  old 4-concurrent / 200k-TPM counterfactual (same turn durations/tokens):");
  console.log(`    simulated wall ${ (old.wallMs / 1000).toFixed(1)}s  vs new ${(wallMs / 1000).toFixed(1)}s  speedup ${(old.wallMs / Math.max(1, wallMs)).toFixed(2)}x`);
  console.log(`  report: ${outPath}`);

  const tpmIsLimiter = (bottleneckCounts.get("tpm") ?? 0) > (bottleneckCounts.get("concurrency") ?? 0);
  const usedTier2 = peakInFlight > 8 && peakTpm > 250_000;
  console.log("\n=== Verdict ===");
  if (usedTier2 && tpmIsLimiter) {
    console.log("  Scheduler is using Tier 2 capacity. TPM is the limiter, not the 128 ceiling.");
  } else if (usedTier2) {
    console.log("  Scheduler ran well above old 4/200k caps. Limiter was not TPM-dominant this run (work may have been narrower than the 1M TPM budget on early turns).");
  } else {
    console.log("  Run did not clearly saturate Tier 2. Inspect samples/queuePeak.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
