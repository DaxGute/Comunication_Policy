import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExperimentRun } from "../src/experiment/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, ".data");
const RUNS_PATH = path.join(DATA_DIR, "runs.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

const FLUSH_DEBOUNCE_MS = 250;

/**
 * File-backed run store. Authoritative for run/problem state across browser
 * reloads. Process-local until a worker/queue is added later.
 *
 * Live GET /api/runs reads in-memory cache (plus RunManager.live). Disk writes
 * are coalesced so turn-by-turn snapshots cannot block poll responses.
 */
export class RunPersistence {
  private cache: Map<string, ExperimentRun> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  private loadAll(): Map<string, ExperimentRun> {
    if (this.cache) return this.cache;
    ensureDataDir();
    const map = new Map<string, ExperimentRun>();
    if (!existsSync(RUNS_PATH)) {
      this.cache = map;
      return map;
    }
    try {
      const raw = readFileSync(RUNS_PATH, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object" && typeof (item as ExperimentRun).id === "string") {
            map.set((item as ExperimentRun).id, item as ExperimentRun);
          }
        }
      }
    } catch {
      // Corrupt file — start empty; do not wipe disk until a successful write.
    }
    this.cache = map;
    return map;
  }

  private flush(): void {
    ensureDataDir();
    const runs = [...this.loadAll().values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const tmp = `${RUNS_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(runs, null, 2), "utf8");
    renameSync(tmp, RUNS_PATH);
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, FLUSH_DEBOUNCE_MS);
  }

  private flushNow(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
  }

  list(): ExperimentRun[] {
    return [...this.loadAll().values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(runId: string): ExperimentRun | undefined {
    return this.loadAll().get(runId);
  }

  /** Replace the full run record (callers must mutate carefully). */
  save(run: ExperimentRun, options?: { immediate?: boolean }): void {
    const map = this.loadAll();
    // Store a structured clone so concurrent in-memory handles stay independent
    // of accidental shared references from HTTP serialization.
    const clone = structuredClone(run) as ExperimentRun;
    map.set(run.id, clone);
    if (options?.immediate) this.flushNow();
    else this.scheduleFlush();
  }

  /**
   * Apply a mutator to the latest persisted run and write back.
   * Returns the updated clone, or undefined if missing.
   */
  update(
    runId: string,
    mutator: (run: ExperimentRun) => void,
  ): ExperimentRun | undefined {
    const map = this.loadAll();
    const current = map.get(runId);
    if (!current) return undefined;
    const next = structuredClone(current) as ExperimentRun;
    mutator(next);
    map.set(runId, next);
    this.flushNow();
    return next;
  }

  delete(runId: string): boolean {
    const map = this.loadAll();
    const existed = map.delete(runId);
    if (existed) this.flushNow();
    return existed;
  }

  /** Replace cache after importing historical browser runs. */
  importMany(runs: ExperimentRun[]): void {
    const map = this.loadAll();
    for (const run of runs) {
      if (!run?.id) continue;
      map.set(run.id, structuredClone(run) as ExperimentRun);
    }
    this.flushNow();
  }
}
