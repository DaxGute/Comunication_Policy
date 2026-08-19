/**
 * In-memory overlays so user actions render immediately while server
 * snapshots catch up. Persistence remains a side effect; polls must not
 * resurrect deleted runs or restore a cancelled run as active.
 */
import type { ExperimentRun } from "./types";

export type PendingLocalRuns = {
  /** Runs created locally that the latest server list may not include yet. */
  optimisticById: Map<string, ExperimentRun>;
  /** Tombstones: polls/merges must not re-insert these. */
  deletedIds: Set<string>;
  /** Until the server reports a terminal status, keep showing cancelled. */
  cancelledIds: Set<string>;
};

export function createPendingLocalRuns(): PendingLocalRuns {
  return {
    optimisticById: new Map(),
    deletedIds: new Set(),
    cancelledIds: new Set(),
  };
}

export function pendingNeedsPolling(pending: PendingLocalRuns): boolean {
  return pending.optimisticById.size > 0 || pending.cancelledIds.size > 0;
}

export function applyLocalCancel(run: ExperimentRun): ExperimentRun {
  if (run.status !== "queued" && run.status !== "running") {
    return {
      ...run,
      progress: undefined,
    };
  }
  return {
    ...run,
    status: "cancelled",
    progress: undefined,
    finishedAt: run.finishedAt ?? new Date().toISOString(),
    conversations: run.conversations.map((conversation) => {
      if (conversation.status !== "running") return conversation;
      return {
        ...conversation,
        status: undefined,
        speakingAgentId: undefined,
        stoppedReason:
          conversation.stoppedReason === "error"
            ? conversation.stoppedReason
            : "cancelled",
      };
    }),
  };
}

function overlayCancel(
  run: ExperimentRun,
  cancelledIds: ReadonlySet<string>,
): ExperimentRun {
  if (!cancelledIds.has(run.id)) return run;
  return applyLocalCancel(run);
}

/** Drop overlays the server snapshot has already confirmed. */
export function prunePendingAgainstServer(
  pending: PendingLocalRuns,
  serverRuns: ExperimentRun[],
): void {
  const serverById = new Map(serverRuns.map((run) => [run.id, run]));
  for (const id of [...pending.optimisticById.keys()]) {
    if (serverById.has(id)) pending.optimisticById.delete(id);
  }
  for (const id of [...pending.deletedIds]) {
    if (!serverById.has(id)) pending.deletedIds.delete(id);
  }
  for (const id of [...pending.cancelledIds]) {
    const server = serverById.get(id);
    if (!server || (server.status !== "queued" && server.status !== "running")) {
      pending.cancelledIds.delete(id);
    }
  }
}

/**
 * Merge a server (or mergeRun) snapshot with local optimistic/delete/cancel
 * overlays. Pure given `pending`; callers prune separately so React updaters
 * stay side-effect free.
 */
export function mergeIncomingRuns(
  incoming: ExperimentRun[],
  pending: PendingLocalRuns,
): ExperimentRun[] {
  if (
    pending.deletedIds.size === 0 &&
    pending.cancelledIds.size === 0 &&
    pending.optimisticById.size === 0
  ) {
    return incoming;
  }

  const incomingFiltered: ExperimentRun[] = [];
  const incomingIds = new Set<string>();
  for (const run of incoming) {
    if (pending.deletedIds.has(run.id)) continue;
    incomingIds.add(run.id);
    incomingFiltered.push(overlayCancel(run, pending.cancelledIds));
  }

  const extras: ExperimentRun[] = [];
  for (const run of pending.optimisticById.values()) {
    if (pending.deletedIds.has(run.id) || incomingIds.has(run.id)) continue;
    extras.unshift(overlayCancel(run, pending.cancelledIds));
  }
  return extras.length === 0 ? incomingFiltered : [...extras, ...incomingFiltered];
}
