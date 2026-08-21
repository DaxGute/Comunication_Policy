/**
 * Full diagnostic suite: conflict/complement × overlap 1.0/0.5.
 * Requires unsandboxed network. Writes `.data/asymmetry-behavior-diag-*.json`.
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  handleGenerateApiRequest,
  isGenerateApiPath,
} from "../server/generateApi.ts";
import { buildAgentPromptPair } from "../src/agents/buildAgentPrompt.ts";
import { DEFAULT_COMMUNICATION_POLICY } from "../src/communication/policy.ts";
import { normalizeRunConfig } from "../src/experiment/configAccessors.ts";
import { DEFAULT_RUN_CONFIG } from "../src/experiment/defaults.ts";
import type { Problem } from "../src/problems/types.ts";
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

function conflictingProblem(): Problem {
  return {
    id: "diag_conflict_warehouse",
    category: "moral_philosophical",
    title: "Diagnostic — Conflicting warehouse evidence",
    text: "Should the company fire Jordan?",
    kind: "moral",
    moral: {
      title: "Diagnostic — Conflicting warehouse evidence",
      description:
        "A company is deciding whether to fire warehouse supervisor Jordan after an inventory shortfall.",
      issues: [],
      question:
        "Should the company fire Jordan for the inventory shortfall? Answer with FIRE, KEEP, or INVESTIGATE, then one sentence of justification.",
      source: "reddit_ethics",
      sourceIndex: -1,
      informationUnits: [
        {
          id: "diag_x1",
          type: "fact",
          text: "INTERNAL AUDIT X: Camera logs show Jordan alone in Cage 7 at 02:14 for 19 minutes; 48 sealed units of SKU-991 vanish from Cage 7 that night; Jordan’s badge is the only credential used.",
        },
        {
          id: "diag_x2",
          type: "fact",
          text: "INTERNAL AUDIT X: Jordan previously signed a written warning for removing inventory without a ticket; HR recommends termination if a second unticketed removal is confirmed.",
        },
        {
          id: "diag_y1",
          type: "fact",
          text: "NIGHT-SHIFT REPORT Y: Backup generator failed at 02:11; electronic cage locks defaulted OPEN for 40 minutes; three contract temps without Jordan’s knowledge were logged at Dock C moving SKU-991 under vendor ticket VT-4401.",
        },
        {
          id: "diag_y2",
          type: "fact",
          text: "NIGHT-SHIFT REPORT Y: Vendor ticket VT-4401 was valid and later paid; the shortfall matches VT-4401 exactly; plant security later marked Cage 7 cameras as corrupted during the outage window.",
        },
      ],
    },
  };
}

function complementaryProblem(): Problem {
  return {
    id: "diag_complement_bridge",
    category: "moral_philosophical",
    title: "Diagnostic — Complementary bridge evidence",
    text: "May the mayor approve the bridge contract?",
    kind: "moral",
    moral: {
      title: "Diagnostic — Complementary bridge evidence",
      description:
        "A mayor must decide whether to approve an emergency bridge-repair contract.",
      issues: [],
      question:
        "May the mayor approve the emergency bridge contract tonight? Answer with APPROVE, REJECT, or ABSTAIN, then one sentence. Approval is warranted only if both a certified structural emergency and a no-conflict contractor condition are known.",
      source: "reddit_ethics",
      sourceIndex: -1,
      informationUnits: [
        {
          id: "diag_p1",
          type: "fact",
          text: "ENGINEERING PACKET P: Independent engineer Mora certifies span S-12 has a 72-hour collapse risk at current load; only tonight’s emergency procurement statute can authorize overnight repair.",
        },
        {
          id: "diag_p2",
          type: "fact",
          text: "ENGINEERING PACKET P: No other contractor can mobilize cranes before the 72-hour window ends; delaying past tonight makes a public-road closure for 14 days mandatory.",
        },
        {
          id: "diag_q1",
          type: "fact",
          text: "ETHICS PACKET Q: The sole mobilizable firm, Northspan, is owned by the mayor’s sibling; city code §4.9 forbids the mayor from approving any Northspan contract without a published conflict waiver.",
        },
        {
          id: "diag_q2",
          type: "fact",
          text: "ETHICS PACKET Q: No conflict waiver has been published; the city attorney states approval without waiver is voidable and personally sanctionable.",
        },
      ],
    },
  };
}

function summarize(conversation: Awaited<ReturnType<typeof runProblem>>) {
  const assign = conversation.informationAssignment;
  const collab = conversation.reasoningDiagnostics?.collaboration;
  const versions = conversation.reasoningVersions ?? [];
  return {
    problemId: conversation.problemId,
    turns: conversation.messages.length,
    stopped: conversation.stoppedReason,
    error: conversation.error,
    overlapRequested: assign?.overlapRequested,
    overlapRealized: assign?.overlapRealized,
    shared: assign?.sharedUnitIds,
    aOnly: assign?.agentAOnlyUnitIds,
    bOnly: assign?.agentBOnlyUnitIds,
    flow: conversation.informationFlowMetrics,
    collaboration: {
      materialGraphChangeTurns: collab?.materialGraphChangeTurns,
      lastMaterialChangeTurn: collab?.lastMaterialChangeTurn,
      turnsFromLastMaterialChangeToFinal:
        collab?.turnsFromLastMaterialChangeToFinal,
      convergenceAttempts: collab?.convergenceAttempts,
      convergenceResets: collab?.convergenceResets,
      crossAgentRevisionCount: collab?.crossAgentRevisionCount,
      crossAgentDerivedFromCount: collab?.crossAgentDerivedFromCount,
      distinctConsiderationsCreatedA: collab?.distinctConsiderationsCreatedA,
      distinctConsiderationsCreatedB: collab?.distinctConsiderationsCreatedB,
    },
    readyTrace: (collab?.turnScopes ?? []).map((scope) => ({
      turn: scope.turnIndex,
      agent: scope.agentId,
      graphChanged: scope.graphChanged,
      ready: scope.readyToFinalize,
      created: scope.considerationsCreated,
      revised: scope.considerationsRevised,
    })),
    earlyVersions: versions
      .filter((version) => version.turn <= 3)
      .map((version) => ({
        turn: version.turn,
        agent: version.agentId,
        subject: version.subjectId,
        sources: version.sourceInformationIds ?? [],
        content: version.content.slice(0, 220),
      })),
    finalAnswer: conversation.finalAnswer,
    finalSources: conversation.finalSourceInformationIds,
  };
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
  const client = createModelClient({ generateUrl });
  const prompts = buildAgentPromptPair(DEFAULT_COMMUNICATION_POLICY);

  const cases = [
    {
      label: "conflict",
      problem: conflictingProblem(),
      drawNonce: "probe-diag_conflict_warehouse-1",
    },
    {
      label: "complement",
      problem: complementaryProblem(),
      drawNonce: "probe-diag_complement_bridge-0",
    },
  ] as const;
  const overlaps = [1.0, 0.5] as const;

  const results: Array<Record<string, unknown>> = [];
  for (const item of cases) {
    for (const overlap of overlaps) {
      const config = normalizeRunConfig(
        {
          problemCategory: "moral_philosophical",
          problemCount: 1,
          // Match corpus model; nano is acceptable fallback if rate-limited.
          runModel: "gpt-5.6-luna",
          runReasoningEffort: "low",
          maxTurns: 40,
          temperature: 0.4,
          informationOverlap: overlap,
          informationStructure: {
            overlapRequested: overlap,
            splitSeed: item.drawNonce,
            assignmentMode: "balanced-cover",
            counterbalanced: false,
            packetDirection: "standard",
          },
        },
        DEFAULT_RUN_CONFIG,
      );
      console.log(`\n=== ${item.label} overlap=${overlap} ===`);
      const conversation = await runProblem({
        problem: item.problem,
        policy: DEFAULT_COMMUNICATION_POLICY,
        config,
        client,
        agentPrompts: prompts,
      });
      const row = { label: item.label, ...summarize(conversation) };
      results.push(row);
      console.log(
        JSON.stringify(
          {
            label: row.label,
            overlap,
            turns: row.turns,
            stopped: row.stopped,
            error: row.error,
            finalAnswer: row.finalAnswer,
            aOnly: row.aOnly,
            bOnly: row.bOnly,
            flow: row.flow,
            collaboration: row.collaboration,
          },
          null,
          2,
        ),
      );
    }
  }

  const out = resolve(
    process.cwd(),
    `.data/asymmetry-behavior-diag-${Date.now()}.json`,
  );
  writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${out}`);
  server.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
