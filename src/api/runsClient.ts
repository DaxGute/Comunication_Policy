import type { CommunicationPolicy } from "../communication/types";
import type { ExperimentRun, RunConfig } from "../experiment/types";
import type { ReasoningEffort } from "../models/modelRegistry";

async function parseJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Runs API returned non-JSON (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `Runs API error (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return payload as T;
}

export async function listRuns(): Promise<ExperimentRun[]> {
  const response = await fetch("/api/runs", { cache: "no-store" });
  const body = await parseJson<{ runs: ExperimentRun[] }>(response);
  return Array.isArray(body.runs) ? body.runs : [];
}

export async function getRun(runId: string): Promise<ExperimentRun> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  const body = await parseJson<{ run: ExperimentRun }>(response);
  return body.run;
}

export async function createRun(args: {
  policy: CommunicationPolicy;
  config: RunConfig;
  /** Client-generated id so the optimistic row matches the server record. */
  id?: string;
}): Promise<ExperimentRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await parseJson<{ run: ExperimentRun }>(response);
  return body.run;
}

export async function cancelRun(runId: string): Promise<ExperimentRun> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/cancel`,
    { method: "POST" },
  );
  const body = await parseJson<{ run: ExperimentRun }>(response);
  return body.run;
}

export async function deleteRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
  await parseJson<{ ok: boolean }>(response);
}

export async function renameRun(
  runId: string,
  title: string,
): Promise<ExperimentRun> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  const body = await parseJson<{ run: ExperimentRun }>(response);
  return body.run;
}

export async function renameProblem(
  runId: string,
  problemId: string,
  title: string,
): Promise<ExperimentRun> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/problems/${encodeURIComponent(problemId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  const body = await parseJson<{ run: ExperimentRun }>(response);
  return body.run;
}

export async function startEvaluation(args: {
  runId: string;
  problemId: string;
  evaluatorModel: string;
  evaluationReasoningEffort?: ReasoningEffort;
  retryFromId?: string;
  overrideExisting?: boolean;
}): Promise<{ evaluationId: string; run: ExperimentRun }> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(args.runId)}/evaluations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        problemId: args.problemId,
        evaluatorModel: args.evaluatorModel,
        evaluationReasoningEffort: args.evaluationReasoningEffort,
        retryFromId: args.retryFromId,
        overrideExisting: args.overrideExisting === true,
      }),
    },
  );
  return parseJson(response);
}

export async function startBatchEvaluation(args: {
  runId: string;
  evaluatorModel: string;
  evaluationReasoningEffort?: ReasoningEffort;
  overrideExisting?: boolean;
}): Promise<{ batchId: string; run: ExperimentRun }> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(args.runId)}/evaluations/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evaluatorModel: args.evaluatorModel,
        evaluationReasoningEffort: args.evaluationReasoningEffort,
        overrideExisting: args.overrideExisting === true,
      }),
    },
  );
  return parseJson(response);
}

export async function importRuns(
  runs: ExperimentRun[],
): Promise<{ imported: number }> {
  const response = await fetch("/api/runs/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runs }),
  });
  return parseJson(response);
}

export function runNeedsPolling(run: ExperimentRun): boolean {
  if (run.status === "queued" || run.status === "running") return true;
  return (run.multiAgentEvaluations ?? []).some(
    (e) => e.status === "running" || e.status === "pending",
  );
}
