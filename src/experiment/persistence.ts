/**
 * Browser persistence for run config, selection, and one-time legacy-run migration.
 *
 * Authoritative run storage is server `.data/runs.json` (see server/runPersistence).
 * Snapshot parsing lives in parsePersisted.ts.
 */
import type { ProblemCategory } from "../problems/types";
import { normalizeRunConfig } from "./configAccessors";
import {
  AVAILABLE_MODEL_IDS,
  DEFAULT_RUN_CONFIG,
  MAX_INTERACTION_TURNS,
  MIN_INTERACTION_TURNS,
} from "./defaults";
import { syncRunCostFields } from "./runCost";
import { VALID_CATEGORIES, clamp, parseRun } from "./parsePersisted";
import type {
  ExperimentRun,
  RunConfig,
} from "./types";

const RUN_CONFIG_KEY = "communication-policy:run-config";
const RUN_SETTINGS_OPEN_KEY = "communication-policy:run-settings-open";
const RUNS_KEY = "communication-policy:runs";
const SELECTION_KEY = "communication-policy:selection";
const EXPANDED_FOLDERS_KEY = "communication-policy:expanded-folders";

export function loadRunConfig(): RunConfig {
  try {
    const raw = localStorage.getItem(RUN_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_RUN_CONFIG };

    const parsed = JSON.parse(raw) as Partial<RunConfig> & { model?: string };
    const category = parsed.problemCategory;

    // Prefer registry allowlist for the *current* settings picker; unknown
    // historical IDs fall back to the default Terra model.
    const candidateRunModel =
      typeof parsed.runModel === "string"
        ? parsed.runModel
        : typeof parsed.model === "string"
          ? parsed.model
          : undefined;
    const runModel =
      candidateRunModel && AVAILABLE_MODEL_IDS.includes(candidateRunModel)
        ? candidateRunModel
        : DEFAULT_RUN_CONFIG.runModel;

    const candidateEvalModel =
      typeof parsed.evaluationModel === "string"
        ? parsed.evaluationModel
        : undefined;
    const evaluationModel =
      candidateEvalModel && AVAILABLE_MODEL_IDS.includes(candidateEvalModel)
        ? candidateEvalModel
        : DEFAULT_RUN_CONFIG.evaluationModel;

    return normalizeRunConfig(
      {
        ...parsed,
        problemCategory:
          typeof category === "string" &&
          VALID_CATEGORIES.has(category as ProblemCategory)
            ? (category as ProblemCategory)
            : DEFAULT_RUN_CONFIG.problemCategory,
        problemCount: clamp(Number(parsed.problemCount), 1, 150),
        runModel,
        evaluationModel,
        maxTurns: clamp(
          Number(parsed.maxTurns),
          MIN_INTERACTION_TURNS,
          MAX_INTERACTION_TURNS,
        ),
        temperature: clamp(Number(parsed.temperature), 0, 2),
      },
      DEFAULT_RUN_CONFIG,
    );
  } catch {
    return { ...DEFAULT_RUN_CONFIG };
  }
}

export function saveRunConfig(config: RunConfig): void {
  try {
    localStorage.setItem(RUN_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function loadRunSettingsOpen(): boolean {
  try {
    const raw = localStorage.getItem(RUN_SETTINGS_OPEN_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

export function saveRunSettingsOpen(open: boolean): void {
  try {
    localStorage.setItem(RUN_SETTINGS_OPEN_KEY, String(open));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export type PersistedSelection = {
  selectedRunId?: string;
  selectedProblemId?: string;
};

export function loadSelection(): PersistedSelection {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedSelection;
    return {
      selectedRunId:
        typeof parsed.selectedRunId === "string"
          ? parsed.selectedRunId
          : undefined,
      selectedProblemId:
        typeof parsed.selectedProblemId === "string"
          ? parsed.selectedProblemId
          : undefined,
    };
  } catch {
    return {};
  }
}

export function saveSelection(selection: PersistedSelection): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function loadExpandedFolderIds(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveExpandedFolderIds(ids: ReadonlySet<string> | string[]): void {
  try {
    localStorage.setItem(
      EXPANDED_FOLDERS_KEY,
      JSON.stringify([...ids]),
    );
  } catch {
    // Ignore quota / private-mode failures.
  }
}

const LEGACY_MIGRATED_KEY = "communication-policy:runs-migrated-to-server";

/**
 * One-time read of historical browser-local runs for server import.
 * No longer authoritative — server `.data/runs.json` owns execution state.
 */
export function loadLegacyRunsForMigration(): ExperimentRun[] {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY) === "true") return [];
    return loadRuns();
  } catch {
    return [];
  }
}

export function markLegacyRunsMigrated(): void {
  try {
    localStorage.setItem(LEGACY_MIGRATED_KEY, "true");
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/** @deprecated Prefer server `/api/runs`. Kept for one-time migration. */
export function loadRuns(): ExperimentRun[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseRun)
      .filter((r): r is ExperimentRun => Boolean(r))
      .map((run) => {
        // Re-derive totals from usage records so evaluation spend survives reload.
        syncRunCostFields(run);
        return run;
      });
  } catch {
    return [];
  }
}

/** @deprecated Runs are persisted on the server. */
export function saveRuns(_runs: ExperimentRun[]): void {
  // No-op: server RunManager is authoritative.
}
