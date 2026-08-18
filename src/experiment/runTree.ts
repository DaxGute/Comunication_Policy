/**
 * Inspector run-tree: folders plus ordered run refs, independent of run records.
 *
 * Missing runs are prepended at the root (newest-first list order). Deleted runs
 * are pruned. Folder delete hoists children into the parent.
 */
import { createId } from "../lib/id";

export type RunTreeRunRef = {
  type: "run";
  runId: string;
};

export type RunTreeFolder = {
  type: "folder";
  id: string;
  title: string;
  children: RunTreeNode[];
};

export type RunTreeNode = RunTreeRunRef | RunTreeFolder;

export type RunTree = {
  root: RunTreeNode[];
};

export type DraggedTreeItem =
  | { kind: "run"; runId: string }
  | { kind: "folder"; folderId: string };

export type DropTarget =
  | { placement: "inside"; folderId: string }
  | { placement: "before"; item: DraggedTreeItem }
  | { placement: "after"; item: DraggedTreeItem }
  | { placement: "end"; parentFolderId: string | null };

export function emptyRunTree(): RunTree {
  return { root: [] };
}

export function sameRunTree(a: RunTree, b: RunTree): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function parseRunTree(raw: unknown): RunTree {
  if (!raw || typeof raw !== "object") return emptyRunTree();
  const root = (raw as { root?: unknown }).root;
  if (!Array.isArray(root)) return emptyRunTree();
  const seen = new Set<string>();
  return { root: parseNodes(root, seen) };
}

function parseNodes(raw: unknown[], seen: Set<string>): RunTreeNode[] {
  const nodes: RunTreeNode[] = [];
  const folderIds = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.type === "run" && typeof rec.runId === "string" && rec.runId) {
      if (seen.has(rec.runId)) continue;
      seen.add(rec.runId);
      nodes.push({ type: "run", runId: rec.runId });
      continue;
    }
    if (rec.type === "folder" && typeof rec.id === "string" && rec.id) {
      if (folderIds.has(rec.id)) continue;
      folderIds.add(rec.id);
      const title =
        typeof rec.title === "string" && rec.title.trim()
          ? rec.title.trim()
          : "Untitled folder";
      const children = Array.isArray(rec.children)
        ? parseNodes(rec.children, seen)
        : [];
      nodes.push({ type: "folder", id: rec.id, title, children });
    }
  }
  return nodes;
}

export function collectRunIds(nodes: RunTreeNode[]): string[] {
  const ids: string[] = [];
  walk(nodes, (node) => {
    if (node.type === "run") ids.push(node.runId);
  });
  return ids;
}

export function ancestorFolderIds(
  tree: RunTree,
  runId: string,
): string[] {
  const path: string[] = [];
  function search(nodes: RunTreeNode[], trail: string[]): boolean {
    for (const node of nodes) {
      if (node.type === "run" && node.runId === runId) {
        path.push(...trail);
        return true;
      }
      if (node.type === "folder") {
        if (search(node.children, [...trail, node.id])) return true;
      }
    }
    return false;
  }
  search(tree.root, []);
  return path;
}

export function countDescendantRuns(node: RunTreeFolder): number {
  let n = 0;
  walk(node.children, (child) => {
    if (child.type === "run") n += 1;
  });
  return n;
}

export function reconcileRunTree(
  tree: RunTree,
  orderedRunIds: string[],
): RunTree {
  const known = new Set(orderedRunIds);
  const present = new Set<string>();

  function prune(nodes: RunTreeNode[]): RunTreeNode[] {
    const out: RunTreeNode[] = [];
    for (const node of nodes) {
      if (node.type === "run") {
        if (!known.has(node.runId) || present.has(node.runId)) continue;
        present.add(node.runId);
        out.push(node);
        continue;
      }
      out.push({ ...node, children: prune(node.children) });
    }
    return out;
  }

  const root = prune(tree.root);
  const missing = orderedRunIds.filter((id) => !present.has(id));
  if (missing.length === 0) return { root };
  const prepend: RunTreeRunRef[] = missing.map((runId) => ({
    type: "run",
    runId,
  }));
  return { root: [...prepend, ...root] };
}

export function prependRunToTree(tree: RunTree, runId: string): RunTree {
  if (collectRunIds(tree.root).includes(runId)) return tree;
  return {
    root: [{ type: "run", runId }, ...tree.root],
  };
}

export function removeRunFromTree(tree: RunTree, runId: string): RunTree {
  const next = cloneTree(tree);
  const loc = findNode(next.root, (n) => n.type === "run" && n.runId === runId);
  if (!loc) return tree;
  loc.siblings.splice(loc.index, 1);
  return next;
}

export function insertFolder(
  tree: RunTree,
  title = "Untitled folder",
  parentFolderId?: string,
): { tree: RunTree; folder: RunTreeFolder } {
  const folder: RunTreeFolder = {
    type: "folder",
    id: createId("folder"),
    title: title.trim() || "Untitled folder",
    children: [],
  };
  const next = cloneTree(tree);
  if (!parentFolderId) {
    next.root.unshift(folder);
    return { tree: next, folder };
  }
  const loc = findNode(
    next.root,
    (n) => n.type === "folder" && n.id === parentFolderId,
  );
  if (!loc || loc.siblings[loc.index]?.type !== "folder") {
    next.root.unshift(folder);
    return { tree: next, folder };
  }
  (loc.siblings[loc.index] as RunTreeFolder).children.unshift(folder);
  return { tree: next, folder };
}

export function renameFolder(
  tree: RunTree,
  folderId: string,
  title: string,
): RunTree {
  const nextTitle = title.trim();
  if (!nextTitle) return tree;
  const next = cloneTree(tree);
  const loc = findNode(
    next.root,
    (n) => n.type === "folder" && n.id === folderId,
  );
  if (!loc || loc.siblings[loc.index]?.type !== "folder") return tree;
  (loc.siblings[loc.index] as RunTreeFolder).title = nextTitle;
  return next;
}

/** Remove the folder and hoist its children into the parent list. */
export function deleteFolder(tree: RunTree, folderId: string): RunTree {
  const next = cloneTree(tree);
  const loc = findNode(
    next.root,
    (n) => n.type === "folder" && n.id === folderId,
  );
  if (!loc) return tree;
  const [removed] = loc.siblings.splice(loc.index, 1);
  if (removed?.type === "folder") {
    loc.siblings.splice(loc.index, 0, ...removed.children);
  }
  return next;
}

export function moveTreeItem(
  tree: RunTree,
  dragged: DraggedTreeItem,
  target: DropTarget,
): RunTree {
  if (!isValidMove(tree, dragged, target)) return tree;

  const next = cloneTree(tree);
  const source = findNode(next.root, itemPredicate(dragged));
  if (!source) return tree;
  const [removed] = source.siblings.splice(source.index, 1);
  if (!removed) return tree;

  const dest = resolveDropSiblings(next, target);
  if (!dest) {
    // Target vanished (shouldn't happen); put the node back.
    source.siblings.splice(source.index, 0, removed);
    return tree;
  }
  dest.siblings.splice(dest.index, 0, removed);
  return next;
}

export function isValidMove(
  tree: RunTree,
  dragged: DraggedTreeItem,
  target: DropTarget,
): boolean {
  if (isSameDrop(dragged, target)) return false;
  if (dragged.kind === "folder" && wouldNestInSelf(tree, dragged.folderId, target)) {
    return false;
  }
  return true;
}

function isSameDrop(dragged: DraggedTreeItem, target: DropTarget): boolean {
  if (target.placement === "inside") {
    return dragged.kind === "folder" && dragged.folderId === target.folderId;
  }
  if (target.placement === "before" || target.placement === "after") {
    return sameItem(dragged, target.item);
  }
  return false;
}

function wouldNestInSelf(
  tree: RunTree,
  folderId: string,
  target: DropTarget,
): boolean {
  if (target.placement === "inside") {
    return (
      target.folderId === folderId ||
      isFolderInside(tree, folderId, target.folderId)
    );
  }
  if (target.placement === "end") {
    return (
      target.parentFolderId === folderId ||
      (target.parentFolderId != null &&
        isFolderInside(tree, folderId, target.parentFolderId))
    );
  }
  return isItemInsideFolder(tree, folderId, target.item);
}

function isItemInsideFolder(
  tree: RunTree,
  folderId: string,
  item: DraggedTreeItem,
): boolean {
  const loc = findNode(
    tree.root,
    (n) => n.type === "folder" && n.id === folderId,
  );
  if (!loc || loc.siblings[loc.index]?.type !== "folder") return false;
  const folder = loc.siblings[loc.index] as RunTreeFolder;
  let found = false;
  walk(folder.children, (node) => {
    if (item.kind === "run" && node.type === "run" && node.runId === item.runId) {
      found = true;
    }
    if (
      item.kind === "folder" &&
      node.type === "folder" &&
      node.id === item.folderId
    ) {
      found = true;
    }
  });
  return found;
}

function isFolderInside(
  tree: RunTree,
  ancestorId: string,
  folderId: string,
): boolean {
  const loc = findNode(
    tree.root,
    (n) => n.type === "folder" && n.id === ancestorId,
  );
  if (!loc || loc.siblings[loc.index]?.type !== "folder") return false;
  const folder = loc.siblings[loc.index] as RunTreeFolder;
  let found = false;
  walk(folder.children, (node) => {
    if (node.type === "folder" && node.id === folderId) found = true;
  });
  return found;
}

function resolveDropSiblings(
  tree: RunTree,
  target: DropTarget,
): { siblings: RunTreeNode[]; index: number } | undefined {
  if (target.placement === "inside") {
    const loc = findNode(
      tree.root,
      (n) => n.type === "folder" && n.id === target.folderId,
    );
    if (!loc || loc.siblings[loc.index]?.type !== "folder") return undefined;
    const folder = loc.siblings[loc.index] as RunTreeFolder;
    return { siblings: folder.children, index: folder.children.length };
  }
  if (target.placement === "end") {
    if (target.parentFolderId == null) {
      return { siblings: tree.root, index: tree.root.length };
    }
    const loc = findNode(
      tree.root,
      (n) => n.type === "folder" && n.id === target.parentFolderId,
    );
    if (!loc || loc.siblings[loc.index]?.type !== "folder") return undefined;
    const folder = loc.siblings[loc.index] as RunTreeFolder;
    return { siblings: folder.children, index: folder.children.length };
  }
  const loc = findNode(tree.root, itemPredicate(target.item));
  if (!loc) return undefined;
  const index = target.placement === "after" ? loc.index + 1 : loc.index;
  return { siblings: loc.siblings, index };
}

function itemPredicate(
  item: DraggedTreeItem,
): (node: RunTreeNode) => boolean {
  return (node) =>
    item.kind === "run"
      ? node.type === "run" && node.runId === item.runId
      : node.type === "folder" && node.id === item.folderId;
}

function sameItem(a: DraggedTreeItem, b: DraggedTreeItem): boolean {
  if (a.kind === "run" && b.kind === "run") return a.runId === b.runId;
  if (a.kind === "folder" && b.kind === "folder") {
    return a.folderId === b.folderId;
  }
  return false;
}

type NodeLocation = {
  siblings: RunTreeNode[];
  index: number;
};

function findNode(
  nodes: RunTreeNode[],
  predicate: (node: RunTreeNode) => boolean,
): NodeLocation | undefined {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (predicate(node)) return { siblings: nodes, index: i };
    if (node.type === "folder") {
      const nested = findNode(node.children, predicate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function walk(nodes: RunTreeNode[], visit: (node: RunTreeNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "folder") walk(node.children, visit);
  }
}

function cloneTree(tree: RunTree): RunTree {
  return structuredClone(tree) as RunTree;
}
