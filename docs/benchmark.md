# Context Search Benchmark

This is a retrieval-quality regression benchmark, not a universal benchmark for all repositories. The bundled cases are tuned for this project and are useful for measuring whether Scythe Context changes improve or regress realistic maintenance tasks in this repository.

For broader claims, run the same methods against external repositories with their own case files. Keep those results separate from the bundled project-local report.

This benchmark can compare three lookup modes:

- `rg-smart`: local ripgrep baseline without MCP or embeddings.
- `scythe-keyword`: Scythe metadata, FTS, symbols, dependencies, and context packing without embeddings.
- `scythe-hybrid`: Scythe hybrid search with Gemini-compatible query embeddings plus keyword results.

By default it runs only local, no-API methods. This keeps CI and quick local checks deterministic and avoids accidental embedding API calls:

```bash
npm run bench:context
```

The default suite is `full`, which runs every bundled case. For faster iteration, run one or more tagged suites:

```bash
npm run bench:context -- --suite core
npm run bench:context -- --suite core,provider
npm run bench:context -- --suite diagnostics
```

Bundled suite tags:

- `core`: indexing, search, ranking, context packing, chunking, scanner, and graph behavior.
- `provider`: Gemini-compatible provider behavior, auth, URL handling, embeddings, and provider safety.
- `diagnostics`: `repo_doctor`, index status, runtime, embedding coverage, and troubleshooting.
- `integration`: Codex App / CLI setup, WSL, MCP config, project detection, and tool instructions.
- `maintenance`: npm packaging, CI, release, security, CLI, and contribution workflows.
- `benchmark`: benchmark runner behavior and benchmark-report regressions.

The default report includes an `omittedMethods` entry for `scythe-hybrid` so it is clear that Gemini-backed search was intentionally not measured.

When running from a source checkout after changing TypeScript files, rebuild first or use:

```bash
npm run bench:context:source
```

Run with Gemini-backed hybrid search when you explicitly want to call the configured embedding API:

```bash
npm run bench:context:hybrid
```

Equivalent explicit form:

```bash
npm run bench:context -- --include-hybrid
```

Compare code-aware reranking against the raw merge baseline without API calls. The report prints auto/off metrics and deltas in one table:

```bash
npm run bench:context:compare-rerank
```

Equivalent explicit form:

```bash
npm run bench:context -- --compare-rerank
```

For quick ranking work, compare only the core suite:

```bash
npm run bench:context -- --suite core --compare-rerank
```

Compare context-pack response modes without calling the embedding API:

```bash
npm run bench:context:compare-response-modes
```

For a faster smoke check:

```bash
npm run bench:context -- --suite core --compare-response-modes
```

This keeps the same Scythe keyword results and estimates the JSON output size for `paths_only`, `compact`, and `snippets`. Hit metrics should normally stay the same across those three methods; the useful comparison is `out tok` and `h5/1k tok`.

When response-mode comparison is enabled, the text and JSON reports also include a mean output-token breakdown by top-level response section:

- `metadata`: query, project path, mode, rerank, fallback, and other control fields.
- `primaryResults`: ranked search results.
- `relatedFiles`: import/reverse-import and symbol metadata.
- `relatedSnippets`: extra related snippets, when the response mode includes them.
- `suggestedPaths`: paths Codex should inspect next.
- `context`: compact context-pack summary text.

Use this breakdown to identify which response sections are driving Codex token cost before changing default response modes or context-pack budgets.

Include Gemini-backed hybrid search in the same response-mode comparison when you explicitly want to call the configured embedding API:

```bash
npm run bench:context:compare-response-modes:hybrid
```

For benchmark-only reranker tuning, run a profile matrix. This does not change the MCP server runtime configuration; it only passes experimental weights inside the benchmark process:

```bash
npm run bench:context -- \
  --suite core \
  --rerank-profiles benchmarks/rerank-profiles.json
```

The bundled profile file compares `off`, `default`, `path-heavy`, `symbol-heavy`, and `docs-heavy`. Profile weights are multipliers for the current code-aware reranker components:

- `base`: existing merged search score.
- `path`: path and basename term matches.
- `snippet`: snippet term matches.
- `symbol`: extracted symbol matches.
- `role`: source/test/docs/generated role adjustment.
- `graph`: import and reverse-import counts.
- `sourceCounterpartRatio`: score ratio used when a matched test file adds its source counterpart.

For the retrieval-quality comparison that best matches normal Scythe usage, run the Gemini-backed hybrid rerank comparison. This calls the configured embedding API and prints auto/off deltas for `scythe-hybrid` as well:

```bash
npm run bench:context:compare-rerank:hybrid
```

Equivalent explicit form:

```bash
npm run bench:context -- --compare-rerank --include-hybrid
```

The benchmark runner loads `.env` the same way the MCP server does. If `--include-hybrid` is set but `GEMINI_API_KEY` is not available to the benchmark process, `scythe-hybrid` is reported as skipped instead of failed.

The text report includes token-efficiency columns:

- `out tok`: mean estimated JSON output tokens per case.
- `h5/1k tok`: hit@5 per 1,000 estimated output tokens. Higher is better when comparing retrieval quality against response size.

Write a machine-readable report:

```bash
npm run bench:context -- --json --output local/benchmark/context-search.json
```

The benchmark expects an existing `.scythe-context/index.sqlite` for the target project. Refresh it before measuring:

```bash
# Through the MCP tool, run repo_reindex with dry_run=false.
```

Benchmark another repository by pointing the runner at a target project and a case file written for that project:

```bash
npm run bench:context -- \
  --project /path/to/target-repo \
  --cases /path/to/target-repo-cases.json \
  --json \
  --output local/benchmark/target-repo.json
```

Run the rerank comparison on an external repository:

```bash
npm run bench:context -- \
  --project /path/to/target-repo \
  --cases /path/to/target-repo-cases.json \
  --compare-rerank
```

The target project must already have `.scythe-context/index.sqlite`. The case file does not need to live inside the target project. If it does live inside the target project, the runner excludes the case file itself from scoring so benchmark query text does not become a self-match.

The default case file is `benchmarks/context-search-cases.json`. Each case has a natural-language query and one or more project-relative expected paths:

```json
[
  {
    "id": "config-base-url-normalization",
    "query": "where is Gemini base URL normalization handled",
    "expectedPaths": [
      "src/providers/gemini.ts",
      "src/providers/gemini.test.ts"
    ],
    "tags": [
      "provider"
    ],
    "notes": "Provider URL compatibility."
  }
]
```

Expected paths are validated by default. This catches typos and prevents false misses. If you intentionally benchmark against paths that may be absent in some checkout, pass `--allow-missing-expected`. Tags are optional for external case files, but they are required if you want `--suite` filtering to select those cases.

The summary reports ok/skipped/error counts, hit@1, hit@3, hit@5, MRR, and latency. Use this before and after ranking changes so reranker improvements are measured instead of judged by feel.

When comparing results, treat the bundled cases as a project-local regression suite. A more objective cross-repo evaluation should include multiple case files that cover different languages, project structures, and task types.
