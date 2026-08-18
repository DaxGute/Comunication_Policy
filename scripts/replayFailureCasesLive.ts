/**
 * Live rerun of the latest-sweep freeze/closure exemplars with the updated
 * protocol. Does not write into the experiment store.
 *
 * Usage: npx vite-node scripts/replayFailureCasesLive.ts
 */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt.ts";
import { createCommunicationPolicy } from "../src/communication/policy.ts";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults.ts";
import { normalizeRunConfig } from "../src/experiment/configAccessors.ts";
import { loadCrosswordBenchProblems } from "../src/problems/crossword/loadCrosswordBench.ts";
import { createModelClient } from "../src/runtime/modelClient.ts";
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

const CASES = [
  { problemId: "crosswordbench_0015", trustA: 1, authority: 1 },
  { problemId: "crosswordbench_0026", trustA: 0.5, authority: 1 },
  { problemId: "crosswordbench_0030", trustA: 0, authority: 1 },
] as const;

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
  const client = createModelClient({ generateUrl });
  const problems = new Map(
    loadCrosswordBenchProblems().map((problem) => [problem.id, problem]),
  );

  for (const testCase of CASES) {
    const problem = problems.get(testCase.problemId);
    if (!problem) throw new Error(`missing ${testCase.problemId}`);
    const policy = createCommunicationPolicy({
      trustA: testCase.trustA,
      trustB: 0.5,
      authority: testCase.authority,
      familiarity: 0.5,
    });
    const config = normalizeRunConfig(
      {
        problemCategory: "crossword",
        problemCount: 1,
        runModel: "gpt-5.4-nano",
        maxTurns: 40,
        temperature: 0.4,
      },
      DEFAULT_RUN_CONFIG,
    );
    console.log(
      `\n=== ${testCase.problemId} trustA=${testCase.trustA} ===`,
    );
    const conversation = await runProblem({
      problem,
      policy,
      config,
      client,
      agentPrompts: buildAgentPromptPair(policy),
    });
    const progress = conversation.reasoningDiagnostics?.solverProgress;
    const tags: Array<[number, string]> = [];
    for (const message of conversation.messages) {
      for (const item of message.modelRequest ?? []) {
        if (item.role !== "user") continue;
        for (const label of [
          "LOCAL_LOOP",
          "STALL WARNING",
          "CLOSURE WARNING",
          "FINALIZATION REQUIRED",
        ]) {
          if (item.content.startsWith(label) || item.content.includes(`\n${label}`) || item.content.startsWith(`${label}\n`)) {
            if (item.content.split("\n")[0] === label || item.content.startsWith(label)) {
              tags.push([message.turnIndex, label]);
            }
          }
        }
      }
    }
    const unique = [...new Map(tags.map((item) => [`${item[0]}:${item[1]}`, item])).values()];
    console.log("stopped:", conversation.stoppedReason, "turns:", conversation.messages.length);
    if (conversation.error) console.log("error:", conversation.error);
    console.log("has FINAL_ANSWER:", Boolean(conversation.finalAnswer));
    console.log("interventions:", unique.map(([turn, label]) => `T${turn}:${label}`).join(" → ") || "(none)");
    console.log({
      freezeType: progress?.freezeType,
      freezeDetectedTurn: progress?.freezeDetectedTurn,
      warningDeliveredTurn: progress?.warningDeliveredTurn,
      stallWarningKind: progress?.stallWarningKind,
      closureWarningTurn: progress?.closureWarningTurn,
      closureWarningReason: progress?.closureWarningReason,
      finalizationRequiredTurn: progress?.finalizationRequiredTurn,
      finalizationDeliveredTurn: progress?.finalizationDeliveredTurn,
      progressResumedAfterWarning: progress?.progressResumedAfterWarning,
      finalAnswerAfterWarning: progress?.finalAnswerAfterWarning,
      finalAnswerAfterFinalization: progress?.finalAnswerAfterFinalization,
      turnsFromWarningToFinalAnswer: progress?.turnsFromWarningToFinalAnswer,
      terminatedAsProtocolStall: progress?.terminatedAsProtocolStall,
      terminatedAsMaxTurns: progress?.terminatedAsMaxTurns,
    });
    const last = conversation.messages.at(-1)?.content ?? "";
    if (/FINAL_ANSWER:/i.test(last)) {
      console.log("last answer:\n", last.slice(last.search(/FINAL_ANSWER:/i), last.search(/FINAL_ANSWER:/i) + 400));
    }
  }

  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
