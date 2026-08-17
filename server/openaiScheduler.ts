/**
 * Process-wide OpenAI request scheduler (RPM + TPM + concurrency).
 *
 * Header parsing and token estimates live in openaiRateLimit.ts. Callers should
 * acquire a lease here so concurrent runs share one budget per model.
 */
import {
  RATE_LIMIT_SAFETY_MARGIN,
  getModelRateLimit,
  type ModelRateLimit,
} from "../src/models/modelRegistry.ts";
import type { OpenAIRuntimeDiagnostics } from "../src/experiment/types.ts";
import {
  estimateRequestTokens,
  extractRateLimitHeaders,
  parseDurationToMs,
  parseRetryAfterMs,
  type SchedulerHeaderSnapshot,
} from "./openaiRateLimit.ts";

export {
  estimateRequestTokens,
  extractRateLimitHeaders,
  parseDurationToMs,
  parseRetryAfterMs,
};
export type { SchedulerHeaderSnapshot };

const WINDOW_MS = 60_000;
const MIN_SATURATION = 0.2;
const LOG_INTERVAL_MS = 8_000;
/** Process-level socket safety ceiling — not the throughput target. */
const DEFAULT_MAX_CONCURRENT = 128;

export type SchedulerBottleneck = OpenAIRuntimeDiagnostics["bottleneck"];

export type SchedulerAcquireOptions = {
  model: string;
  estimate: number;
  signal?: AbortSignal;
  runId?: string;
};

export type SchedulerLease = {
  startedAt: number;
  release: (info?: SchedulerReleaseInfo) => void;
};

export type SchedulerReleaseInfo = {
  actualTokens?: number;
  promptTokens?: number;
  /** False when the request never completed (429, connection error). */
  completed?: boolean;
};


export type OpenAISchedulerOptions = {
  now?: () => number;
  margin?: number;
  maxConcurrent?: number;
  getLimits?: (model: string) => ModelRateLimit;
  log?: (line: string) => void;
};

type QueuedJob = {
  id: number;
  model: string;
  rawEstimate: number;
  estimate: number;
  runId?: string;
  signal?: AbortSignal;
  enqueuedAt: number;
  resolve: (lease: SchedulerLease) => void;
  reject: (error: Error) => void;
  abortHandler?: () => void;
};

type InFlightJob = {
  id: number;
  model: string;
  rawEstimate: number;
  estimate: number;
  runId?: string;
  startedAt: number;
};

type Stamp = { at: number; tokens: number };

export type EstimatorSample = {
  at: number;
  model: string;
  rawEstimate: number;
  calibratedEstimate: number;
  actualTotal: number;
  actualPrompt?: number;
};

type BucketState = {
  id: string;
  models: Set<string>;
  launches: Stamp[];
  tokens: Stamp[];
  cooldownUntil: number;
  saturation: number;
  headerLimitRpm?: number;
  headerLimitTpm?: number;
  headers?: {
    remainingRequests?: number;
    remainingTokens?: number;
    resetRequestsAt?: number;
    resetTokensAt?: number;
    capturedAt: number;
  };
  estimateRatio: number;
  inFlight: number;
};

type RunState = {
  inFlight: number;
  peak: number;
  queuedPeak: number;
  completed: number;
  retries: number;
  rateLimits: number;
};

export type OpenAISchedulerStats = OpenAIRuntimeDiagnostics & {
  globalInFlight: number;
  globalQueued: number;
  globalPeakConcurrency: number;
  peakRpm: number;
  peakTpm: number;
  holBypasses: number;
  buckets?: Record<
    string,
    {
      models: string[];
      inFlight: number;
      recentRpm: number;
      recentTpm: number;
      advertisedRpm: number;
      advertisedTpm: number;
      headerRpm?: number;
      headerTpm?: number;
      shared: boolean;
    }
  >;
  estimator?: {
    samples: number;
    meanRawEstimate: number;
    meanActualTotal: number;
    meanActualPrompt: number;
    meanRawOverActual: number;
    meanCharsOver4OverPrompt: number;
    lastCalibrationRatio: number;
    recent: EstimatorSample[];
  };
};

function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function envFloat(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Aborted");
}

/** Parse OpenAI reset / retry-after duration strings (`6m0s`, `1.2s`, `32ms`). */
export class OpenAIRequestScheduler {
  private nextId = 1;
  private readonly queue: QueuedJob[] = [];
  private readonly inFlight = new Map<number, InFlightJob>();
  private readonly buckets = new Map<string, BucketState>();
  private readonly modelToBucket = new Map<string, string>();
  private readonly runs = new Map<string, RunState>();
  private readonly estimatorSamples: EstimatorSample[] = [];
  private readonly now: () => number;
  private readonly margin: number;
  private readonly maxConcurrent: number;
  private readonly getLimits: (model: string) => ModelRateLimit;
  private readonly log: (line: string) => void;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private lastLogAt = 0;
  private lastBottleneck: SchedulerBottleneck = null;
  private completed = 0;
  private retries = 0;
  private rateLimits = 0;
  private peakConcurrency = 0;
  private queuedPeak = 0;
  private peakRpm = 0;
  private peakTpm = 0;
  private holBypasses = 0;

  constructor(options: OpenAISchedulerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.margin =
      options.margin ??
      envFloat("OPENAI_RATE_MARGIN", RATE_LIMIT_SAFETY_MARGIN, 0.5, 1);
    this.maxConcurrent =
      options.maxConcurrent ??
      envInt("OPENAI_MAX_CONCURRENT", DEFAULT_MAX_CONCURRENT, 1, 512);
    this.getLimits = options.getLimits ?? getModelRateLimit;
    this.log = options.log ?? ((line) => console.info(line));
  }

  /**
   * Bind model IDs that OpenAI reports as one rate-limit pool onto a single
   * scheduler bucket. A 429 / TPM window on one model then applies to all.
   */
  bindSharedBucket(models: string[], bucketId: string): void {
    const existing: BucketState[] = [];
    const seen = new Set<BucketState>();
    for (const model of models) {
      const state = this.buckets.get(this.modelToBucket.get(model) ?? model);
      if (state && !seen.has(state)) {
        seen.add(state);
        existing.push(state);
      }
    }
    for (const model of models) {
      this.modelToBucket.set(model, bucketId);
    }
    const target = this.bucketState(models[0] ?? bucketId);
    target.id = bucketId;
    this.buckets.set(bucketId, target);
    for (const model of models) target.models.add(model);
    for (const state of existing) {
      if (state === target) continue;
      target.launches.push(...state.launches);
      target.tokens.push(...state.tokens);
      target.cooldownUntil = Math.max(target.cooldownUntil, state.cooldownUntil);
      target.saturation = Math.min(target.saturation, state.saturation);
      target.inFlight += state.inFlight;
      if (state.headerLimitRpm != null) {
        target.headerLimitRpm = Math.min(
          target.headerLimitRpm ?? state.headerLimitRpm,
          state.headerLimitRpm,
        );
      }
      if (state.headerLimitTpm != null) {
        target.headerLimitTpm = Math.min(
          target.headerLimitTpm ?? state.headerLimitTpm,
          state.headerLimitTpm,
        );
      }
      this.buckets.delete(state.id);
    }
    target.launches.sort((a, b) => a.at - b.at);
    target.tokens.sort((a, b) => a.at - b.at);
    this.log(
      `[openai-scheduler] shared bucket ${bucketId}=[${models.join(", ")}]`,
    );
  }

  acquire(options: SchedulerAcquireOptions): Promise<SchedulerLease> {
    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(abortError(options.signal));
        return;
      }
      const job: QueuedJob = {
        id: this.nextId++,
        model: options.model,
        rawEstimate: options.estimate,
        estimate: this.calibratedEstimate(options.model, options.estimate),
        runId: options.runId,
        signal: options.signal,
        enqueuedAt: this.now(),
        resolve,
        reject,
      };
      if (options.signal) {
        job.abortHandler = () => {
          this.removeQueued(job.id);
          reject(abortError(options.signal));
          this.pump();
        };
        options.signal.addEventListener("abort", job.abortHandler, {
          once: true,
        });
      }
      this.queue.push(job);
      this.queuedPeak = Math.max(this.queuedPeak, this.queue.length);
      if (job.runId) {
        const run = this.runState(job.runId);
        run.queuedPeak = Math.max(run.queuedPeak, this.queuedForRun(job.runId));
      }
      this.pump();
    });
  }

  observeHeaders(
    model: string,
    headers: Headers | Record<string, string | undefined> | undefined,
  ): void {
    const snapshot = extractRateLimitHeaders(headers);
    if (
      snapshot.remainingRequests == null &&
      snapshot.remainingTokens == null &&
      snapshot.resetRequestsMs == null &&
      snapshot.resetTokensMs == null &&
      snapshot.limitRequests == null &&
      snapshot.limitTokens == null
    ) {
      return;
    }
    const state = this.bucketState(model);
    const now = this.now();
    if (snapshot.limitRequests != null) {
      state.headerLimitRpm = snapshot.limitRequests;
    }
    if (snapshot.limitTokens != null) {
      state.headerLimitTpm = snapshot.limitTokens;
    }
    state.headers = {
      remainingRequests: snapshot.remainingRequests,
      remainingTokens: snapshot.remainingTokens,
      resetRequestsAt:
        snapshot.resetRequestsMs != null
          ? now + snapshot.resetRequestsMs
          : state.headers?.resetRequestsAt,
      resetTokensAt:
        snapshot.resetTokensMs != null
          ? now + snapshot.resetTokensMs
          : state.headers?.resetTokensAt,
      capturedAt: now,
    };
    this.maybeMergeSharedBuckets(model, snapshot);
    if (
      (snapshot.remainingRequests != null && snapshot.remainingRequests <= 0) ||
      (snapshot.remainingTokens != null && snapshot.remainingTokens <= 0)
    ) {
      const wait =
        snapshot.retryAfterMs ??
        snapshot.resetTokensMs ??
        snapshot.resetRequestsMs ??
        250;
      state.cooldownUntil = Math.max(state.cooldownUntil, now + wait);
      this.lastBottleneck =
        snapshot.remainingTokens != null && snapshot.remainingTokens <= 0
          ? "tpm"
          : "rpm";
      this.scheduleWake(wait);
    }
  }

  noteRateLimit(model: string, waitMs: number): void {
    const state = this.bucketState(model);
    const wait = Math.max(50, waitMs);
    state.cooldownUntil = Math.max(state.cooldownUntil, this.now() + wait);
    state.saturation = Math.max(MIN_SATURATION, state.saturation * 0.55);
    this.rateLimits += 1;
    this.lastBottleneck = "cooldown";
    this.log(
      `[openai-scheduler] 429/rate-limit model=${model} cooldownMs=${Math.round(wait)} saturation=${state.saturation.toFixed(2)} inFlight=${this.inFlight.size} queued=${this.queue.length}`,
    );
    this.scheduleWake(wait);
  }

  noteRetry(runId?: string): void {
    this.retries += 1;
    if (runId) this.runState(runId).retries += 1;
  }

  noteRateLimitForRun(runId?: string): void {
    if (runId) this.runState(runId).rateLimits += 1;
  }

  snapshot(): OpenAISchedulerStats {
    return this.buildSnapshot();
  }

  snapshotForRun(runId: string): OpenAIRuntimeDiagnostics {
    const snap = this.buildSnapshot();
    const run = this.runs.get(runId);
    return {
      ...snap,
      inFlight: run?.inFlight ?? 0,
      queued: this.queuedForRun(runId),
      queuedPeak: run?.queuedPeak ?? 0,
      requestsCompleted: run?.completed ?? 0,
      retryCount: run?.retries ?? 0,
      rateLimitCount: run?.rateLimits ?? 0,
      peakConcurrency: run?.peak ?? 0,
    };
  }

  private buildSnapshot(): OpenAISchedulerStats {
    const now = this.now();
    const models: NonNullable<OpenAIRuntimeDiagnostics["models"]> = {};
    const buckets: NonNullable<OpenAISchedulerStats["buckets"]> = {};
    let recentRpm = 0;
    let recentTpm = 0;
    for (const [id, state] of this.buckets) {
      this.pruneBucket(state, now);
      const representative = [...state.models][0] ?? id;
      const advertised = this.advertisedLimits(representative, state);
      const rpm = state.launches.length;
      const tpm =
        state.tokens.reduce((sum, stamp) => sum + stamp.tokens, 0) +
        this.reservedTokens(representative);
      recentRpm += rpm;
      recentTpm += tpm;
      this.peakRpm = Math.max(this.peakRpm, rpm);
      this.peakTpm = Math.max(this.peakTpm, tpm);
      const shared = state.models.size > 1;
      buckets[id] = {
        models: [...state.models],
        inFlight: state.inFlight,
        recentRpm: rpm,
        recentTpm: tpm,
        advertisedRpm: advertised.rpm,
        advertisedTpm: advertised.tpm,
        headerRpm: state.headerLimitRpm,
        headerTpm: state.headerLimitTpm,
        shared,
      };
      for (const model of state.models) {
        models[model] = {
          inFlight: state.inFlight,
          recentRpm: rpm,
          recentTpm: tpm,
          advertisedRpm: advertised.rpm,
          advertisedTpm: advertised.tpm,
        };
      }
    }
    return {
      inFlight: this.inFlight.size,
      queued: this.queue.length,
      queuedPeak: this.queuedPeak,
      requestsCompleted: this.completed,
      retryCount: this.retries,
      rateLimitCount: this.rateLimits,
      peakConcurrency: this.peakConcurrency,
      approxRecentRpm: recentRpm,
      approxRecentTpm: recentTpm,
      bottleneck: this.lastBottleneck,
      models,
      globalInFlight: this.inFlight.size,
      globalQueued: this.queue.length,
      globalPeakConcurrency: this.peakConcurrency,
      peakRpm: this.peakRpm,
      peakTpm: this.peakTpm,
      holBypasses: this.holBypasses,
      buckets,
      estimator: this.estimatorSummary(),
    };
  }

  private pump(): void {
    let launched = 0;
    let blocked: SchedulerBottleneck = null;
    let skippedTpm = 0;
    for (const job of [...this.queue]) {
      const reason = this.launchBlockReason(job);
      if (reason) {
        blocked ??= reason;
        if (reason === "tpm") skippedTpm += 1;
        continue;
      }
      if (skippedTpm > 0) this.holBypasses += 1;
      this.launch(job);
      launched += 1;
    }
    if (blocked) this.lastBottleneck = blocked;
    else if (this.queue.length === 0 && this.inFlight.size === 0) {
      this.lastBottleneck = null;
    }

    if (launched === 0 && this.queue.length > 0) {
      this.scheduleWake(this.nextWaitMs());
    }
    this.maybeLog();
  }

  private launchBlockReason(job: QueuedJob): SchedulerBottleneck {
    if (job.signal?.aborted) return null;
    const now = this.now();
    if (this.inFlight.size >= this.maxConcurrent) return "concurrency";

    const state = this.bucketState(job.model);
    this.pruneBucket(state, now);
    if (state.cooldownUntil > now) return "cooldown";

    const limits = this.effectiveLimits(job.model);
    const rpmUsed = state.launches.length;
    if (rpmUsed + 1 > limits.rpm) return "rpm";

    const headers = state.headers;
    if (headers && now - headers.capturedAt < 5_000) {
      const inflightForModel = state.inFlight;
      if (
        headers.remainingRequests != null &&
        headers.remainingRequests - inflightForModel <= 0 &&
        (headers.resetRequestsAt ?? 0) > now
      ) {
        return "rpm";
      }
      if (
        headers.remainingTokens != null &&
        headers.remainingTokens - this.reservedTokens(job.model) < job.estimate &&
        (headers.resetTokensAt ?? 0) > now
      ) {
        return "tpm";
      }
    }

    const tpmUsed =
      state.tokens.reduce((sum, stamp) => sum + stamp.tokens, 0) +
      this.reservedTokens(job.model);
    if (tpmUsed + job.estimate > limits.tpm) {
      // Avoid deadlock for a single oversized request: allow it only when
      // this model is idle and the window is empty.
      if (state.inFlight === 0 && state.tokens.length === 0) return null;
      return "tpm";
    }
    return null;
  }

  private launch(job: QueuedJob): void {
    this.removeQueued(job.id, false);
    if (job.signal?.aborted) {
      job.reject(abortError(job.signal));
      return;
    }
    const startedAt = this.now();
    const inflight: InFlightJob = {
      id: job.id,
      model: job.model,
      rawEstimate: job.rawEstimate,
      estimate: job.estimate,
      runId: job.runId,
      startedAt,
    };
    this.inFlight.set(job.id, inflight);
    this.peakConcurrency = Math.max(this.peakConcurrency, this.inFlight.size);

    const state = this.bucketState(job.model);
    state.inFlight += 1;
    state.launches.push({ at: startedAt, tokens: 0 });

    if (job.runId) {
      const run = this.runState(job.runId);
      run.inFlight += 1;
      run.peak = Math.max(run.peak, run.inFlight);
    }

    const lease: SchedulerLease = {
      startedAt,
      release: (info) => this.release(job.id, info),
    };
    job.resolve(lease);
  }

  private release(id: number, info?: SchedulerReleaseInfo): void {
    const job = this.inFlight.get(id);
    if (!job) {
      this.pump();
      return;
    }
    this.inFlight.delete(id);
    const state = this.bucketState(job.model);
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (info?.completed !== false) {
      const actual = Math.max(1, info?.actualTokens ?? job.estimate);
      state.tokens.push({ at: job.startedAt, tokens: actual });
      this.completed += 1;
      const ratio = actual / Math.max(1, job.estimate);
      state.estimateRatio = clamp(
        state.estimateRatio * 0.8 + ratio * 0.2,
        0.5,
        2.5,
      );
      state.saturation = Math.min(1, state.saturation + 0.08);
      this.estimatorSamples.push({
        at: this.now(),
        model: job.model,
        rawEstimate: job.rawEstimate,
        calibratedEstimate: job.estimate,
        actualTotal: actual,
        actualPrompt: info?.promptTokens,
      });
      if (this.estimatorSamples.length > 400) this.estimatorSamples.shift();
      if (job.runId) this.runState(job.runId).completed += 1;
    }
    if (job.runId) {
      const run = this.runState(job.runId);
      run.inFlight = Math.max(0, run.inFlight - 1);
    }
    this.pump();
  }

  private removeQueued(id: number, unhookAbort = true): void {
    const index = this.queue.findIndex((job) => job.id === id);
    if (index < 0) return;
    const [job] = this.queue.splice(index, 1);
    if (unhookAbort && job?.signal && job.abortHandler) {
      job.signal.removeEventListener("abort", job.abortHandler);
    }
  }

  private nextWaitMs(): number {
    const now = this.now();
    let wait = 750;
    for (const state of this.buckets.values()) {
      if (state.cooldownUntil > now) {
        wait = Math.min(wait, state.cooldownUntil - now);
      }
      const oldestLaunch = state.launches[0];
      if (oldestLaunch) {
        wait = Math.min(wait, Math.max(25, oldestLaunch.at + WINDOW_MS - now));
      }
      const oldestToken = state.tokens[0];
      if (oldestToken) {
        wait = Math.min(wait, Math.max(25, oldestToken.at + WINDOW_MS - now));
      }
      if (state.headers?.resetTokensAt && state.headers.resetTokensAt > now) {
        wait = Math.min(wait, state.headers.resetTokensAt - now);
      }
      if (
        state.headers?.resetRequestsAt &&
        state.headers.resetRequestsAt > now
      ) {
        wait = Math.min(wait, state.headers.resetRequestsAt - now);
      }
    }
    return Math.max(25, Math.min(2_000, wait));
  }

  private scheduleWake(waitMs: number): void {
    if (this.wakeTimer) return;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined;
      this.pump();
    }, Math.max(25, waitMs));
  }

  private maybeLog(): void {
    const now = this.now();
    if (this.inFlight.size === 0 && this.queue.length === 0) return;
    if (now - this.lastLogAt < LOG_INTERVAL_MS) return;
    this.lastLogAt = now;
    const snap = this.buildSnapshot();
    const modelBits = Object.entries(snap.models ?? {})
      .filter(([, m]) => m.inFlight > 0 || m.recentRpm > 0)
      .map(
        ([id, m]) =>
          `${id}:inFlight=${m.inFlight} rpm~${m.recentRpm} tpm~${m.recentTpm}/${m.advertisedTpm}`,
      )
      .join(" ");
    this.log(
      `[openai-scheduler] inFlight=${snap.inFlight} queued=${snap.queued} completed=${snap.requestsCompleted} retries=${snap.retryCount} 429s=${snap.rateLimitCount} rpm~${snap.approxRecentRpm} tpm~${snap.approxRecentTpm} peak=${snap.peakConcurrency} bottleneck=${snap.bottleneck ?? "none"}${modelBits ? ` ${modelBits}` : ""}`,
    );
  }

  private effectiveLimits(model: string): ModelRateLimit {
    const state = this.bucketState(model);
    const advertised = this.advertisedLimits(model, state);
    const scale = this.margin * state.saturation;
    return {
      rpm: Math.max(1, Math.floor(advertised.rpm * scale)),
      tpm: Math.max(1_000, Math.floor(advertised.tpm * scale)),
    };
  }

  private advertisedLimits(model: string, state: BucketState): ModelRateLimit {
    const registry = this.getLimits(model);
    return {
      rpm: state.headerLimitRpm ?? registry.rpm,
      tpm: state.headerLimitTpm ?? registry.tpm,
    };
  }

  private calibratedEstimate(model: string, estimate: number): number {
    const ratio = this.bucketState(model).estimateRatio;
    return Math.max(1, Math.ceil(estimate * ratio));
  }

  private reservedTokens(model: string): number {
    const bucket = this.bucketId(model);
    let sum = 0;
    for (const job of this.inFlight.values()) {
      if (this.bucketId(job.model) === bucket) sum += job.estimate;
    }
    return sum;
  }

  private queuedForRun(runId: string): number {
    return this.queue.filter((job) => job.runId === runId).length;
  }

  private bucketId(model: string): string {
    return this.modelToBucket.get(model) ?? model;
  }

  private bucketState(model: string): BucketState {
    const id = this.bucketId(model);
    let state = this.buckets.get(id);
    if (!state) {
      state = {
        id,
        models: new Set([model]),
        launches: [],
        tokens: [],
        cooldownUntil: 0,
        saturation: 1,
        estimateRatio: 1,
        inFlight: 0,
      };
      this.buckets.set(id, state);
    } else {
      state.models.add(model);
    }
    return state;
  }

  private maybeMergeSharedBuckets(
    model: string,
    snapshot: SchedulerHeaderSnapshot,
  ): void {
    if (snapshot.limitTokens == null || snapshot.remainingTokens == null) {
      return;
    }
    // Idle pools sitting at the same advertised cap are not evidence of sharing.
    if (snapshot.limitTokens - snapshot.remainingTokens < 20_000) return;
    const now = this.now();
    const selfId = this.bucketId(model);
    for (const [id, other] of this.buckets) {
      if (id === selfId) continue;
      if (!other.headers || now - other.headers.capturedAt > 4_000) continue;
      if (other.headerLimitTpm !== snapshot.limitTokens) continue;
      if (
        snapshot.limitRequests != null &&
        other.headerLimitRpm != null &&
        other.headerLimitRpm !== snapshot.limitRequests
      ) {
        continue;
      }
      if (other.headers.remainingTokens == null) continue;
      if (
        Math.abs(other.headers.remainingTokens - snapshot.remainingTokens) >
        8_000
      ) {
        continue;
      }
      const models = [...new Set([...other.models, model])];
      this.bindSharedBucket(models, `shared:${[...models].sort().join("+")}`);
      return;
    }
  }

  private estimatorSummary(): NonNullable<OpenAISchedulerStats["estimator"]> {
    const samples = this.estimatorSamples;
    const n = samples.length;
    const mean = (pick: (s: EstimatorSample) => number | undefined) => {
      const vals = samples
        .map(pick)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (vals.length === 0) return 0;
      return vals.reduce((sum, v) => sum + v, 0) / vals.length;
    };
    const last = samples[samples.length - 1];
    return {
      samples: n,
      meanRawEstimate: mean((s) => s.rawEstimate),
      meanActualTotal: mean((s) => s.actualTotal),
      meanActualPrompt: mean((s) => s.actualPrompt),
      meanRawOverActual: mean((s) =>
        s.actualTotal > 0 ? s.rawEstimate / s.actualTotal : undefined,
      ),
      meanCharsOver4OverPrompt: mean((s) => {
        if (!s.actualPrompt || s.actualPrompt <= 0) return undefined;
        const charsOver4 = Math.max(1, s.rawEstimate - 1_200);
        return charsOver4 / s.actualPrompt;
      }),
      lastCalibrationRatio: last
        ? last.actualTotal / Math.max(1, last.calibratedEstimate)
        : 1,
      recent: samples.slice(-12),
    };
  }

  private runState(runId: string): RunState {
    let state = this.runs.get(runId);
    if (!state) {
      state = {
        inFlight: 0,
        peak: 0,
        queuedPeak: 0,
        completed: 0,
        retries: 0,
        rateLimits: 0,
      };
      this.runs.set(runId, state);
    }
    return state;
  }

  private pruneBucket(state: BucketState, now: number): void {
    const cutoff = now - WINDOW_MS;
    while (state.launches.length > 0 && state.launches[0]!.at < cutoff) {
      state.launches.shift();
    }
    while (state.tokens.length > 0 && state.tokens[0]!.at < cutoff) {
      state.tokens.shift();
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

let singleton: OpenAIRequestScheduler | undefined;

export function getOpenAIScheduler(): OpenAIRequestScheduler {
  if (!singleton) singleton = new OpenAIRequestScheduler();
  return singleton;
}

export async function withOpenAIScheduler<T>(
  options: SchedulerAcquireOptions,
  fn: () => Promise<T>,
  actualTokens?: (result: T) => number | undefined,
): Promise<T> {
  const scheduler = getOpenAIScheduler();
  const lease = await scheduler.acquire(options);
  try {
    const result = await fn();
    lease.release({
      completed: true,
      actualTokens: actualTokens?.(result) ?? options.estimate,
    });
    return result;
  } catch (error) {
    lease.release({ completed: false });
    throw error;
  }
}
