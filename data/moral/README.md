# Reddit Ethics raw data

Source: [agentlans/reddit-ethics](https://huggingface.co/datasets/agentlans/reddit-ethics) (CC-BY-4.0).

The full JSONL is **not** committed. A curated open-ended subset is vendored at:

```text
src/problems/data/reddit_ethics_subset.json
```

Each item’s `description` is the **full source post** (`text` field), not the short
dataset summary. Gold answers / resolutions are still omitted from prompts.

## Regenerate the subset

```bash
curl -L "https://huggingface.co/datasets/agentlans/reddit-ethics/resolve/main/train.jsonl.zst" \
  -o data/moral/train.jsonl.zst

zstd -d -f data/moral/train.jsonl.zst -o data/moral/train.jsonl
node scripts/curateMoralSubset.mjs
```
