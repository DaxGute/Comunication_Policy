import type { ExperimentRun } from "./types";

/** Prefer finishedAt; else last message time; else createdAt. */
function runFinishIso(run: ExperimentRun): string {
  if (run.finishedAt) return run.finishedAt;
  let latest: string | undefined;
  for (const conversation of run.conversations) {
    for (const message of conversation.messages) {
      if (message.timestamp && (!latest || message.timestamp > latest)) {
        latest = message.timestamp;
      }
    }
  }
  return latest ?? run.createdAt;
}

export function displayRunTitle(run: ExperimentRun): string {
  const custom = run.title?.trim();
  if (custom) return custom;
  return new Date(runFinishIso(run)).toLocaleString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
