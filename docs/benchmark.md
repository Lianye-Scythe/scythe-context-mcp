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

For the retrieval-quality comparison that best matches normal Scythe usage, run the Gemini-backed hybrid rerank comparison. This calls the configured embedding API and prints auto/off deltas for `scythe-hybrid` as well:

```bash
npm run bench:context:compare-rerank:hybrid
```

Equivalent explicit form:

```bash
npm run bench:context -- --compare-rerank --include-hybrid
```

The benchmark runner loads `.env` the same way the MCP server does. If `--include-hybrid` is set but `GEMINI_API_KEY` is not available to the benchmark process, `scythe-hybrid` is reported as skipped instead of failed.

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
    "notes": "Provider URL compatibility."
  }
]
```

Expected paths are validated by default. This catches typos and prevents false misses. If you intentionally benchmark against paths that may be absent in some checkout, pass `--allow-missing-expected`.

The summary reports ok/skipped/error counts, hit@1, hit@3, hit@5, MRR, and latency. Use this before and after ranking changes so reranker improvements are measured instead of judged by feel.

When comparing results, treat the bundled cases as a project-local regression suite. A more objective cross-repo evaluation should include multiple case files that cover different languages, project structures, and task types.
