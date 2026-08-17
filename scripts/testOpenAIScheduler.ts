/**
 * Offline checks for the shared OpenAI request scheduler.
 * Run: npm run test:openai-scheduler
 */
import assert from "node:assert/strict";
import {
  OpenAIRequestScheduler,
  estimateRequestTokens,
  parseDurationToMs,
} from "../server/openaiScheduler.ts";
import {
  getModelRateLimit,
  MODEL_RATE_LIMITS,
} from "../src/models/modelRegistry.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

assert.equal(parseDurationToMs("32ms"), 32);
assert.equal(parseDurationToMs("1.2s"), 1200);
assert.equal(parseDurationToMs("6m0s"), 360_000);
assert.equal(parseDurationToMs("1s"), 1000);
assert.ok((estimateRequestTokens([{ content: "abcd".repeat(100) }]) ?? 0) > 100);

assert.equal(getModelRateLimit("gpt-5.6-terra").tpm, 1_000_000);
assert.equal(getModelRateLimit("gpt-5.6-luna").tpm, 2_000_000);
assert.equal(getModelRateLimit("gpt-5.4-nano").tpm, 2_000_000);
assert.equal(MODEL_RATE_LIMITS["gpt-5.6-terra"]?.rpm, 5_000);
console.log("✓ rate-limit config and duration parsing");

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 2,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 2_000_000 }),
    log: () => {},
  });
  const first = await scheduler.acquire({ model: "m", estimate: 10 });
  const second = await scheduler.acquire({ model: "m", estimate: 10 });
  let thirdStarted = false;
  const thirdPromise = scheduler.acquire({ model: "m", estimate: 10 }).then(
    (lease) => {
      thirdStarted = true;
      return lease;
    },
  );
  await delay(30);
  assert.equal(thirdStarted, false);
  assert.equal(scheduler.snapshot().inFlight, 2);
  assert.equal(scheduler.snapshot().queued, 1);
  first.release({ completed: true, actualTokens: 10 });
  const third = await thirdPromise;
  assert.equal(thirdStarted, true);
  second.release({ completed: true, actualTokens: 10 });
  third.release({ completed: true, actualTokens: 10 });
  console.log("✓ worker-pool concurrency cap + queue");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 32,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 10_000 }),
    log: () => {},
  });
  const first = await scheduler.acquire({ model: "m", estimate: 8_000 });
  const controller = new AbortController();
  let secondStarted = false;
  const secondPromise = scheduler.acquire({
    model: "m",
    estimate: 8_000,
    signal: controller.signal,
  }).then((lease) => {
    secondStarted = true;
    return lease;
  });
  await delay(30);
  assert.equal(secondStarted, false, "TPM should block the second oversized job");
  first.release({ completed: true, actualTokens: 8_000 });
  // Window still contains 8k tokens, so the second job should remain queued.
  await delay(30);
  assert.equal(secondStarted, false);
  controller.abort();
  await assert.rejects(secondPromise, /abort/i);
  console.log("✓ TPM blocks launch even when RPM/concurrency remain");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 8,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 2_000_000 }),
    log: () => {},
  });
  const held = await scheduler.acquire({ model: "m", estimate: 10 });
  // Fill remaining slots so the aborting job stays queued.
  const extra = await Promise.all(
    Array.from({ length: 7 }, () =>
      scheduler.acquire({ model: "m", estimate: 10 }),
    ),
  );
  const controller = new AbortController();
  const queued = scheduler.acquire({
    model: "m",
    estimate: 10,
    signal: controller.signal,
  });
  await delay(10);
  assert.equal(scheduler.snapshot().queued, 1);
  controller.abort();
  await assert.rejects(queued, /abort/i);
  assert.equal(scheduler.snapshot().queued, 0);
  held.release({ completed: true, actualTokens: 10 });
  for (const lease of extra) lease.release({ completed: true, actualTokens: 10 });
  console.log("✓ queued work is cancelled without launching");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 4,
    margin: 1,
    getLimits: (model) =>
      model === "small"
        ? { rpm: 5_000, tpm: 2_000_000 }
        : { rpm: 5_000, tpm: 9_000 },
    log: () => {},
  });
  const big = await scheduler.acquire({ model: "big", estimate: 8_000 });
  const small = await scheduler.acquire({ model: "small", estimate: 100 });
  assert.equal(scheduler.snapshot().inFlight, 2);
  big.release({ completed: true, actualTokens: 8_000 });
  small.release({ completed: true, actualTokens: 100 });
  console.log("✓ independent models do not share a single TPM bucket");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 1,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 2_000_000 }),
    log: () => {},
  });
  const first = await scheduler.acquire({
    model: "m",
    estimate: 10,
    runId: "run-a",
  });
  const queued = scheduler.acquire({
    model: "m",
    estimate: 10,
    runId: "run-a",
  });
  await delay(10);
  const snap = scheduler.snapshotForRun("run-a");
  assert.equal(snap.peakConcurrency, 1);
  assert.equal(snap.queued, 1);
  first.release({ completed: true, actualTokens: 10 });
  const second = await queued;
  second.release({ completed: true, actualTokens: 10 });
  const done = scheduler.snapshotForRun("run-a");
  assert.equal(done.requestsCompleted, 2);
  assert.ok(done.peakConcurrency >= 1);
  console.log("✓ per-run diagnostics");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 8,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 10_000 }),
    log: () => {},
  });
  scheduler.bindSharedBucket(["a", "b"], "ab");
  const first = await scheduler.acquire({ model: "a", estimate: 8_000 });
  const abortB = new AbortController();
  let bStarted = false;
  const bPromise = scheduler.acquire({
    model: "b",
    estimate: 8_000,
    signal: abortB.signal,
  }).then((lease) => {
    bStarted = true;
    return lease;
  });
  await delay(30);
  assert.equal(bStarted, false, "shared TPM bucket should block the sibling model");
  const snap = scheduler.snapshot();
  assert.equal(snap.buckets?.ab?.shared, true);
  abortB.abort();
  await assert.rejects(bPromise, /abort/i);
  first.release({ completed: true, actualTokens: 8_000 });
  console.log("✓ shared rate-limit bucket accounts TPM across models");
}

{
  const scheduler = new OpenAIRequestScheduler({
    maxConcurrent: 8,
    margin: 1,
    getLimits: () => ({ rpm: 5_000, tpm: 10_000 }),
    log: () => {},
  });
  const held = await scheduler.acquire({ model: "m", estimate: 3_000 });
  const abortLarge = new AbortController();
  let largeStarted = false;
  const largePromise = scheduler.acquire({
    model: "m",
    estimate: 8_000,
    signal: abortLarge.signal,
  }).then((lease) => {
    largeStarted = true;
    return lease;
  });
  let smallStarted = false;
  const smallPromise = scheduler.acquire({ model: "m", estimate: 1_500 }).then(
    (lease) => {
      smallStarted = true;
      return lease;
    },
  );
  await delay(40);
  assert.equal(largeStarted, false, "large request should wait for TPM");
  assert.equal(smallStarted, true, "smaller request should bypass HOL");
  assert.ok((scheduler.snapshot().holBypasses ?? 0) >= 1);
  const small = await smallPromise;
  small.release({ completed: true, actualTokens: 1_500 });
  abortLarge.abort();
  await assert.rejects(largePromise, /abort/i);
  held.release({ completed: true, actualTokens: 3_000 });
  console.log("✓ short requests are not stuck behind oversized TPM jobs");
}

console.log("test:openai-scheduler OK");
