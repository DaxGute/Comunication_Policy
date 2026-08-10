import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isOpenAIModel, supportedOpenAIModelList } from "../src/runtime/models.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT_PATH = path.join(REPO_ROOT, "scripts/marble/posthoc_evaluate.py");

export function isMarbleEvaluateApiPath(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const pathname = new URL(url, "http://localhost").pathname;
    return pathname === "/api/marble-evaluate";
  } catch {
    return false;
  }
}

class MarbleApiHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function resolveMarbleRoot(): string | undefined {
  if (process.env.MARBLE_ROOT?.trim()) {
    return path.resolve(process.env.MARBLE_ROOT.trim());
  }
  const candidates = [
    path.join(REPO_ROOT, "deps/MARBLE"),
    path.join(REPO_ROOT, "../Summer_CESTA/deps/MARBLE"),
    path.join(homedir(), "Desktop/Summer_CESTA/deps/MARBLE"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "marble/evaluator/evaluator.py"))) {
      return candidate;
    }
  }
  return undefined;
}

function resolveMarblePython(marbleRoot: string | undefined): string {
  if (process.env.MARBLE_PYTHON?.trim()) {
    return process.env.MARBLE_PYTHON.trim();
  }
  const candidates = [
    path.join(REPO_ROOT, "../Summer_CESTA/.venv-marble/bin/python"),
    path.join(homedir(), "Desktop/Summer_CESTA/.venv-marble/bin/python"),
    marbleRoot
      ? path.join(marbleRoot, ".venv/bin/python")
      : undefined,
    "python3",
  ].filter((x): x is string => Boolean(x));
  for (const candidate of candidates) {
    if (candidate === "python3" || existsSync(candidate)) return candidate;
  }
  return "python3";
}

function runPosthoc(payload: unknown, apiKey: string | undefined): Promise<{
  ok: boolean;
  body: Record<string, unknown>;
  status: number;
}> {
  return new Promise((resolve) => {
    const marbleRoot = resolveMarbleRoot();
    if (!marbleRoot) {
      resolve({
        ok: false,
        status: 503,
        body: {
          ok: false,
          error:
            "MARBLE checkout not found. Set MARBLE_ROOT to a clone of https://github.com/ulab-uiuc/MARBLE (expected commit 8d60fa17…), e.g. Summer_CESTA/deps/MARBLE.",
        },
      });
      return;
    }
    if (!existsSync(SCRIPT_PATH)) {
      resolve({
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: `Missing post-hoc script at ${SCRIPT_PATH}`,
        },
      });
      return;
    }

    const python = resolveMarblePython(marbleRoot);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MARBLE_ROOT: marbleRoot,
      MARBLE_COMMIT: "8d60fa17b5596b44458a52d4296061b9fc13d6f2",
      PYTHONUNBUFFERED: "1",
    };
    if (apiKey && !env.OPENAI_API_KEY) {
      env.OPENAI_API_KEY = apiKey;
    }

    const child = spawn(python, [SCRIPT_PATH, "--input", "-"], {
      cwd: marbleRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      resolve({
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: `Failed to start MARBLE python (${python}): ${error.message}`,
        },
      });
    });

    child.on("close", (code) => {
      const text = stdout.trim() || stderr.trim();
      let parsed: Record<string, unknown> | undefined;
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
          parsed = JSON.parse(text.slice(start, end + 1)) as Record<
            string,
            unknown
          >;
        }
      } catch {
        parsed = undefined;
      }

      if (!parsed) {
        resolve({
          ok: false,
          status: 500,
          body: {
            ok: false,
            error: `MARBLE post-hoc returned non-JSON (exit ${code}): ${text.slice(-2000)}`,
          },
        });
        return;
      }

      if (parsed.ok === false || code !== 0) {
        resolve({
          ok: false,
          status: 502,
          body: {
            ok: false,
            error:
              typeof parsed.error === "string"
                ? parsed.error
                : `MARBLE post-hoc failed (exit ${code})`,
            raw: parsed,
            stderr: stderr.slice(-2000),
          },
        });
        return;
      }

      resolve({ ok: true, status: 200, body: parsed });
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function handleMarbleEvaluateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
): Promise<void> {
  if (req.method !== "POST") {
    throw new MarbleApiHttpError(405, "POST required.");
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    throw new MarbleApiHttpError(400, "Request body must be a JSON object.");
  }

  const raw = body as Record<string, unknown>;
  const evaluatorModel =
    typeof raw.evaluatorModel === "string" ? raw.evaluatorModel : "";
  if (!evaluatorModel) {
    throw new MarbleApiHttpError(400, 'Field "evaluatorModel" is required.');
  }
  if (!isOpenAIModel(evaluatorModel) && !evaluatorModel.startsWith("mock")) {
    throw new MarbleApiHttpError(
      400,
      `Unsupported evaluator model "${evaluatorModel}". Supported: ${supportedOpenAIModelList()}.`,
    );
  }

  // Mock path: do not invoke Python; return a clearly labeled non-MARBLE stub failure
  // so callers know real MARBLE code was not run — except for dry structural checks.
  if (evaluatorModel.startsWith("mock")) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error:
          "Mock evaluator model cannot invoke real MARBLE. Choose an OpenAI evaluator model.",
      }),
    );
    return;
  }

  if (!apiKey && !process.env.OPENAI_API_KEY) {
    throw new MarbleApiHttpError(
      503,
      "OPENAI_API_KEY is required for MARBLE LiteLLM evaluator calls.",
    );
  }

  const result = await runPosthoc(body, apiKey);
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body));
}

export async function safeHandleMarbleEvaluateApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  apiKey: string | undefined,
): Promise<void> {
  try {
    await handleMarbleEvaluateApiRequest(req, res, apiKey);
  } catch (error) {
    const status =
      error instanceof MarbleApiHttpError ? error.status : 500;
    const message =
      error instanceof Error ? error.message : "Unexpected MARBLE proxy error.";
    if (!res.headersSent) {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: message }));
    }
  }
}
