import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

/**
 * Do not statically import `server/` or `src/` from this file. Vite treats
 * config-graph imports as restart triggers, which is what flooded the
 * terminal with the native configLoader warning on every src edit.
 */

function pathnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] ?? "";
  }
}

function isRunsApiPath(url: string | undefined): boolean {
  const pathname = pathnameOf(url);
  return pathname === "/api/runs" || pathname.startsWith("/api/runs/");
}

function isMarbleEvaluateApiPath(url: string | undefined): boolean {
  return pathnameOf(url) === "/api/marble-evaluate";
}

function isGenerateApiPath(url: string | undefined): boolean {
  const pathname = pathnameOf(url);
  return pathname === "/api/generate" || pathname === "/api/openai-scheduler";
}

type RunsApiModule = {
  safeHandleRunsApiRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    getApiKey: () => string | undefined,
  ) => Promise<void>;
};

type MarbleApiModule = {
  safeHandleMarbleEvaluateApiRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    apiKey: string | undefined,
  ) => Promise<void>;
};

type GenerateApiModule = {
  handleGenerateApiRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    apiKey: string | undefined,
  ) => Promise<void>;
};

type HandlerLoader = {
  loadRuns: () => Promise<RunsApiModule>;
  loadMarble: () => Promise<MarbleApiModule>;
  loadGenerate: () => Promise<GenerateApiModule>;
};

function sendProxyError(res: ServerResponse, error: unknown): void {
  const message =
    error instanceof Error ? error.message : "Unexpected proxy error.";
  if (!res.headersSent) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: message }));
  } else {
    res.end();
  }
}

function attachGenerateApi(
  server: ViteDevServer | PreviewServer,
  loader: HandlerLoader,
  getApiKey: () => string | undefined,
): void {
  server.middlewares.use((req, res, next) => {
    if (isRunsApiPath(req.url)) {
      void loader
        .loadRuns()
        .then((mod) => mod.safeHandleRunsApiRequest(req, res, getApiKey))
        .catch((error) => sendProxyError(res, error));
      return;
    }

    if (isMarbleEvaluateApiPath(req.url)) {
      void loader
        .loadMarble()
        .then((mod) =>
          mod.safeHandleMarbleEvaluateApiRequest(req, res, getApiKey()),
        )
        .catch((error) => sendProxyError(res, error));
      return;
    }

    if (!isGenerateApiPath(req.url)) {
      next();
      return;
    }

    void loader
      .loadGenerate()
      .then((mod) => mod.handleGenerateApiRequest(req, res, getApiKey()))
      .catch((error) => sendProxyError(res, error));
  });
}

function devLoader(server: ViteDevServer): HandlerLoader {
  const load = (id: string) =>
    server.ssrLoadModule(
      path.posix.join("/", id),
    ) as Promise<RunsApiModule & MarbleApiModule & GenerateApiModule>;
  return {
    loadRuns: () => load("server/runsApi.ts"),
    loadMarble: () => load("server/marbleEvaluateApi.ts"),
    loadGenerate: () => load("server/generateApi.ts"),
  };
}

function previewLoader(): HandlerLoader {
  const load = (file: string) =>
    import(pathToFileURL(path.resolve(process.cwd(), file)).href) as Promise<
      RunsApiModule & MarbleApiModule & GenerateApiModule
    >;
  return {
    loadRuns: () => load("server/runsApi.ts"),
    loadMarble: () => load("server/marbleEvaluateApi.ts"),
    loadGenerate: () => load("server/generateApi.ts"),
  };
}

/**
 * Local OpenAI proxy + server-owned experiment run API.
 * Browser never sees OPENAI_API_KEY; runs survive page reload.
 */
export function generateApiPlugin(getApiKey: () => string | undefined): Plugin {
  return {
    name: "generate-api",
    configureServer(server) {
      attachGenerateApi(server, devLoader(server), getApiKey);
    },
    configurePreviewServer(server) {
      attachGenerateApi(server, previewLoader(), getApiKey);
    },
  };
}
