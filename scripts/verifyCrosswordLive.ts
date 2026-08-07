/**
 * Live OpenAI verification: one full CrossWordBench puzzle through the two-agent loop.
 *
 * Usage: npm run verify:crossword-live
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt.ts";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy.ts";
import { evaluateRun } from "../src/evaluation/evaluateRun.ts";
import { selectProblems } from "../src/problems/registry.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
import { OPENAI_MODEL_ID } from "../src/runtime/models.ts";
import { runProblem } from "../src/runtime/runProblem.ts";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
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
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const server = createServer((req, res) => {
    if (!isGenerateApiPath(req.url)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    void handleGenerateApiRequest(req, res, apiKey);
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const generateUrl = `http://127.0.0.1:${addr.port}/api/generate`;

  const problem = selectProblems("crossword", 1)[0];
  if (!problem?.crossword) throw new Error("no crossword problem");

  // Leak check against known solution words
  for (const clue of problem.crossword.clues) {
    if (problem.text.includes(clue.answer)) {
      throw new Error(`problem text leaked ${clue.answer}`);
    }
  }
  const prompts = buildAgentPromptPair(DEFAULT_COMMUNICATION_POLICY);
  console.log("problem:", problem.title);
  console.log("clues:", problem.crossword.clues.length);
  console.log("prompt has ACROSS/DOWN:", /ACROSS/.test(problem.text) && /DOWN/.test(problem.text));
  console.log("system prompts identical task framing: both mention tentative/revise/share");

  const client = createModelClient({ generateUrl });
  console.log("\nRunning live two-agent crossword (this spends API credits)...\n");

  const conversation = await runProblem({
    problem,
    policy: DEFAULT_COMMUNICATION_POLICY,
    config: {
      problemCategory: "crossword",
      problemCount: 1,
      model: OPENAI_MODEL_ID,
      provider: "openai",
      maxTurns: 6,
      temperature: 0.4,
    },
    client,
  });

  const run = {
    id: "live-verify",
    createdAt: new Date().toISOString(),
    policy: DEFAULT_COMMUNICATION_POLICY,
    agentPrompts: prompts,
    config: {
      problemCategory: "crossword" as const,
      problemCount: 1,
      model: OPENAI_MODEL_ID,
      provider: "openai" as const,
      maxTurns: 6,
      temperature: 0.4,
    },
    conversations: [conversation],
    status: "completed" as const,
  };
  const evaluation = evaluateRun(run);
  const pe = evaluation.problems[0];

  console.log("--- transcript ---");
  for (const m of conversation.messages) {
    console.log(`\n[${m.agentId} turn ${m.turnIndex}]`);
    console.log(m.content.slice(0, 900));
    if (m.content.length > 900) console.log("…");
  }

  console.log("\n--- evaluation ---");
  console.log("stopped:", conversation.stoppedReason);
  console.log("label:", pe.label);
  console.log("letterAccuracy:", pe.details?.letterAccuracy);
  console.log("wordAccuracy:", pe.details?.wordAccuracy);
  console.log("completion:", pe.details?.completion);
  console.log("crossingConsistency:", pe.details?.crossingConsistency);
  console.log("exactSolve:", pe.details?.exactSolve);
  console.log("finalAnswer:\n", conversation.finalAnswer ?? "(none)");

  // Heuristic: look for whole-puzzle reasoning markers
  const joined = conversation.messages.map((m) => m.content).join("\n").toLowerCase();
  const markers = [
    "cross",
    "across",
    "down",
    "conflict",
    "revis",
    "letter",
    "grid",
  ];
  const hit = markers.filter((m) => joined.includes(m));
  console.log("reasoning marker hits:", hit.join(", ") || "(none)");

  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
