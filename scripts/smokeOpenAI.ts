/**
 * Smoke-test: prove ModelClient.generate() reaches a real OpenAI response
 * via the same /api/generate proxy contract the browser uses — for every
 * model offered in the workbench picker.
 *
 * Usage:
 *   OPENAI_API_KEY=... npm run smoke:openai
 *   # or with key in .env.local
 *   npm run smoke:openai
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import {
  modelSupportsCustomTemperature,
  OPENAI_MODELS,
} from "../src/runtime/models.ts";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is missing. Set it in the environment or .env.local.",
    );
  }

  const server = createServer((req, res) => {
    if (!isGenerateApiPath(req.url)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    void handleGenerateApiRequest(req, res, apiKey);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind local smoke-test proxy.");
  }

  const generateUrl = `http://127.0.0.1:${address.port}/api/generate`;
  const client = createModelClient({ generateUrl });

  const failures: string[] = [];
  try {
    for (const { id } of OPENAI_MODELS) {
      // Match the app: always send a configured temperature. The proxy must
      // omit it for GPT-5 / reasoning models so OpenAI does not 400.
      const temperature = modelSupportsCustomTemperature(id) ? 0.4 : 0;
      try {
        const response = await client.generate({
          model: id,
          temperature,
          messages: [
            {
              role: "user",
              content: "Respond with exactly: MODEL_CONNECTED",
            },
          ],
        });

        if (!response.content || response.content.trim() === "") {
          throw new Error("empty content");
        }
        if (response.provider !== "openai") {
          throw new Error(`provider=${String(response.provider)}`);
        }
        console.log(`OK  ${id}  ${JSON.stringify(response.content.slice(0, 60))}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(`${id}: ${detail}`);
        console.error(`FAIL  ${id}  ${detail}`);
      }
    }
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((err) => (err ? rejectClose(err) : resolveClose()));
    });
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${OPENAI_MODELS.length} models failed:\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
  }

  console.log(`smoke:openai OK (${OPENAI_MODELS.length} models)`);
}

main().catch((error) => {
  console.error("smoke:openai FAILED");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
