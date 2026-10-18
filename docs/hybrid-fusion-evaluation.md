# Hybrid fusion experiment

## Decision

On 2026-10-18, the current hybrid merge outperformed a direct RRF replacement on this small public-source evaluation. Matching RRF's top score to the current merge's top score recovered most of the loss, but did not establish an overall improvement. Keep production defaults unchanged. This experiment does not justify adding a remote reranking service.

The benchmark-only implementation lives in [hybrid-fusion-benchmark.mjs](../scripts/hybrid-fusion-benchmark.mjs). Neither CLI nor MCP exposes a new fusion setting. No dependencies or provider settings were changed.

## Method

[RRF](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion) adds `1 / (k + rank)` for each channel containing a chunk. This experiment uses equal channel weights, one-based ranks and `k = 60`. The current production merge uses vector distance/rank and keyword score/rank contributions.

For each query, request one query embedding and retrieve the same 16 vector and 16 keyword candidates once. Each merge keeps at most 24 unique chunks; evaluate the first 8 chunks before and after the existing code-aware reranker. The reranker uses identical default weights and the same database for every variant.

Compare:

- **Keyword:** existing local keyword search with default code-aware reranking.
- **Current:** existing production hybrid merge.
- **RRF:** rank-only fusion with its original score scale.
- **Scaled RRF:** multiply all RRF scores by `currentTopScore / rrfTopScore` before reranking. This preserves RRF order and isolates some sensitivity to base-score scale; it is not a calibrated replacement for the existing scoring model.

Report file-level Hit@1/3/5 and reciprocal rank, deduplicating paths after the chunk cutoff. A hit means any labeled expected file appears at that rank; it does not establish that the returned snippet contains the exact implementation. A missing expected file contributes zero, not a skipped case. Raw results have no code-aware candidate additions; reranked results may include the production reranker's exact declarations and source counterparts.

All 48 manually labeled queries were fixed before retrieval: 16 identifiers, 16 natural-language queries and 16 paraphrases. Cases stay outside the indexed target to avoid indexing the benchmark questions themselves. [The manifest](../benchmarks/hybrid-fusion-cases.json) records commits, source subtrees and expected paths.

| Public repository | Indexed subtree | Files | Chunks |
| --- | --- | ---: | ---: |
| pallets/flask | `src/flask` | 26 | 106 |
| fastify/fastify | `lib` | 31 | 83 |
| BurntSushi/ripgrep | `crates/globset` | 11 | 39 |
| pocketbase/pocketbase | `tools/security` | 10 | 13 |

Snapshots were fetched from GitHub at the pinned commits, without installing dependencies or executing their code. All 241 chunks had embeddings matching the configured provider/endpoint/model/dimensions before evaluation. The model was `gemini-embedding-2`, 1536 dimensions, through the configured Gemini-compatible service. Only these public subtrees and benchmark queries were sent for embedding; the Scythe workspace was not embedded for this experiment.

Fastify's first two indexing attempts stopped with partial coverage. A one-chunk diagnostic and smaller batches completed the remaining vectors using the cache; no partial-coverage run was counted. Other suites also used single-chunk batches after that adjustment. The 48 evaluated query embeddings succeeded, with each vector shared by every fusion variant.

## Results

| Method / stage | Hit@1 | Hit@3 | Hit@5 | MRR |
| --- | ---: | ---: | ---: | ---: |
| Keyword, reranked | 70.83% | 87.50% | 91.67% | 0.7917 |
| Current, raw | 75.00% | 93.75% | 95.83% | 0.8455 |
| RRF, raw | 72.92% | 95.83% | 95.83% | 0.8403 |
| Current, reranked | 75.00% | 91.67% | 91.67% | 0.8299 |
| RRF, reranked | 70.83% | 85.42% | 87.50% | 0.7750 |
| Scaled RRF, reranked | 72.92% | 91.67% | 93.75% | 0.8247 |

Scaled RRF and raw RRF have identical pre-rerank ranks. After reranking, direct RRF improved 2 queries and regressed 9 versus current; scaled RRF improved 2 and regressed 3, with 43 ties. A change here means a change in the reciprocal rank of the first expected file, not a subjective quality judgment.

| Query type | Keyword MRR | Current MRR | RRF MRR | Scaled RRF MRR |
| --- | ---: | ---: | ---: | ---: |
| Identifier | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| Natural language | 0.8802 | 0.8958 | 0.8146 | 0.8906 |
| Paraphrase | 0.4948 | 0.5938 | 0.5104 | 0.5833 |

These results also show that reranking is not automatically beneficial: current raw results had higher MRR than current reranked results in this sample. Investigate the specific regressions before adjusting production weights; this experiment does not select new weights.

The shared query embedding took an average of 393 ms (range 319–738 ms). RRF itself adds no provider call and does not eliminate the hybrid query embedding cost. Per-case local timing is diagnostic only: one sequential run, cache effects, no repeated latency trial. Provider billing and end-to-end agent tokens/time were not measured.

## Reproduce from a source checkout

1. Build Scythe with `npm run build`.
2. Fetch each repository at the manifest's exact commit into a temporary directory. Keep only the listed subtree, preserving its repository-relative path. Do not put the cases or reports inside that directory. No target-project dependency installation is needed.
3. Write that repository's `cases` array from the manifest to an external JSON file. For example:

```bash
node --input-type=module -e 'import fs from "node:fs"; const m = JSON.parse(fs.readFileSync("benchmarks/hybrid-fusion-cases.json", "utf8")); console.log(JSON.stringify(m.repositories.find(r => r.name === "flask").cases, null, 2));' > /tmp/flask-fusion-cases.json
```

4. Check status, then create local metadata. Use existing protected embedding credentials and explicitly create vectors for this public-source snapshot:

```bash
node dist/command.js status --project /tmp/scythe-fusion/flask
node dist/command.js index --project /tmp/scythe-fusion/flask
node dist/command.js index --project /tmp/scythe-fusion/flask --embeddings --max-embedding-chunks 256 --embedding-batch-size 1
node scripts/hybrid-fusion-benchmark.mjs --project /tmp/scythe-fusion/flask --cases /tmp/flask-fusion-cases.json --output local/benchmark/fusion-flask.json
```

Repeat with the other manifest entries. The driver refuses missing/stale indexes, incomplete configured vector coverage and missing expected paths; provider errors fail the run instead of silently becoming keyword fallback. Raw local reports used for this record are under ignored `local/benchmark/fusion-*.json`; credentials, vectors and source copies are not committed. Embedding responses and timings can change on a later run.

## Limits and next evidence

This is an exploratory comparison of four small source subtrees, not four complete repositories. Labels were authored by the implementation agent, not independent users; multiple queries target the same four files per suite. Identifier cases are easy and the candidate pool is small. No Chinese queries, TypeScript-specific project, C#, C++, large monorepo, provider/model matrix or statistical significance claim is covered.

Keep the current merge. If future real queries expose hybrid ranking failures, expand the fixed cases with those failures and whole-repository distractors, then compare fusion and reranking separately. Scaled RRF's slightly higher Hit@5 does not establish that it is a better default when Hit@1 and MRR are lower.
