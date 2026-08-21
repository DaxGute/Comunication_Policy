/**
 * Live run-status merge: stale snapshots must not drop queued/running rows.
 *
 * Run: npx vite-node scripts/testLiveRunStatus.ts
 */
import assert from "node:assert/strict";
import {
  createPendingLocalRuns,
  mergeIncomingRuns,
  prunePendingAgainstServer,
  retainInFlightRuns,
} from "../src/experiment/localRunState";
import { createQueuedRun } from "../src/experiment/queuedRun";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults";
import { createCommunicationPolicy } from "../src/communication/policy";

const policy = createCommunicationPolicy({});
const config = { ...DEFAULT_RUN_CONFIG };

const queued = createQueuedRun({
  id: "run_abc123_def456",
  policy,
  config,
});

const running = {
  ...queued,
  status: "running" as const,
  startedAt: queued.createdAt,
};

const completed = {
  ...running,
  status: "completed" as const,
  finishedAt: queued.createdAt,
  progress: undefined,
};

assert.deepEqual(
  retainInFlightRuns([queued], []),
  [queued],
  "stale empty poll must keep a local queued run",
);

assert.deepEqual(
  retainInFlightRuns([running], [completed]),
  [completed],
  "server-complete snapshot replaces the local in-flight row",
);

const pending = createPendingLocalRuns();
pending.optimisticById.set(queued.id, queued);
const withoutNewRun = [{ ...completed, id: "run_oldold_zzzzzz" }];
const merged = mergeIncomingRuns(withoutNewRun, pending);
assert.equal(merged[0]?.id, queued.id, "optimistic create survives a stale list");

prunePendingAgainstServer(pending, [running, withoutNewRun[0]!]);
assert.equal(pending.optimisticById.size, 0, "optimistic overlay drops once the server has the id");
const confirmed = mergeIncomingRuns([running, withoutNewRun[0]!], pending);
assert.equal(confirmed[0]?.status, "running");

console.log("✓ live run status merge keeps queued/running until the server snapshot catches up");
