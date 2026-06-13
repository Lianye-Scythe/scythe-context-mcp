# Context Search Benchmark

This benchmark compares three lookup modes:

- `rg-smart`: local ripgrep baseline without MCP or embeddings.
- `scythe-keyword`: Scythe metadata, FTS, symbols, dependencies, and context packing without embeddings.
- `scythe-hybrid`: Scythe hybrid search with Gemini-compatible query embeddings plus keyword results.

Run the default no-API baseline:

```bash
npm run bench:context
```

When running from a source checkout after changing TypeScript files, rebuild first or use:

```bash
npm run bench:context:source
```

Run with Gemini-backed hybrid search:

```bash
npm run bench:context -- --include-hybrid
```

The benchmark runner loads `.env` the same way the MCP server does. If `GEMINI_API_KEY` is not available to the benchmark process, `scythe-hybrid` is reported as skipped instead of failed.

Write a machine-readable report:

```bash
npm run bench:context -- --json --output local/benchmark/context-search.json
```

The benchmark expects an existing `.scythe-context/index.sqlite` for the target project. Refresh it before measuring:

```bash
# Through the MCP tool, run repo_reindex with dry_run=false.
```

The default case file is `benchmarks/context-search-cases.json`. Each case has a natural-language query and one or more expected paths. The summary reports ok/skipped/error counts, hit@1, hit@3, hit@5, MRR, and latency. Use this before and after ranking changes so reranker improvements are measured instead of judged by feel.
