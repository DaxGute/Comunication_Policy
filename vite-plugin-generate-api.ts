import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "./server/generateApi.ts";
import {
  isMarbleEvaluateApiPath,
  safeHandleMarbleEvaluateApiRequest,
} from "./server/marbleEvaluateApi.ts";

function attachGenerateApi(
  server: ViteDevServer | PreviewServer,
  getApiKey: () => string | undefined,
): void {
  server.middlewares.use((req, res, next) => {
    if (isMarbleEvaluateApiPath(req.url)) {
      void safeHandleMarbleEvaluateApiRequest(req, res, getApiKey());
      return;
    }

    if (!isGenerateApiPath(req.url)) {
      next();
      return;
    }

    void handleGenerateApiRequest(req, res, getApiKey()).catch((error) => {
      const message =
        error instanceof Error ? error.message : "Unexpected proxy error.";
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: message }));
      } else {
        res.end();
      }
    });
  });
}

/**
 * Local OpenAI proxy so the browser never sees OPENAI_API_KEY.
 */
export function generateApiPlugin(getApiKey: () => string | undefined): Plugin {
  return {
    name: "generate-api",
    configureServer(server) {
      attachGenerateApi(server, getApiKey);
    },
    configurePreviewServer(server) {
      attachGenerateApi(server, getApiKey);
    },
  };
}
