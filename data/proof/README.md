# Proof raw data

Primary source: [WilhelmH/proofsolver-1300](https://huggingface.co/datasets/WilhelmH/proofsolver-1300) (MIT).

The full train JSONL is **not** committed. A curated evaluation subset is vendored at:

```text
src/problems/data/proofsolver_subset.json
```

## Regenerate the subset

```bash
curl -L "https://huggingface.co/datasets/WilhelmH/proofsolver-1300/resolve/main/data/train.jsonl" \
  -o data/proof/proofsolver_train.jsonl

npm run curate:proof
npm run test:proof-grader
```

Optional legacy TheoremQA files in this folder are unused by the app.
