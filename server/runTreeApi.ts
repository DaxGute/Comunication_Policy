import type { IncomingMessage, ServerResponse } from "node:http";
import { parseRunTree, reconcileRunTree, sameRunTree } from "../src/experiment/runTree.ts";
import { getRunManager, RunsApiError } from "./runManager.ts";
import { getRunTreePersistence } from "./runTreePersistence.ts";

function pathnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "";
  }
}

export function isRunTreeApiPath(url: string | undefined): boolean {
  const pathname = pathnameOf(url);
  return pathname === "/api/run-tree" || pathname.startsWith("/api/run-tree/");
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

function reconciledTree(getApiKey: () => string | undefined) {
  const persistence = getRunTreePersistence();
  const current = persistence.load();
  const runIds = getRunManager(getApiKey)
    .listRuns()
    .map((run) => run.id);
  const next = reconcileRunTree(current, runIds);
  if (!sameRunTree(current, next)) persistence.save(next);
  return next;
}

export async function handleRunTreeApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getApiKey: () => string | undefined,
): Promise<void> {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  const pathname = pathnameOf(req.url);
  if (pathname !== "/api/run-tree") {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  try {
    if (req.method === "GET") {
      sendJson(res, 200, { tree: reconciledTree(getApiKey) });
      return;
    }

    if (req.method === "PUT") {
      const body = (await readJsonBody(req)) as Record<string, unknown>;
      const parsed = parseRunTree(body.tree ?? body);
      const runIds = getRunManager(getApiKey)
        .listRuns()
        .map((run) => run.id);
      const tree = reconcileRunTree(parsed, runIds);
      getRunTreePersistence().save(tree);
      sendJson(res, 200, { tree });
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

export async function safeHandleRunTreeApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  getApiKey: () => string | undefined,
): Promise<void> {
  try {
    await handleRunTreeApiRequest(req, res, getApiKey);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected run-tree API error.";
    if (!res.headersSent) {
      sendJson(res, 500, { error: message });
    } else {
      res.end();
    }
  }
}
