# TheoremQA raw data

Source: [TIGER-Lab/TheoremQA](https://huggingface.co/datasets/TIGER-Lab/TheoremQA) (MIT).

The full test JSON is **not** committed. A curated evaluation subset is vendored at:

```text
src/problems/data/theoremqa_subset.json
```

## Regenerate the subset

```bash
curl -L "https://raw.githubusercontent.com/TIGER-AI-Lab/TheoremQA/main/theoremqa_test.json" \
  -o data/proof/theoremqa_test.json

npm run curate:proof
npm run test:proof-grader
```
