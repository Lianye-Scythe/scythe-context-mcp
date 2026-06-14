# Context Search Benchmark

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

Compare code-aware reranking against the raw merge baseline without API calls:

```bash
npm run bench:context:compare-rerank
```

Equivalent explicit form:

```bash
npm run bench:context -- --rerank auto
npm run bench:context -- --rerank off
```

For the retrieval-quality comparison that best matches normal Scythe usage, run the Gemini-backed hybrid rerank comparison. This calls the configured embedding API:

```bash
npm run bench:context:compare-rerank:hybrid
```

Equivalent explicit form:

```bash
npm run bench:context:hybrid -- --rerank auto
npm run bench:context:hybrid -- --rerank off
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

The default case file is `benchmarks/context-search-cases.json`. Each case has a natural-language query and one or more expected paths. The summary reports ok/skipped/error counts, hit@1, hit@3, hit@5, MRR, and latency. Use this before and after ranking changes so reranker improvements are measured instead of judged by feel.

The runner excludes the case file itself from scoring so benchmark query text does not become a self-match.
