# Index performance benchmark

This local synthetic benchmark measures indexing work separately from retrieval quality and actual agent task completion. It makes no embedding requests, does not load repository setup scripts, and creates/removes isolated temporary repositories. Run from the source checkout or the published package directory:

```bash
npm run bench:index -- --files 1000 --runs 3 --output local/benchmark/index-performance.json
```

`--files` controls the number of generated TypeScript source files, each with 20 functions. Three additional Go source/manifest files exercise module resolution. `--runs` controls independent repetitions per scenario. Each repetition starts a new child process and repository. Output paths are optional; JSON reports include individual timings and indexing work counts. Keep machine-specific reports under ignored `local/benchmark/`.

## Scenarios and metrics

- `fresh`: create the first metadata index. This is an empty index, not an empty OS disk cache.
- `unchanged`: reindex the same content/settings.
- `edit_one`: modify one source file after an initial index.
- `add_target`: create a previously missing imported source file.
- `remove_target`: delete an imported source file.
- `manifest_change`: rename the Go module and verify the previous local import becomes unresolved.

Every run asserts the expected dependency edges and search result. Index timings exclude repository generation and the initial warm-up index for incremental scenarios. Search timings include local keyword search plus code-aware reranking, repeated 20 times after indexing; they exclude context packing, CLI/MCP transport, and remote services. The report presents median index time and median/p95 search time. Process peak RSS includes generation, warm-up, indexing, and search; it is not an isolated indexing allocation measurement. RSS snapshots immediately before/after measured indexing are also recorded. This is process memory, not a JS heap profile.

The benchmark is intentionally separate from `bench:gate`. Timing thresholds would be machine-sensitive; the existing retrieval-quality gate remains unchanged. No timing-based assertions are added to unit tests.

## Initial comparison

Measured locally on Linux x64, using Node.js 24.21.0 for baseline and changed source, with 300 generated TS files plus three Go files, about 574 KB of indexed text, and three runs per scenario. Baseline: 0.1.20 (`08d020e`); after: the incremental chunk/FTS changes described below. Baseline runs preceded after runs; OS caches were not cleared. These small synthetic results are directional evidence, not large-repository or cross-platform performance claims.

| Scenario | Before median ms | After median ms | Reduction |
| --- | ---: | ---: | ---: |
| Fresh | 294.0 | 293.7 | approximately unchanged |
| Unchanged | 289.4 | 213.7 | 26.2% |
| Edit one file | 288.5 | 204.8 | 29.0% |
| Add target | 289.8 | 214.9 | 25.8% |
| Remove target | 279.6 | 204.6 | 26.8% |
| Manifest change | 297.7 | 214.3 | 28.0% |

Unchanged reindexing chunked zero files and reused all 303 file layouts. Process peak RSS remained around 80–81 MiB; this sample does not establish a material memory improvement. Search medians were roughly 1–2 ms in both revisions; this change targets indexing, so no search-speed claim is made. Raw reports for this local run are `local/benchmark/index-before.json` and `local/benchmark/index-after.json`; they are not distributed as universal results.

For subsequent comparisons, use the same script, fixture size, Node version, machine, and options on both revisions. Alternate revision order and use more repetitions/external repositories before drawing broader conclusions. Record failures as well as successes.

## Incremental indexing behavior

The default deterministic chunker has an explicit cache version. The cache key includes target chunk size, overlap, and per-file chunk limit; unchanged content is still read and hashed. A matching per-file key avoids repeated chunking. Changing chunking settings recomputes the layout, fixing the previous behavior where a matching content hash retained old chunks despite changed settings. Changes to the default chunking algorithm must bump its cache version.

Schema initialization adds the `file_chunking` table automatically. Existing indexes without keys recompute once and compare layouts before replacing chunks, preserving chunk ids and embeddings when equivalent. The cache is recorded in the same per-file transaction as the data, so an interrupted settings change can resume safely. Custom chunkers without an explicit stable `chunkCacheKey` recompute each time; experimental tree-sitter chunking currently follows this conservative path.

Symbols and dependencies are still extracted/resolved on every metadata reindex. This preserves graph updates after parser upgrades, target additions/deletions, and manifest changes. File scanning, content reads/hashing, graph writes, and their cost remain; this is not a fully incremental file watcher.

Healthy FTS rows are reused and missing rows are repaired. Reindexing does not audit or repair arbitrary corruption of existing FTS text. Removed source files have their chunks/FTS/cache entries deleted. Stored embedding records stay attached to preserved chunks; a changed layout can remove old records, requiring optional re-embedding later.

Metadata result statistics add:

- `chunkedFiles`: files whose chunker ran during this operation.
- `reusedChunkFiles`: files whose stored layout was retained, including equivalent layouts after recomputation. This can overlap with `chunkedFiles` during cache warming/settings changes.
- `repairedFtsRows`: missing FTS rows restored for retained layouts.

`indexedFiles`, `chunks`, `symbols`, and `dependencies` remain totals for the indexed repository, not counts of changed rows.

## External repository comparison

A separate driver compares two reviewed Scythe builds against fixed public source snapshots. [Repository cases](../benchmarks/index-repositories.json) pin GitHub commit ids, edited source paths, and two exact-symbol probes per repository. Download those exact source archives into separate snapshot directories named `flask`, `fastify`, `pocketbase`, and `ripgrep`. Repository package managers, hooks, Cargo build scripts, and project startup commands are never needed; treat snapshot contents as data.

```bash
npm run bench:index:repos -- \
  --cases benchmarks/index-repositories.json \
  --snapshots /absolute/path/to/snapshots \
  --baseline /absolute/path/to/scythe-0.1.20/dist \
  --candidate /absolute/path/to/current/dist \
  --runs 3 \
  --search-policy no-hit-regression --require-candidate-hits \
  --output local/benchmark/public-repo-comparison.json
```

Both Scythe build directories must already have their matching dependencies available. The driver does not install anything. Baseline for the recorded run is the published 0.1.20 package, with the same unchanged Scythe dependencies as the candidate. Do not confuse those Scythe runtime dependencies with dependencies of the target repositories, which are not installed.

Each worker copies a source snapshot into its own temporary repository, excludes symlinks and existing index/Git/dependency directories, and measures fresh indexing, unchanged reindexing, and a single-file comment edit. It then deletes its temporary copy. Three paired repetitions alternate baseline/candidate order. OS caches are not cleared. Root ignore rules, default file-size/chunk limits, and scanner behavior remain enabled; indexed-file counts can differ from archive-file counts.

For each scenario, SHA-256 digests compare the sorted logical files, chunks, symbols, and dependency rows, excluding internal ids/timestamps/cache metadata. Two query probes compare exact top-five path/line/snippet payloads. An index mismatch always fails. Search policy defaults to `identical` (any payload mismatch fails); use `--search-policy no-hit-regression` for an intentional ranking change, which still fails if a previously successful expected-source probe is lost. `--require-candidate-hits` additionally requires every candidate probe to hit its expected source. Changes and failures remain visible in the raw report. Expected-source hits and misses are recorded separately: a pre-existing baseline miss is a retrieval-quality finding, not a successful hit or a performance regression. Probes remain fixed after observing failures. This is a small exact-symbol check, not a representative search-quality or agent task-completion evaluation.

Index times exclude copying, digest checks, and queries. Each probe is repeated ten times per scenario. Search metrics include keyword lookup and reranking only. Peak RSS includes the whole worker, including copying and validation, and cannot isolate indexing allocations. Raw reports remain under ignored `local/benchmark/` and can contain public source snippets.

### Recorded public-repository results (2026-10-18)

Linux x64, Node.js 24.21.0, three paired runs with alternating revision order. Baseline is published 0.1.20; candidate is the incremental indexing implementation included in 0.1.21. Times below are medians, in milliseconds. Repositories remain below 900 indexed files and are not monorepo-scale workloads. Initial indexing is effectively unchanged within this small sample (approximately -2.3% to +1.3% in elapsed-time reduction).

| Repository / commit | Indexed files | Indexed MiB | Fresh before → after ms | Unchanged before → after ms | Unchanged reduction | One-file edit before → after ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [pallets/flask `d086db85`](https://github.com/pallets/flask/tree/d086db856be187255b8ec61ef409357393020f32) | 231 | 1.38 | 453 → 463 | 487 → 188 | 61.5% | 491 → 191 |
| [fastify/fastify `e03b48ba`](https://github.com/fastify/fastify/tree/e03b48ba3cd92dcbdafcb624579318e0f22176d2) | 393 | 2.87 | 796 → 786 | 810 → 323 | 60.1% | 908 → 326 |
| [pocketbase/pocketbase `6f370ea7`](https://github.com/pocketbase/pocketbase/tree/6f370ea741f33adf889eef02e3c1b884a47aa522) | 883 | 8.55 | 2188 → 2239 | 2638 → 786 | 70.2% | 2759 → 808 |
| [BurntSushi/ripgrep `3fce3b5b`](https://github.com/BurntSushi/ripgrep/tree/3fce3b5bb0236da2df6d99672afb8a719642eca7) | 228 | 3.10 | 856 → 848 | 882 → 404 | 54.2% | 907 → 401 |

All 36 paired scenario comparisons retained identical logical index digests and top-five path/line/snippet search payloads. Candidate unchanged runs chunked zero files; single-file-edit runs chunked exactly one file. This verifies parity for the sampled content, not general parser correctness. Target addition/removal and manifest changes are covered by the synthetic driver and language regression fixtures rather than this three-scenario external driver.

Seven of eight fixed expected-source probes hit within the top five in both revisions. The PocketBase `NewBaseCollection` query missed `core/collection_model.go` in both versions; its top five were test-file chunks (`core/record_model_test.go` and `core/collection_validate_test.go`). The initial strict probe check exposed this existing miss and stopped that attempt. It is retained in the completed report as a retrieval-quality gap. The performance comparison requires baseline/candidate result equivalence and does not count this query as a successful source hit. No ranking change or easier replacement query was used to remove the finding.

Peak worker RSS ranges were approximately 107–177 MiB for baseline and 103–146 MiB for candidate across these repositories. These whole-process maxima include copying and validation, so they are not a precise allocation profile or a general memory-reduction claim. Search timings and all individual runs are recorded in `local/benchmark/public-repo-comparison.json`.

The observed result supports releasing the incremental chunk/FTS optimization after the normal checks. Follow-up work should add external retrieval-quality cases (including the known Go miss) and measure larger repositories before choosing scanner or reranker optimizations. These tests do not measure Rust execution performance: Rust source is input data indexed by Scythe's Node.js runtime.

### Search-pipeline correction and ranking follow-up

The first recorded external run above passed raw `searchByKeyword` results directly to the reranker. It omitted the score normalization and candidate budgeting used by the production `searchKeywordOnly` pipeline. Its indexing timings and logical-index equivalence checks remain relevant, but its search timing/order must not be treated as production-pipeline measurements. The driver now calls `searchKeywordOnly` for both revisions and records `searchPipeline`, `searchPolicy`, and `changedSearchPayloads` in its report.

A direct production-pipeline reproduction confirmed the PocketBase issue: the source chunk containing `NewBaseCollection` ranked 19th in raw FTS results. With five requested results the pipeline shortlisted ten keyword chunks, all ahead of the source; with ten requested results it shortlisted twenty and the existing reranker could already put the source first. The fix therefore supplements missing exact declarations rather than globally increasing every shortlist or changing ranking weights.

New Go/Python/Rust tests reproduce lexical starvation and verify declaration-line previews. Additional cases cover many duplicate test declarations, exact declarations beyond the bounded symbol preview, unrecognized/multiword queries, and declaration lines outside the indexed chunk limit. The rerank-off path remains available as the raw-merge comparison. No new dependencies or remote calls are introduced.

The corrected production-pipeline run uses `no-hit-regression` plus `--require-candidate-hits`, with the same four pinned snapshots, queries, default limits, Node.js version, and three alternating paired repetitions. All 36 paired scenario index digests still match. Search payloads intentionally change in 27 scenario pairs; the raw report retains both versions rather than claiming payload parity. All eight expected-source probes hit in the candidate across every repetition/scenario; baseline retains its seven-of-eight result. PocketBase's previously missing declaration is first at `core/collection_model.go:407`, and a real CLI process and in-memory MCP client/server return identical compact context payloads containing that declaration.

Corrected local keyword-pipeline timings for the unchanged scenario (medians across the probe samples):

| Repository | Baseline median / p95 ms | Candidate median / p95 ms |
| --- | ---: | ---: |
| Flask | 1.82 / 2.37 | 1.49 / 2.27 |
| Fastify | 2.19 / 2.76 | 1.82 / 2.18 |
| PocketBase | 3.39 / 3.97 | 2.81 / 3.40 |
| ripgrep | 1.96 / 2.48 | 1.82 / 2.25 |

These small, local measurements compare both indexing and ranking changes against 0.1.20; they do not isolate the declaration lookup's overhead or establish universal search-speed gains. No transport/model/embedding latency is included. The corrected raw report is `local/benchmark/public-repo-ranking-comparison.json`.
