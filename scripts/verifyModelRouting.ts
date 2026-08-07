/**
 * Offline checks for model routing (no OpenAI key required).
 */
import { createServer } from "node:http";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import {
  modelSupportsCustomTemperature,
  OPENAI_MODEL_ID,
} from "../src/runtime/models.ts";

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind");
  }
  return address.port;
}

async function main(): Promise<void> {
  if (modelSupportsCustomTemperature("gpt-4o-mini") !== true) {
    throw new Error("gpt-4o-mini should allow custom temperature");
  }
  for (const model of ["gpt-5", "gpt-5-mini", "gpt-5-nano"]) {
    if (modelSupportsCustomTemperature(model) !== false) {
      throw new Error(`${model} should not allow custom temperature`);
    }
  }
  console.log("temperature-compat OK");

  const client = createModelClient();

  const mock = await client.generate({
    model: "mock-deterministic",
    temperature: 0,
    messages: [{ role: "user", content: "hi" }],
  });
  if (mock.provider !== "mock" || !mock.content) {
    throw new Error("Mock path failed");
  }
  console.log("mock OK");

  try {
    await client.generate({
      model: "claude-sonnet",
      temperature: 0,
      messages: [{ role: "user", content: "hi" }],
    });
    throw new Error("Unsupported model should have thrown");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Unsupported model")) throw error;
    console.log("unsupported-model OK");
  }

  const missingKeyServer = createServer((req, res) => {
    if (!isGenerateApiPath(req.url)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    void handleGenerateApiRequest(req, res, undefined);
  });
  const missingPort = await listen(missingKeyServer);
  const missingClient = createModelClient({
    generateUrl: `http://127.0.0.1:${missingPort}/api/generate`,
  });
  try {
    await missingClient.generate({
      model: OPENAI_MODEL_ID,
      temperature: 0,
      messages: [{ role: "user", content: "hi" }],
    });
    throw new Error("Missing key should have thrown");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/OPENAI_API_KEY/i.test(message)) throw error;
    if (/using MockModelClient/i.test(message)) {
      throw new Error("Unexpected mock fallback");
    }
    console.log("missing-key-via-proxy OK");
  } finally {
    missingKeyServer.close();
  }

  const stub = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/generate") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ content: "MODEL_CONNECTED", provider: "openai" }),
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  const stubPort = await listen(stub);
  const stubClient = createModelClient({
    generateUrl: `http://127.0.0.1:${stubPort}/api/generate`,
  });
  const stubResp = await stubClient.generate({
    model: OPENAI_MODEL_ID,
    temperature: 0,
    messages: [
      { role: "user", content: "Respond with exactly: MODEL_CONNECTED" },
    ],
  });
  if (
    stubResp.content !== "MODEL_CONNECTED" ||
    stubResp.provider !== "openai"
  ) {
    throw new Error(`Stub client failed: ${JSON.stringify(stubResp)}`);
  }
  console.log("stub-proxy ModelClient OK");
  stub.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
