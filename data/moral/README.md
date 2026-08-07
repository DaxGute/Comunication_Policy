# Reddit Ethics raw data

Source: [agentlans/reddit-ethics](https://huggingface.co/datasets/agentlans/reddit-ethics) (CC-BY-4.0).

The full JSONL is **not** committed. A curated open-ended subset is vendored at:

```text
src/problems/data/reddit_ethics_subset.json
```

## Regenerate the subset

```bash
curl -L "https://huggingface.co/datasets/agentlans/reddit-ethics/resolve/main/train.jsonl.zst" \
  -o data/moral/train.jsonl.zst

zstd -d -f data/moral/train.jsonl.zst -o data/moral/train.jsonl
node scripts/curateMoralSubset.mjs
```
