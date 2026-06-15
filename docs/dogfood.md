# Dogfood Evaluation

This document records practical Scythe Context MCP usage checks against this repository. The goal is not to replace benchmark gates; it is to check whether the tools help Codex find the right files with less exploratory reading and less output token waste during real development work.

## Method

Each case compares a typical Codex workflow:

- MCP-first: call `repo_context_pack(response_mode="paths_only")`, then read the specific files or ranges that look relevant.
- Direct search: use `rg` when the query has exact symbols, environment variable names, file names, or literal error text.

The useful signals are:

- whether the first MCP call includes the necessary file;
- whether the top result is actionable or noisy;
- approximate MCP output tokens from `responseStats.estimatedOutputTokens`;
- whether `rg` requires already knowing project-specific names.

## Cases

| Case | Task intent | MCP result | Approx. MCP tokens | Direct-search comparison | Verdict |
| --- | --- | --- | ---: | --- | --- |
| Provider compatibility | Find Gemini base URL normalization and auth handling. | Hit `src/providers/gemini.ts` first; also suggested `src/config.ts`, `src/tools/doctor.ts`, and provider tests. | 584 | `rg normalizeGeminiBaseUrl GEMINI_AUTH_MODE authMode baseUrl` finds exact lines but emits many README/config/test matches. | MCP is better for first-pass orientation; `rg` is better after naming the symbol/env var. |
| Embedding fallback | Find query embedding failure fallback and when to use `rg`. | Initially included `src/tools/registerTools.ts` but ranked `benchmarks/context-search-cases.json` first; after the benchmark-intent reranker tweak, `src/tools/registerTools.ts` ranks first. | 478 | `rg embedding_unavailable fallback effectiveMode` finds implementation and docs but returns many fixture/doc hits. | MCP now routes runtime fallback questions to the implementation first; `rg` is still useful for exact field audits. |
| Response shaping | Find compact response modes and output token estimates. | Hit `src/tools/responseShape.ts` first and suggested benchmark code. | 364 | `rg responseStats estimatedOutputTokens response_mode` finds all relevant code, but with broad output. | MCP is strong for locating the module; `rg` is strong for exact field audits. |
| Release process | Find version preparation, tag publish, npm, and GitHub Release workflow. | Hit `.github/workflows/publish.yml`, `docs/release.md`, and `scripts/prepare-release.mjs` in the top three. | 406 | `rg release:prepare GitHub Release npm publish tag CHANGELOG` also works well because terms are exact. | Both are good. MCP is cleaner for initial orientation; `rg` is fine for release maintenance. |
| Benchmark gate | Find benchmark gate implementation and pass/fail thresholds. | Hit `scripts/context-benchmark-gate.mjs` first, then benchmark runner and docs. | 412 | `rg bench:gate threshold hit@5 MRR` works if the maintainer knows the metric names. | MCP is better for vague benchmark questions. |
| Repo diagnostics | Find WSL, native dependency, API key, and index health checks. | Hit `src/tools/doctor.ts` first, then troubleshooting docs and tests. | 445 | `rg wsl_interop native_modules gemini_config index` works after knowing check names. | MCP is strong for user-support style queries. |
| Codex WSL setup | Find Windows Codex App + WSL configuration docs. | Hit `docs/codex-integration.md` and `docs/troubleshooting.md`; benchmark fixture appeared after docs. | 388 | `rg WSLENV wsl.exe Codex` is effective but returns README duplicates across languages. | MCP is cleaner for documentation navigation. |
| Tree-sitter opt-in | Find experimental WASM extractor config and regex fallback. | Hit `src/indexing/experimental/treeSitterStructure.ts` first, then spike script/docs and factory/test files. | 590 | `rg tree-sitter fallback grammar wasm` works, but broad docs and tests appear together. | MCP is effective for experimental feature orientation. |

## Findings

- `paths_only` is the right first-pass default for Codex. The live `0.1.13` shape keeps results small while still returning actionable paths, line ranges, match reasons, related paths, and response token estimates.
- MCP is most valuable when the user intent is conceptual, cross-cutting, or phrased without exact local symbols.
- `rg` remains better for exact strings, known paths, environment variable names, and small targeted checks.
- Fixture/documentation noise can appear when behavior is also described in benchmark cases. A small benchmark-intent reranker tweak now downranks `benchmarks/` for runtime-behavior queries while keeping benchmark files competitive for benchmark/gate/suite/case queries.
- `suggestedPaths` is useful but should be treated as a secondary queue. Codex should inspect `primaryResults` first, then use `suggestedPaths` when the first files do not answer the task.

## Recommendations

- Keep the current server instruction strategy: start with `repo_index_status`, use `repo_context_pack(response_mode="paths_only")` for unknown file locations, and use `rg` for exact strings or known paths.
- Do not make `compact` the first-pass recommendation. It is useful after candidate files are identified or when short snippets can directly support an edit.
- Consider adding a dogfood benchmark suite later only after several real sessions show the same failure patterns. The current evidence supports documentation and a small ranking investigation, not a large benchmark expansion yet.
