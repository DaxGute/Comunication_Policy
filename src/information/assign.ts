/**
 * Domain adapters expose shared context + splitable information units.
 * The common splitter assigns units; domains only define what a unit is.
 */

import type { AgentId } from "../agents/types";
import { crosswordIssueId } from "../problems/crossword/refs";
import type { CrosswordClue, CrosswordPuzzle } from "../problems/crossword/types";
import { findCrosswordCrossings } from "../problems/crossword/geometry";
import type { Problem } from "../problems/types";
import type {
  HiddenProfileOverlapTreatment,
  InformationAssignment,
  InformationOriginalOwner,
  InformationPacketDirection,
  InformationRealizedVisibility,
  InformationStructureConfig,
  InformationUnit,
  ProblemInformationStructure,
} from "./types";
import {
  buildHiddenProfilePromotionSeed,
  splitHiddenProfileUnits,
} from "./hiddenProfileOverlap";
import {
  splitInformationUnits,
  validateInformationSplit,
} from "./split";

function formatGridBlock(grid: string[]): string {
  const width = grid[0]?.length ?? 0;
  const colHeader = Array.from({ length: width }, (_, i) => String(i + 1)).join(
    " ",
  );
  const rows = grid.map((row, i) => {
    const cells = row.split("").join(" ");
    return `${String(i + 1).padStart(2, " ")}  ${cells}`;
  });
  return [`   ${colHeader}`, ...rows].join("\n");
}

function formatClueLine(clue: CrosswordClue): string {
  const row = clue.row + 1;
  const col = clue.col + 1;
  return `${clue.number}. [row ${row}, col ${col}, ${clue.length} letters] ${clue.clue}`;
}

function crosswordSharedContext(puzzle: Pick<CrosswordPuzzle, "grid" | "clues">): string {
  const crossings = findCrosswordCrossings(puzzle.clues).map(
    (crossing) =>
      `- Across ${crossing.acrossNumber} letter ${crossing.acrossIndex + 1} = ` +
      `Down ${crossing.downNumber} letter ${crossing.downIndex + 1} ` +
      `(row ${crossing.row + 1}, col ${crossing.col + 1})`,
  );

  return [
    "CROSSWORD",
    "",
    "Grid (1-indexed rows and columns):",
    formatGridBlock(puzzle.grid),
    "",
    '"." = empty cell that needs a letter',
    '"#" = blocked square (no letter)',
    "",
    "CROSSINGS (shared cells — these letters MUST match):",
    ...(crossings.length > 0
      ? crossings
      : ["- (no across/down overlaps in this grid)"]),
    "",
    "Your goal is to collaboratively solve the ENTIRE crossword.",
    "",
    "## Hard placement rules",
    "Answers that break these rules cannot sit on the grid together:",
    "1. Exact length — each answer must have exactly the stated letter count (no shorter, no longer).",
    "2. Spatial overlap — every CROSSINGS line above is a shared cell. The Across letter and the Down letter at that cell must be identical.",
    "3. Consistency — shared letters must agree. If two candidates disagree at a crossing, at least one is wrong; revise it if you can.",
    "4. Full cover — assign every Across and Down clue. Partial lists leave holes.",
    "",
    "Clue text is provided in your PRIVATE INFORMATION packet (and any SHARED INFORMATION units).",
    "You may not see every clue; your partner may hold clues you lack. Communicate fills and constraints.",
    "How to check a candidate fill:",
    "- Across N starts at its [row, col] and runs right for N's length.",
    "- Down M starts at its [row, col] and runs down for M's length.",
    "- Where those paths share a cell (listed under CROSSINGS), both answers must put the same letter there.",
    "",
    "Discuss candidates, crossings, conflicts, and revisions with your partner. Do not treat clues as isolated trivia.",
    "You are not required to solve clues in number order; often solving a crossing pair together is better.",
    "",
    "Do not emit a complete solution on every turn. Keep turns in natural language while you explore.",
    "FINAL_ANSWER ends the interaction immediately. Emit it when the grid is complete, or when further reasoning is not improving the solution. Prefer a best-effort answer over leaving the puzzle unfinished.",
    "When ready, report clue assignments as:",
    "",
    "FINAL_ANSWER:",
    "ACROSS",
    "1: ANSWER",
    "3: ANSWER",
    "...",
    "DOWN",
    "1: ANSWER",
    "2: ANSWER",
    "...",
    "",
    "Use letters only in each answer (spaces and punctuation will be ignored).",
  ].join("\n");
}

function crosswordUnits(puzzle: Pick<CrosswordPuzzle, "clues">): InformationUnit[] {
  return puzzle.clues.map((clue) => {
    const id = crosswordIssueId(clue.direction, clue.number);
    const dir = clue.direction === "down" ? "DOWN" : "ACROSS";
    return {
      id,
      type: "clue" as const,
      text: `${dir} ${formatClueLine(clue)}`,
    };
  });
}

/**
 * Deterministic sentence-ish segmentation for moral scenarios that lack
 * authored informationUnits. Does not use an LLM.
 */
export function segmentMoralInformationUnits(
  description: string,
  options?: { idPrefix?: string },
): InformationUnit[] {
  const prefix = options?.idPrefix ?? "fact";
  const normalized = description
    .replace(/\s+/g, " ")
    .replace(/\*\*/g, "")
    .trim();
  if (!normalized) return [];

  // Split on sentence boundaries; keep short fragments attached when possible.
  const rawParts = normalized
    .split(/(?<=[.!?])\s+(?=[a-zA-Z\[\"'])|(?:\n{2,})/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const merged: string[] = [];
  for (const part of rawParts) {
    const prev = merged[merged.length - 1];
    if (prev && (prev.length < 40 || part.length < 24)) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }

  // Prefer a manageable number of units for small-N rounding fidelity.
  const targetMax = 14;
  if (merged.length > targetMax) {
    const chunkSize = Math.ceil(merged.length / targetMax);
    const chunked: string[] = [];
    for (let i = 0; i < merged.length; i += chunkSize) {
      chunked.push(merged.slice(i, i + chunkSize).join(" "));
    }
    return chunked.map((text, index) => ({
      id: `${prefix}_${index + 1}`,
      type: "fact" as const,
      text,
    }));
  }

  return merged.map((text, index) => ({
    id: `${prefix}_${index + 1}`,
    type: "fact" as const,
    text,
  }));
}

function moralSharedContext(problem: Problem): string {
  const moral = problem.moral;
  const title = moral?.title ?? problem.title;
  const question = moral?.question ?? "";
  return [
    "Develop and pressure-test the considerations needed for a well-supported",
    "final answer to this ethical / philosophical dilemma.",
    "There is no single objectively correct answer — do not hunt for a gold label.",
    "The stance belongs in FINAL SYNTHESIS, not in every reasoning turn.",
    "",
    `Title: ${title}`,
    "",
    "Discussion question:",
    question,
    "",
    "Case details are provided in your information packets (SHARED / PRIVATE).",
    "You may not see every relevant statement; your partner may hold facts you lack.",
    "Do not invent missing facts — ask, infer carefully, or leave uncertainty explicit.",
    "",
    "The shared reasoning graph begins empty.",
    "Start with the most important considerations needed to begin reasoning.",
    "Do not attempt an exhaustive decomposition of the dilemma on the first turn.",
    "Later turns may reveal additional considerations.",
    "",
    "During the reasoning phase, each turn should make a small, targeted contribution",
    "to the shared reasoning state rather than synthesize the entire dilemma.",
    "Focus on the most important unresolved part of the current state.",
    "A consideration may be a factor, principle, factual assessment, tradeoff, assumption,",
    "or intermediate conclusion.",
    "Create a new consideration only when it materially affects the problem and can evolve",
    "independently of other considerations.",
    "Do not create rows for the question, overall answer, summaries, examples, or every",
    "sentence you say.",
    "You do not need to resolve every uncertainty immediately — leave some issues open",
    "for the partner to develop.",
    "",
    "Continue while shared reasoning is still changing materially.",
    "Set readyToFinalize: true only when important considerations are sufficiently",
    "developed and there is no specific unresolved issue that another exchange is",
    "reasonably likely to improve.",
    "If your partner's previous turn materially changed the graph, readiness should",
    "normally be false until you have evaluated the consequences of that change.",
    "Mutual readiness on a stable graph opens FINALIZATION PHASE; only then produce",
    "the first comprehensive treatment of the entire dilemma:",
    "FINAL_ANSWER: <1-3 sentence synthesized response>",
  ].join("\n");
}

function moralUnits(problem: Problem): InformationUnit[] {
  const authored = problem.moral?.informationUnits;
  if (authored && authored.length > 0) {
    return authored.map((unit) => ({
      id: unit.id,
      text: unit.text,
      type: unit.type ?? "fact",
      visibilityCategory: unit.visibilityCategory,
    }));
  }
  const description = problem.moral?.description ?? "";
  return segmentMoralInformationUnits(description, {
    idPrefix: `${problem.id.replace(/[^a-zA-Z0-9]+/g, "_")}_fact`,
  });
}

/**
 * Authored Hidden Profile packets. Never include goldAnswer or evaluatorMetadata.
 *
 * informationOverlap semantics for this family (private-promotion dose):
 * - 0.0 → authored HiddenBench distributed profile
 * - (0,1) → progressively promote originally-private units into shared
 * - 1.0 → FULL INFORMATION (both agents see every unit)
 * Never randomly re-partitions or demotes authored shared units.
 */
function hiddenProfileSharedContext(problem: Problem): string {
  return problem.text;
}

function hiddenProfileUnits(problem: Problem): InformationUnit[] {
  const info = problem.hiddenProfile?.information ?? [];
  return info.map((unit) => {
    const originalVisibility = unit.visibility as InformationRealizedVisibility;
    const originalOwner: InformationOriginalOwner =
      unit.visibility === "a_private"
        ? "A"
        : unit.visibility === "b_private"
          ? "B"
          : "shared";
    return {
      id: unit.id,
      text: unit.text,
      type: unit.type ?? "fact",
      visibilityCategory: unit.visibility,
      originalOwner,
      originalVisibility,
      // Realized visibility is stamped after the overlap treatment.
      realizedVisibility: originalVisibility,
    };
  });
}

/** Shared public task context (never split). */
export function getSharedContext(problem: Problem): string {
  if (problem.kind === "crossword_puzzle" && problem.crossword) {
    return crosswordSharedContext(problem.crossword);
  }
  if (problem.kind === "moral" || problem.category === "moral_philosophical") {
    return moralSharedContext(problem);
  }
  if (
    problem.kind === "hidden_profile" ||
    problem.category === "hidden_profile"
  ) {
    return hiddenProfileSharedContext(problem);
  }
  return problem.text;
}

/** Relevant splitable units for this problem. */
export function getInformationUnits(problem: Problem): InformationUnit[] {
  if (problem.kind === "crossword_puzzle" && problem.crossword) {
    return crosswordUnits(problem.crossword);
  }
  if (problem.kind === "moral" || problem.category === "moral_philosophical") {
    return moralUnits(problem);
  }
  if (
    problem.kind === "hidden_profile" ||
    problem.category === "hidden_profile"
  ) {
    return hiddenProfileUnits(problem);
  }
  return [];
}

export function getProblemInformationStructure(
  problem: Problem,
): ProblemInformationStructure {
  return {
    sharedContext: getSharedContext(problem),
    units: getInformationUnits(problem),
  };
}

export function formatInformationPacket(
  units: InformationUnit[],
  sectionTitle: string,
): string {
  if (units.length === 0) {
    return [`${sectionTitle}`, "", "(none)"].join("\n");
  }
  const lines = [`${sectionTitle}`, ""];
  for (const unit of units) {
    lines.push(`[${unit.id}]`);
    lines.push(unit.text);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export function buildAgentProblemText(args: {
  sharedContext: string;
  units: InformationUnit[];
  unitIds: readonly string[];
  agentId: AgentId;
}): string {
  const byId = new Map(args.units.map((unit) => [unit.id, unit]));
  const packetUnits = args.unitIds
    .map((id) => byId.get(id))
    .filter((unit): unit is InformationUnit => Boolean(unit));

  const privateLabel =
    args.agentId === "agent_a"
      ? "PRIVATE INFORMATION (Agent A only — do not assume your partner sees these)"
      : "PRIVATE INFORMATION (Agent B only — do not assume your partner sees these)";

  // At full overlap every unit is "shared"; still list them once under SHARED.
  const allShared =
    packetUnits.length > 0 &&
    args.unitIds.length === args.units.length &&
    new Set(args.unitIds).size === args.units.length;

  // Caller passes the agent's full packet ids; shared vs private is decided upstream.
  return [
    args.sharedContext,
    "",
    formatInformationPacket(packetUnits, "YOUR INFORMATION PACKET"),
    "",
    "Cite task evidence with sourceInformationIds using the bracket ids above",
    '(for example "sourceInformationIds":["fact_3"]).',
    "sourceInformationIds is separate from basis/derived_from (shared graph provenance).",
    "Only cite ids from YOUR packet. Do not invent partner-private ids.",
    allShared ? "" : `Packet scope: ${privateLabel.split("—")[0]!.trim()} plus any shared units included above.`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

/**
 * Build per-agent problem views + assignment snapshot.
 * Throws in development-style validation when union coverage fails.
 *
 * Hidden Profile: overlap ∈ [0,1] promotes originally-private units into
 * shared (nested, stratified). Never randomly re-partitions authored evidence.
 */
export function assignProblemInformation(args: {
  problem: Problem;
  overlapRequested: number;
  splitSeed: string;
  packetDirection?: InformationPacketDirection;
  assignmentMode?: InformationStructureConfig["assignmentMode"];
  counterbalanced?: boolean;
  /**
   * Nesting-stable promotion seed for Hidden Profile. When omitted, derived
   * from splitSeed by stripping any `|o=…` segment.
   */
  promotionSeed?: string;
  /** When true (default), throw if A ∪ B ≠ all units. */
  failOnIncompleteUnion?: boolean;
}): {
  assignment: InformationAssignment;
  problemTextA: string;
  problemTextB: string;
  sharedContext: string;
} {
  const structure = getProblemInformationStructure(args.problem);
  const unitIds = structure.units.map((unit) => unit.id);
  const direction = args.packetDirection ?? "standard";
  const isHiddenProfile =
    args.problem.category === "hidden_profile" ||
    args.problem.kind === "hidden_profile" ||
    Boolean(args.problem.hiddenProfile);

  const promotionSeed =
    args.promotionSeed?.trim() ||
    (isHiddenProfile
      ? args.splitSeed.replace(/\|o=[^|]+/g, "")
      : args.splitSeed);

  let treatment: HiddenProfileOverlapTreatment | undefined;
  const split = isHiddenProfile
    ? (() => {
        const hp = splitHiddenProfileUnits({
          units: structure.units,
          overlapRequested: args.overlapRequested,
          packetDirection: direction,
          promotionSeed,
        });
        treatment = hp.treatment;
        return hp;
      })()
    : splitInformationUnits({
        unitIds,
        overlap: args.overlapRequested,
        seed: args.splitSeed,
        packetDirection: direction,
      });

  const validation = validateInformationSplit(unitIds, split);
  if (!validation.ok && args.failOnIncompleteUnion !== false) {
    throw new Error(
      `Information split failed for ${args.problem.id}: ${validation.errors.join("; ")}`,
    );
  }

  const byId = new Map(structure.units.map((unit) => [unit.id, unit]));
  const pick = (ids: readonly string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((unit): unit is InformationUnit => Boolean(unit));

  const sharedUnits = pick(split.sharedIds);
  const aOnly = pick(split.agentAOnlyIds);
  const bOnly = pick(split.agentBOnlyIds);
  const isFullInformation =
    split.agentAOnlyIds.length === 0 && split.agentBOnlyIds.length === 0;

  const unitsWithRealized: InformationUnit[] = structure.units.map((unit) => {
    let realizedVisibility: InformationRealizedVisibility =
      (unit.originalVisibility as InformationRealizedVisibility | undefined) ??
      (unit.visibilityCategory as InformationRealizedVisibility | undefined) ??
      "shared";
    if (split.sharedIds.includes(unit.id)) {
      realizedVisibility = "shared";
    } else if (split.agentAOnlyIds.includes(unit.id)) {
      realizedVisibility = "a_private";
    } else if (split.agentBOnlyIds.includes(unit.id)) {
      realizedVisibility = "b_private";
    }
    return { ...unit, realizedVisibility };
  });

  const citationFooter = [
    "When you SET or REVISE a proposition based on packet evidence, include",
    'sourceInformationIds with the bracket ids (for example ["fact_3"]).',
    "basis / derived_from cites shared proposition versions only (for example pv-3).",
    "sourceInformationIds and basis are separate provenance channels.",
    "Only cite ids from the evidence sections above — never invent partner-only ids.",
  ];

  const formatAgentView = (agentId: AgentId, packetIds: readonly string[]) => {
    const packet = pick(packetIds);
    if (isFullInformation) {
      return [
        structure.sharedContext,
        "",
        "FULL INFORMATION",
        "All evidence is visible to both agents.",
        "",
        formatInformationPacket(
          sharedUnits,
          "SHARED INFORMATION (both agents)",
        ),
        "",
        ...citationFooter,
        `Visible units this turn: ${packet.map((u) => u.id).join(", ") || "(none)"}.`,
      ].join("\n");
    }
    const sharedSection = formatInformationPacket(
      sharedUnits,
      "SHARED INFORMATION (both agents)",
    );
    const privateSection = formatInformationPacket(
      agentId === "agent_a" ? aOnly : bOnly,
      agentId === "agent_a"
        ? "PRIVATE INFORMATION (Agent A only)"
        : "PRIVATE INFORMATION (Agent B only)",
    );
    return [
      structure.sharedContext,
      "",
      sharedSection,
      "",
      privateSection,
      "",
      ...citationFooter,
      `Visible units this turn: ${packet.map((u) => u.id).join(", ") || "(none)"}.`,
    ].join("\n");
  };

  const problemTextA = formatAgentView("agent_a", split.agentAIds);
  const problemTextB = formatAgentView("agent_b", split.agentBIds);

  const hpWarnings: string[] = [];
  if (treatment) {
    hpWarnings.push(`hidden_profile_condition=${treatment.condition}`);
    if (treatment.condition === "full") {
      hpWarnings.push(
        "FULL INFORMATION: all units visible to both agents (private promotion rate = 1).",
      );
    } else if (treatment.condition === "authored_distributed") {
      hpWarnings.push(
        "AUTHORED DISTRIBUTED: original HiddenBench private packets; no private units promoted.",
      );
    } else {
      hpWarnings.push(
        `PARTIAL PROMOTION: A ${treatment.promotedAtoSharedCount}/${treatment.authoredAPrivateCount} ` +
          `B ${treatment.promotedBtoSharedCount}/${treatment.authoredBPrivateCount} ` +
          `originally-private units promoted to shared (rate=${treatment.privatePromotionRate}).`,
      );
    }
  }

  const assignment: InformationAssignment = {
    overlapRequested: split.overlapRequested,
    overlapRealized: split.overlapRealized,
    totalUnits: split.totalUnits,
    sharedUnitIds: split.sharedIds,
    agentAOnlyUnitIds: split.agentAOnlyIds,
    agentBOnlyUnitIds: split.agentBOnlyIds,
    agentAUnitIds: split.agentAIds,
    agentBUnitIds: split.agentBIds,
    agentAPacketText: problemTextA,
    agentBPacketText: problemTextB,
    sharedContextText: structure.sharedContext,
    units: unitsWithRealized,
    splitSeed: args.splitSeed,
    assignmentMode: args.assignmentMode ?? "balanced-cover",
    packetDirection: direction,
    ...(treatment
      ? {
          hiddenProfileTreatment: treatment,
          originalSharedIds: treatment.originalSharedIds,
          originalAPrivateIds: treatment.originalAPrivateIds,
          originalBPrivateIds: treatment.originalBPrivateIds,
          promotedFromAToSharedIds: treatment.promotedFromAToSharedIds,
          promotedFromBToSharedIds: treatment.promotedFromBToSharedIds,
          realizedSharedIds: treatment.realizedSharedIds,
          realizedAPrivateIds: treatment.realizedAPrivateIds,
          realizedBPrivateIds: treatment.realizedBPrivateIds,
        }
      : {}),
    diagnostics: {
      unionCoverage: validation.ok ? 1 : 0,
      packetSizeA: split.agentAIds.length,
      packetSizeB: split.agentBIds.length,
      privateCountA: split.agentAOnlyIds.length,
      privateCountB: split.agentBOnlyIds.length,
      sharedCount: split.sharedIds.length,
      missingRequiredUnitIds: unitIds.filter(
        (id) => !split.agentAIds.includes(id) && !split.agentBIds.includes(id),
      ),
      warnings: [...validation.warnings, ...hpWarnings],
      jointlySufficient: validation.ok,
    },
  };

  return {
    assignment,
    problemTextA,
    problemTextB,
    sharedContext: structure.sharedContext,
  };
}

/**
 * Build the split seed for one problem within a run draw.
 * Policy values must never enter this seed.
 *
 * For Hidden Profile nesting across overlap levels, pass
 * `nestAcrossOverlap: true` (omits o= from the seed) or use
 * `buildHiddenProfilePromotionSeed` separately.
 */
export function buildInformationSplitSeed(args: {
  problemId: string;
  overlapRequested: number;
  /** Random nonce drawn once per run (or per conversation). */
  drawNonce: string;
  /** When true, omit overlap so HP promotion order nests across o. */
  nestAcrossOverlap?: boolean;
}): string {
  const nonce = args.drawNonce.trim() || "draw";
  if (args.nestAcrossOverlap) {
    return buildHiddenProfilePromotionSeed({
      problemId: args.problemId,
      drawNonce: nonce,
    });
  }
  const overlap = args.overlapRequested.toFixed(2);
  return `info-split|${args.problemId}|o=${overlap}|draw=${nonce}`;
}

/** Fresh random nonce for one run's information partition draw. */
export function createInformationDrawNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
}
