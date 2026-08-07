# CrossWordBench raw data

Source: [CrossWordBenchEval/CrossWordBench](https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench)

Paper: [arXiv:2504.00043](https://arxiv.org/abs/2504.00043)

The full English 7×7 parquet is **not** committed (~47MB / 100 puzzles with images). A curated evaluation subset of complete puzzles is vendored at:

```text
src/problems/data/crosswordbench_subset.json
```

Each item is one full crossword (grid geometry + Across/Down clues + reference solution). CrosswordQA clue–answer pairs are **not** used for evaluation.

## Regenerate the subset

```bash
curl -L -o data/crossword/english_7x7.parquet \
  "https://huggingface.co/datasets/CrossWordBenchEval/CrossWordBench/resolve/main/english/7x7-00000-of-00001.parquet"

python3 -m venv .venv
.venv/bin/pip install pyarrow
npm run curate:crossword
```

## License / access notes

`CrossWordBenchEval/CrossWordBench` is publicly downloadable (ungated). The related `HINT-lab/CrossWordBench` mirror may require Hugging Face auth. Puzzle generation in the upstream project builds on [genxword](https://github.com/riverrun/genxword) (GPLv3); we only vendor a small derived evaluation subset of puzzle states.
