import type { TaskReasoningAdapter } from "../problems/adapters/types";
import type { Problem } from "../problems/types";
import type {
  ClaimSelector,
  ReasoningGraph,
  ReasoningIntent,
  ReasoningMove,
  ReasoningNode,
} from "./types";

export type CompileMovesContext = {
  problem: Problem;
  adapter: TaskReasoningAdapter;
  graph: ReasoningGraph;
};

export type CompiledMoves = {
  intents: ReasoningIntent[];
  diagnostics: string[];
};

function knownLabels(graph: ReasoningGraph): Map<string, string> {
  const map = new Map<string, string>();
  for (const subject of graph.subjects ?? []) {
    map.set(subject.label.trim().toLowerCase(), subject.id);
    map.set(subject.id.trim().toLowerCase(), subject.id);
  }
  return map;
}

export function resolveSubjectAlias(
  raw: string | undefined,
  ctx: CompileMovesContext,
): { id?: string; error?: string } {
  if (raw === undefined) return {};
  const trimmed = raw.trim();
  if (!trimmed) return { error: "subject is empty" };
  if (ctx.adapter.resolveSubject) {
    const adapted = ctx.adapter.resolveSubject(ctx.problem, trimmed);
    if (adapted.id || adapted.error) return adapted;
  }
  const labels = knownLabels(ctx.graph);
  const labeled = labels.get(trimmed.toLowerCase());
  if (labeled) return { id: labeled };
  if ((ctx.graph.subjects ?? []).some((subject) => subject.id === trimmed)) {
    return { id: trimmed };
  }
  const issue = ctx.graph.nodes.find(
    (node) => node.type === "issue" && node.id === trimmed,
  );
  if (issue) return { id: trimmed };
  return { error: `subject references unknown issue ${trimmed}` };
}

function liveClaimsFor(
  graph: ReasoningGraph,
  subjectId: string,
): ReasoningNode[] {
  return graph.nodes
    .filter(
      (node) =>
        (node.type === "claim" || node.type === "proposal") &&
        node.status !== "rejected" &&
        node.status !== "superseded" &&
        node.subjectId === subjectId,
    )
    .sort(
      (a, b) =>
        b.createdAtTurn - a.createdAtTurn || b.id.localeCompare(a.id),
    );
}

function previousClaimFor(
  graph: ReasoningGraph,
  subjectId: string,
): ReasoningNode | undefined {
  return graph.nodes
    .filter(
      (node) =>
        (node.type === "claim" || node.type === "proposal") &&
        node.subjectId === subjectId &&
        (node.status === "superseded" || node.status === "rejected"),
    )
    .sort(
      (a, b) =>
        b.createdAtTurn - a.createdAtTurn || b.id.localeCompare(a.id),
    )[0];
}

function parseClaimPhrase(raw: string): {
  subject?: string;
  selector?: ClaimSelector;
  nodeId?: string;
} {
  const trimmed = raw.trim();
  const current = trimmed.match(
    /^(?:the\s+)?(?:current|active|live)\s+(?:answer|claim|candidate)(?:\s+for)?\s+(.+)$/i,
  );
  if (current) return { subject: current[1]!.trim(), selector: "current" };
  const previous = trimmed.match(
    /^(?:the\s+)?(?:previous|prior|old)\s+(?:answer|claim|candidate)(?:\s+for)?\s+(.+)$/i,
  );
  if (previous) return { subject: previous[1]!.trim(), selector: "previous" };
  return { subject: trimmed, selector: "current" };
}

export function resolveClaimTarget(
  raw: string | undefined,
  ctx: CompileMovesContext,
  fallbackSubject?: string,
  selector: ClaimSelector = "current",
): { id?: string; subjectId?: string; error?: string } {
  if (raw?.trim()) {
    const trimmed = raw.trim();
    const node = ctx.graph.nodes.find((item) => item.id === trimmed);
    if (node) return { id: node.id, subjectId: node.type !== "final_answer" ? node.subjectId : undefined };
    const phrase = parseClaimPhrase(trimmed);
    const subject = resolveSubjectAlias(phrase.subject, ctx);
    if (subject.error) return { error: subject.error };
    return resolveClaimBySelector(ctx, subject.id, phrase.selector ?? selector);
  }
  if (fallbackSubject) {
    const subject = resolveSubjectAlias(fallbackSubject, ctx);
    if (subject.error) return { error: subject.error };
    return resolveClaimBySelector(ctx, subject.id, selector);
  }
  return { error: "missing claim target" };
}

function resolveClaimBySelector(
  ctx: CompileMovesContext,
  subjectId: string | undefined,
  selector: ClaimSelector,
): { id?: string; subjectId?: string; error?: string } {
  if (!subjectId) return { error: "missing claim target" };
  if (selector === "previous") {
    const previous = previousClaimFor(ctx.graph, subjectId);
    if (!previous) {
      return {
        error: `no previous claim for ${subjectId}`,
        subjectId,
      };
    }
    return { id: previous.id, subjectId };
  }
  const live = liveClaimsFor(ctx.graph, subjectId);
  if (live.length === 0) {
    return { error: `no current claim for ${subjectId}`, subjectId };
  }
  if (live.length > 1) {
    return {
      error: `ambiguous current claim for ${subjectId}: ${live.map((node) => node.id).join(", ")}`,
      subjectId,
    };
  }
  return { id: live[0]!.id, subjectId };
}

function claimText(subjectLabel: string | undefined, value: string): string {
  return subjectLabel ? `${subjectLabel} = ${value}` : value;
}

function subjectLabel(ctx: CompileMovesContext, subjectId?: string): string | undefined {
  if (!subjectId) return undefined;
  return (
    ctx.graph.subjects?.find((subject) => subject.id === subjectId)?.label ??
    subjectId
  );
}

function nextLocalId(index: number): string {
  return `basis_${index + 1}`;
}

function compileBasis(
  basis: string[] | undefined,
  ctx: CompileMovesContext,
  subjectId: string | undefined,
  intents: ReasoningIntent[],
  diagnostics: string[],
  localStart: number,
): { grounds: string[]; supports: string[]; errors: string[] } {
  const grounds: string[] = [];
  const supports: string[] = [];
  const errors: string[] = [];
  let created = localStart;
  for (const item of basis ?? []) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const existing = ctx.graph.nodes.find((node) => node.id === trimmed);
    if (existing) {
      grounds.push(existing.id);
      continue;
    }
    const local = intents.find(
      (intent) =>
        intent.action === "create" && intent.localId === trimmed,
    );
    if (local?.action === "create" && local.localId) {
      grounds.push(local.localId);
      continue;
    }
    const adapted = ctx.adapter.resolveBasis?.(ctx.problem, ctx.graph, trimmed, {
      subjectId,
    });
    if (adapted?.error) {
      errors.push(adapted.error);
      continue;
    }
    if (adapted?.id) {
      (adapted.relation === "supports" ? supports : grounds).push(adapted.id);
      continue;
    }
    if (adapted?.create) {
      const localId = nextLocalId(created);
      created += 1;
      intents.push({
        action: "create",
        nodeType: "evidence",
        text: adapted.create.text,
        subjectId: adapted.create.subjectId ?? subjectId,
        localId,
        metadata: {
          evidenceOrigin: adapted.create.origin,
          aliases: [adapted.create.alias, ...(adapted.create.aliases ?? [])],
          evidenceKind: adapted.create.kind,
        },
      });
      (adapted.relation === "supports" ? supports : grounds).push(localId);
      continue;
    }
    const localId = nextLocalId(created);
    created += 1;
    intents.push({
      action: "create",
      nodeType: "evidence",
      text: trimmed,
      subjectId,
      localId,
      metadata: { evidenceOrigin: "agent" },
    });
    grounds.push(localId);
    diagnostics.push(`created agent evidence from basis "${trimmed}"`);
  }
  return { grounds, supports, errors };
}

function compileMove(
  move: ReasoningMove,
  ctx: CompileMovesContext,
  intents: ReasoningIntent[],
  diagnostics: string[],
): void {
  if (move.kind === "evidence") {
    const subject = resolveSubjectAlias(move.subject, ctx);
    if (subject.error && move.subject) {
      intents.push({ action: "invalid", raw: { ...move, error: subject.error } });
      return;
    }
    intents.push({
      action: "create",
      nodeType: "evidence",
      text: move.text,
      subjectId: subject.id,
      metadata: {
        evidenceOrigin: "agent",
        source: move.source,
      },
    });
    return;
  }

  if (move.kind === "claim") {
    const subject = resolveSubjectAlias(move.subject, ctx);
    if (move.subject && subject.error) {
      intents.push({ action: "invalid", raw: { ...move, error: subject.error } });
      return;
    }
    if (ctx.adapter.requireSubjectOnClaims && !subject.id) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: "claim is missing a resolvable subject" },
      });
      return;
    }
    const value = (move.value ?? move.text ?? "").trim();
    if (!value) {
      intents.push({ action: "invalid", raw: move });
      return;
    }
    const text = move.text?.trim() || claimText(subjectLabel(ctx, subject.id), value);
    const basis = compileBasis(move.basis, ctx, subject.id, intents, diagnostics, intents.length);
    if (basis.errors.length > 0) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: basis.errors.join("; ") },
      });
      return;
    }
    const live = subject.id ? liveClaimsFor(ctx.graph, subject.id) : [];
    if (live.length === 1) {
      diagnostics.push(`promoted_claim_to_revise:${live[0]!.id}`);
      intents.push({
        action: "revise",
        targetId: live[0]!.id,
        nodeType: "claim",
        text,
        subjectId: subject.id,
        groundsNodeIds: basis.grounds,
        supportsNodeIds: basis.supports,
        metadata: { answer: value },
      });
      return;
    }
    intents.push({
      action: "create",
      nodeType: "claim",
      text,
      subjectId: subject.id,
      groundsNodeIds: basis.grounds,
      supportsNodeIds: basis.supports,
      metadata: { answer: value },
    });
    return;
  }

  if (move.kind === "revise") {
    const target = resolveClaimTarget(
      move.claim,
      ctx,
      move.subject,
      move.selector ?? "current",
    );
    if (target.error && !target.id) {
      if (move.subject && target.error.startsWith("no current claim")) {
        const fallback: ReasoningMove = {
          kind: "claim",
          subject: move.subject,
          value: move.value,
          text: move.text,
          basis: move.basis,
        };
        compileMove(fallback, ctx, intents, diagnostics);
        return;
      }
      intents.push({ action: "invalid", raw: { ...move, error: target.error } });
      return;
    }
    const value = (move.value ?? move.text ?? "").trim();
    if (!value) {
      intents.push({ action: "invalid", raw: move });
      return;
    }
    const text =
      move.text?.trim() ||
      claimText(subjectLabel(ctx, target.subjectId), value);
    const basis = compileBasis(
      move.basis,
      ctx,
      target.subjectId,
      intents,
      diagnostics,
      intents.length,
    );
    if (basis.errors.length > 0) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: basis.errors.join("; ") },
      });
      return;
    }
    intents.push({
      action: "revise",
      targetId: target.id,
      nodeType: "claim",
      text,
      subjectId: target.subjectId,
      groundsNodeIds: basis.grounds,
      supportsNodeIds: basis.supports,
      metadata: { answer: value },
    });
    return;
  }

  if (move.kind === "agree") {
    const target = resolveClaimTarget(move.claim, ctx, move.subject, "current");
    if (!target.id) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: target.error ?? "agree is missing a unique current claim" },
      });
      return;
    }
    intents.push({
      action: "accept",
      targetId: target.id,
      subjectId: target.subjectId,
    });
    return;
  }

  if (move.kind === "disagree") {
    const target = resolveClaimTarget(move.claim, ctx, move.subject, "current");
    if (!target.id) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: target.error ?? "disagree is missing a unique current claim" },
      });
      return;
    }
    const basis = compileBasis(
      move.basis,
      ctx,
      target.subjectId,
      intents,
      diagnostics,
      intents.length,
    );
    if (basis.errors.length > 0) {
      intents.push({
        action: "invalid",
        raw: { ...move, error: basis.errors.join("; ") },
      });
      return;
    }
    const source = basis.grounds[0] ?? basis.supports[0];
    intents.push({
      action: "challenge",
      targetId: target.id,
      sourceNodeId: source,
      subjectId: target.subjectId,
    });
    return;
  }

  const target = resolveClaimTarget(move.target, ctx, move.subject, "current");
  if (!target.id) {
    intents.push({
      action: "invalid",
      raw: { ...move, error: target.error ?? `${move.kind} is missing a target` },
    });
    return;
  }
  intents.push({
    action: move.kind,
    targetId: target.id,
    sourceNodeId: move.source,
    reason: move.reason,
    subjectId: target.subjectId,
  });
}

export function compileReasoningMoves(
  moves: ReasoningMove[],
  ctx: CompileMovesContext,
): CompiledMoves {
  const intents: ReasoningIntent[] = [];
  const diagnostics: string[] = [];
  for (const move of moves) {
    compileMove(move, ctx, intents, diagnostics);
  }
  return { intents, diagnostics };
}
