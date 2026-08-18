import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emptyRunTree,
  parseRunTree,
  type RunTree,
} from "../src/experiment/runTree.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, ".data");
const TREE_PATH = path.join(DATA_DIR, "run-tree.json");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * File-backed inspector folder tree. Independent of `runs.json`.
 */
export class RunTreePersistence {
  private cache: RunTree | null = null;

  load(): RunTree {
    if (this.cache) return this.cache;
    ensureDataDir();
    if (!existsSync(TREE_PATH)) {
      this.cache = emptyRunTree();
      return this.cache;
    }
    try {
      const raw = readFileSync(TREE_PATH, "utf8");
      this.cache = parseRunTree(JSON.parse(raw) as unknown);
    } catch {
      this.cache = emptyRunTree();
    }
    return this.cache;
  }

  save(tree: RunTree): void {
    ensureDataDir();
    const next = parseRunTree(tree);
    this.cache = next;
    const tmp = `${TREE_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    renameSync(tmp, TREE_PATH);
  }

  update(mutator: (tree: RunTree) => RunTree): RunTree {
    const next = mutator(this.load());
    this.save(next);
    return next;
  }
}

let singleton: RunTreePersistence | undefined;

export function getRunTreePersistence(): RunTreePersistence {
  if (!singleton) singleton = new RunTreePersistence();
  return singleton;
}
