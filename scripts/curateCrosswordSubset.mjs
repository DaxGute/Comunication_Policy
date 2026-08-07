/**
 * Curate a compact CrossWordBench full-puzzle subset from the English 7x7 parquet.
 *
 * Source: CrossWordBenchEval/CrossWordBench (Hugging Face)
 *   https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench
 * Paper: https://arxiv.org/abs/2504.00043
 *
 * Requires Python + pyarrow (see data/crossword/README.md).
 *
 * Usage:
 *   node scripts/curateCrosswordSubset.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT = join(ROOT, "data/crossword/english_7x7.parquet");
const OUTPUT = join(ROOT, "src/problems/data/crosswordbench_subset.json");
const TARGET = 40;

const PY = `
import json, sys
from pathlib import Path

try:
    import pyarrow.parquet as pq
except ImportError:
    sys.stderr.write("pyarrow is required. Try: python3 -m venv .venv && .venv/bin/pip install pyarrow\\n")
    sys.exit(1)

input_path, output_path, target = sys.argv[1], sys.argv[2], int(sys.argv[3])
t = pq.read_table(input_path, columns=["id", "difficulty", "puzzle_state", "reference_answer"])

def empty_and_solution(grid):
    empty_rows, sol_rows = [], []
    for row in grid:
        e, s = [], []
        for cell in row:
            if cell in ("-", "#"):
                e.append("#"); s.append("#")
            else:
                e.append("."); s.append(str(cell).upper())
        empty_rows.append("".join(e))
        sol_rows.append("".join(s))
    return empty_rows, sol_rows

def build_clues(ps, ra):
    by_key = {}
    for word, clue, y, x, orient in ps["wordlist"]:
        direction = "across" if orient == 0 else "down"
        by_key.setdefault((direction, word.upper()), []).append({
            "clue": clue, "row": y, "col": x, "length": len(word), "answer": word.upper(),
        })
    starts = sorted({(y, x) for _, _, y, x, _ in ps["wordlist"]})
    numbering = {pos: i + 1 for i, pos in enumerate(starts)}
    clues = []
    for a in ra:
        direction, num_s = a["direction"].split()
        answer = a["answer"].upper()
        cands = by_key.get((direction, answer), [])
        if not cands:
            raise ValueError(f"missing geometry for {a}")
        match = next((c for c in cands if c["clue"] == a["clue"]), cands[0])
        number = int(num_s)
        expected_num = numbering[(match["row"], match["col"])]
        if expected_num != number:
            raise ValueError(f"number mismatch {a} expected {expected_num}")
        clues.append({
            "number": number,
            "direction": direction,
            "clue": a["clue"],
            "row": match["row"],
            "col": match["col"],
            "length": match["length"],
            "answer": answer,
        })
    clues.sort(key=lambda c: (0 if c["direction"] == "across" else 1, c["number"]))
    return clues

rows = []
for i in range(t.num_rows):
    source_id = int(t.column("id")[i].as_py())
    difficulty = t.column("difficulty")[i].as_py()
    ps = json.loads(t.column("puzzle_state")[i].as_py())
    ra = json.loads(t.column("reference_answer")[i].as_py())
    grid = ps["grid"]
    empty, solution = empty_and_solution(grid)
    try:
        clues = build_clues(ps, ra)
    except Exception as e:
        print(f"skip {source_id}: {e}", file=sys.stderr)
        continue
    rows.append({
        "sourceId": source_id,
        "difficulty": difficulty,
        "width": len(grid[0]),
        "height": len(grid),
        "grid": empty,
        "solution": solution,
        "clues": clues,
        "category": "english",
    })

rows.sort(key=lambda r: r["sourceId"])
if len(rows) > target:
    step = len(rows) / target
    selected = [rows[int(i * step)] for i in range(target)]
else:
    selected = rows

seen, deduped = set(), []
for item in selected:
    if item["sourceId"] in seen:
        continue
    seen.add(item["sourceId"])
    deduped.append(item)
selected = deduped[:target]

payload = {
    "source": {
        "name": "CrossWordBench",
        "huggingface": "CrossWordBenchEval/CrossWordBench",
        "config": "english",
        "split": "7x7",
        "paper": "CrossWordBench: Evaluating the Reasoning Capabilities of LLMs and LVLMs with Controllable Puzzle Generation (Leng et al., arXiv:2504.00043)",
        "url": "https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench",
        "paperUrl": "https://arxiv.org/abs/2504.00043",
        "note": "Vendored full-puzzle subset (English 7x7). Reference solutions stored for evaluation only and never included in agent prompts. CrosswordQA clue-pairs are not used.",
    },
    "curatedAt": __import__("datetime").date.today().isoformat(),
    "count": len(selected),
    "items": [{"id": f"crosswordbench_{str(i+1).zfill(4)}", **item} for i, item in enumerate(selected)],
}

Path(output_path).parent.mkdir(parents=True, exist_ok=True)
Path(output_path).write_text(json.dumps(payload, indent=2) + "\\n")
print(f"Wrote {payload['count']} puzzles → {output_path}")
`;

function resolvePython() {
  const candidates = [
    join(ROOT, ".venv/bin/python"),
    join(ROOT, ".venv-tmp/bin/python"),
    "python3",
    "python",
  ];
  for (const c of candidates) {
    if (c.includes("/") && !existsSync(c)) continue;
    const probe = spawnSync(c, ["-c", "import pyarrow"], { encoding: "utf8" });
    if (probe.status === 0) return c;
  }
  return null;
}

function main() {
  if (!existsSync(INPUT)) {
    console.error(`Missing ${INPUT}`);
    console.error(
      "Download with:\n  curl -L -o data/crossword/english_7x7.parquet \\\n    https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench/resolve/main/english/7x7-00000-of-00001.parquet",
    );
    process.exit(1);
  }

  const python = resolvePython();
  if (!python) {
    console.error(
      "Need Python with pyarrow. Example:\n  python3 -m venv .venv && .venv/bin/pip install pyarrow\n  node scripts/curateCrosswordSubset.mjs",
    );
    process.exit(1);
  }

  const result = spawnSync(python, ["-c", PY, INPUT, OUTPUT, String(TARGET)], {
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

main();
