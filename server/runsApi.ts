import type { IncomingMessage, ServerResponse } from "node:http";
import { createCommunicationPolicy } from "../src/communication/policy.ts";
import type { CommunicationPolicy } from "../src/communication/types.ts";
import { normalizeRunConfig } from "../src/experiment/configAccessors.ts";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults.ts";
import type { ExperimentRun, RunConfig } from "../src/experiment/types.ts";
import type { ReasoningEffort } from "../src/models/modelRegistry.ts";
import { getRunManager, RunsApiError } from "./runManager.ts";

function pathnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "";
  }
}

export function isRunsApiPath(url: string | undefined): boolean {
  const pathname = pathnameOf(url);
  return pathname === "/api/runs" || pathname.startsWith("/api/runs/");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new RunsApiError(400, "Request body is not valid JSON.");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function parsePolicy(raw: unknown): CommunicationPolicy {
  if (!raw || typeof raw !== "object") {
    throw new RunsApiError(400, 'Field "policy" must be an object.');
  }
  return createCommunicationPolicy(raw as Partial<CommunicationPolicy>);
}

function parseConfig(raw: unknown): RunConfig {
  if (!raw || typeof raw !== "object") {
    throw new RunsApiError(400, 'Field "config" must be an object.');
  }
  return normalizeRunConfig(raw as Partial<RunConfig>, DEFAULT_RUN_CONFIG);
}

type RouteMatch =
  | { kind: "collection" }
  | { kind: "import" }
  | { kind: "item"; runId: string }
  | { kind: "cancel"; runId: string }
  | { kind: "evaluations"; runId: string }
  | { kind: "evaluationsBatch"; runId: string }
  | { kind: "renameProblem"; runId: string; problemId: string };

function matchRoute(pathname: string): RouteMatch | null {
  if (pathname === "/api/runs") return { kind: "collection" };
  if (pathname === "/api/runs/import") return { kind: "import" };

  const evalBatch = pathname.match(/^\/api\/runs\/([^/]+)\/evaluations\/batch$/);
  if (evalBatch) return { kind: "evaluationsBatch", runId: decodeURIComponent(evalBatch[1]!) };

  const evaluations = pathname.match(/^\/api\/runs\/([^/]+)\/evaluations$/);
  if (evaluations) return { kind: "evaluations", runId: decodeURIComponent(evaluations[1]!) };

  const cancel = pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/);
  if (cancel) return { kind: "cancel", runId: decodeURIComponent(cancel[1]!) };

  const renameProblem = pathname.match(
    /^\/api\/runs\/([^/]+)\/problems\/([^/]+)$/,
  );
  if (renameProblem) {
    return {
      kind: "renameProblem",
      runId: decodeURIComponent(renameProblem[1]!),
      problemId: decodeURIComponent(renameProblem[2]!),
    };
  }

  const item = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (item) return { kind: "item", runId: decodeURIComponent(item[1]!) };

  return null;
}

/**
 * Connect/Vite middleware handler for /api/runs*.
 */
export async function handleRunsApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getApiKey: () => string | undefined,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PATCH, DELETE, OPTIONS",
    );
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  const pathname = pathnameOf(req.url);
  const route = matchRoute(pathname);
  if (!route) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const manager = getRunManager(getApiKey);

  try {
    if (route.kind === "collection" && req.method === "GET") {
      sendJson(res, 200, { runs: manager.listRuns() });
      return;
    }

    if (route.kind === "collection" && req.method === "POST") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const policy = parsePolicy(body.policy);
      const config = parseConfig(body.config);
      const run = manager.createRun({ policy, config });
      sendJson(res, 202, { runId: run.id, status: run.status, run });
      return;
    }

    if (route.kind === "import" && req.method === "POST") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const runs = Array.isArray(body.runs) ? (body.runs as ExperimentRun[]) : [];
      const result = manager.importRuns(runs);
      sendJson(res, 200, result);
      return;
    }

    if (route.kind === "item" && req.method === "GET") {
      const run = manager.getRun(route.runId);
      if (!run) {
        sendJson(res, 404, { error: `Run "${route.runId}" not found.` });
        return;
      }
      sendJson(res, 200, { run });
      return;
    }

    if (route.kind === "item" && req.method === "PATCH") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      if (typeof body.title === "string") {
        const run = manager.renameRun(route.runId, body.title);
        if (!run) {
          sendJson(res, 404, { error: `Run "${route.runId}" not found.` });
          return;
        }
        sendJson(res, 200, { run });
        return;
      }
      sendJson(res, 400, { error: 'PATCH requires a "title" string.' });
      return;
    }

    if (route.kind === "item" && req.method === "DELETE") {
      const ok = manager.deleteRun(route.runId);
      if (!ok) {
        sendJson(res, 404, { error: `Run "${route.runId}" not found.` });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (route.kind === "cancel" && req.method === "POST") {
      const run = manager.cancelRun(route.runId);
      if (!run) {
        sendJson(res, 404, { error: `Run "${route.runId}" not found.` });
        return;
      }
      sendJson(res, 200, { run });
      return;
    }

    if (route.kind === "renameProblem" && req.method === "PATCH") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      if (typeof body.title !== "string") {
        sendJson(res, 400, { error: 'PATCH requires a "title" string.' });
        return;
      }
      const run = manager.renameProblem(route.runId, route.problemId, body.title);
      if (!run) {
        sendJson(res, 404, { error: `Run "${route.runId}" not found.` });
        return;
      }
      sendJson(res, 200, { run });
      return;
    }

    if (route.kind === "evaluations" && req.method === "POST") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      if (typeof body.problemId !== "string" || typeof body.evaluatorModel !== "string") {
        sendJson(res, 400, {
          error: 'Fields "problemId" and "evaluatorModel" are required.',
        });
        return;
      }
      const result = manager.startEvaluation({
        runId: route.runId,
        problemId: body.problemId,
        evaluatorModel: body.evaluatorModel,
        evaluationReasoningEffort:
          typeof body.evaluationReasoningEffort === "string"
            ? (body.evaluationReasoningEffort as ReasoningEffort)
            : undefined,
        retryFromId:
          typeof body.retryFromId === "string" ? body.retryFromId : undefined,
      });
      sendJson(res, 202, result);
      return;
    }

    if (route.kind === "evaluationsBatch" && req.method === "POST") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      if (typeof body.evaluatorModel !== "string") {
        sendJson(res, 400, { error: 'Field "evaluatorModel" is required.' });
        return;
      }
      const result = manager.startBatchEvaluation({
        runId: route.runId,
        evaluatorModel: body.evaluatorModel,
        evaluationReasoningEffort:
          typeof body.evaluationReasoningEffort === "string"
            ? (body.evaluationReasoningEffort as ReasoningEffort)
            : undefined,
      });
      sendJson(res, 202, result);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    if (error instanceof RunsApiError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    throw error;
  }
}

export async function safeHandleRunsApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getApiKey: () => string | undefined,
): Promise<void> {
  try {
    await handleRunsApiRequest(req, res, getApiKey);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected runs API error.";
    if (!res.headersSent) {
      sendJson(res, 500, { error: message });
    } else {
      res.end();
    }
  }
}
