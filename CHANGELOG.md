# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning before npm publication where practical.

## [Unreleased]

### Added

- Add a tree-sitter spike skeleton with a structure-extractor interface, fixture coverage, and local comparison script.
- Document tree-sitter dependency experiment results and prefer a WASM-first optional extractor path.
- Add an experimental `web-tree-sitter` WASM structure extractor behind explicit opt-in env configuration, with regex fallback.

## [0.1.9] - 2026-06-14

### Added

- Add a benchmark regression gate for Scythe retrieval quality and compact response token budgets, with optional Gemini-backed hybrid checks.

## [0.1.8] - 2026-06-14

### Added

- Add benchmark response-mode comparison for `paths_only`, `compact`, and `snippets` context-pack output token costs.
- Add benchmark response payload token breakdowns for context-pack response sections.

### Changed

- Make compact search/context-pack responses more token-efficient by shortening snippets, omitting ranking diagnostics, and summarizing related-file metadata.
- Make tool error responses include response stats and compact shaping, compress `repo_related_files` compact output, and clarify `repo_semantic_search` as a ranking-diagnostics tool.
- Improve reranking for npm/package maintenance queries so package manifests are not crowded out by long documentation or benchmark files.

## [0.1.7] - 2026-06-14

### Added

- Add `npm run bench:context:hybrid` for explicit Gemini-backed benchmark runs.
- Add `npm run bench:context:compare-rerank` for no-API auto/off rerank comparisons.
- Add `npm run bench:context:compare-rerank:hybrid` for Gemini-backed auto/off retrieval-quality comparisons.
- Expand the context-search benchmark to 61 task-style cases covering setup, diagnostics, provider compatibility, packaging, release, and benchmark workflows.
- Document and harden external repository benchmark usage with `--project`, `--cases`, expected-path validation, and benchmark scope reporting.
- Add benchmark case tags and `--suite` filtering for faster core/provider/diagnostics/integration/maintenance/benchmark runs.
- Add benchmark-only rerank profile matrix support with bundled path-heavy, symbol-heavy, and docs-heavy experiment profiles.
- Add `npm run release:prepare` and make the publish workflow create GitHub Releases while safely skipping already-published npm versions on reruns.
- Add changelog-based GitHub Release notes generation so releases use curated project notes instead of GitHub's minimal generated summary.
- Add `response_mode` for token-efficient search/context-pack output, response token estimates, and benchmark output-token efficiency metrics.
- Add focused response-shaping tests for `paths_only`, `compact`, and `snippets` output modes.
- Add compact/full `repo_reindex` response modes with skipped-file summaries and output token estimates.
- Add compact/full `repo_index_status` and `repo_related_files` response modes.
- Add compact/full `repo_doctor` and `gemini_embedding_probe` response modes.

### Changed

- Make the default benchmark report state that `scythe-hybrid` was intentionally omitted unless `--include-hybrid` is set.
- Make rerank comparison benchmarks print one auto/off delta report instead of two separate tables.
- Tune code-aware reranking for security/privacy documentation queries and broaden the UTF-8 scanner benchmark expectation to include the scanner decision point.
- Lower default search/context-pack response budgets and make `compact` the default response mode for high-frequency lookup tools.
- Move response-shaping logic out of MCP tool registration and keep compacted snippet truncation flags accurate.
- Resolve the benchmark script root path with `fileURLToPath` for better Windows compatibility.
- Make `repo_reindex` default output shorter by hiding raw skipped-file lists and provider cache keys unless `response_mode=full` is requested.
- Make index status and related-file lookups default to shorter decision-oriented output.
- Make doctor and embedding probe outputs default to compact diagnostics without vector samples or raw provider cache keys.

## [0.1.6] - 2026-06-14

### Added

- Add `repo_doctor` local diagnostics for runtime, native modules, Gemini env, WSL interop, and index health without external API calls.
- Expand the context-search benchmark to cover 30 repo-self lookup cases and exclude benchmark case text from scoring.
- Add `SCYTHE_CONTEXT_RERANK_MODE=auto|off` and benchmark `--rerank auto|off` for ranking diagnostics.
- Add a repo-local provider capability cache so Gemini-compatible batch support and dimensionality observations are reused across probes and embedding indexing.

## [0.1.5] - 2026-06-14

### Added

- Add a context-search benchmark comparing `rg`, keyword-only Scythe search, and Gemini-backed hybrid search.
- Add a local code-aware reranker that uses path, snippet, symbol, import graph, file-role, and source-counterpart signals without extra model/API calls.

## [0.1.4] - 2026-06-14

### Added

- Add keyword-only fallback for hybrid search/context-pack calls when query embedding is unavailable, while preserving explicit `embedding_unavailable` diagnostics for semantic-only mode.

## [0.1.3] - 2026-06-14

### Changed

- Clarify MCP server instructions so Codex prefers Scythe Context for unknown-location, semantic, and related-file lookup, while using `rg` or direct file reads for exact strings, known paths, and small targeted checks.
- Update Windows Codex App + WSL documentation to prefer a `wsl.exe` wrapper that starts WSL Node, avoiding Windows Node direct access to WSL repo-local SQLite indexes.

### Fixed

- Avoid false binary detection when a UTF-8 scan prefix ends in the middle of a multibyte character.
- Overwrite stale sqlite-vec rows before inserting embeddings so incremental reindexing cannot fail when embedding ids are reused.

## [0.1.2] - 2026-06-13

### Fixed

- Ensure the npm bin entrypoint is executable so `npx -y scythe-context-mcp` works on Unix-like environments.

## [0.1.1] - 2026-06-13

### Added

- CLI smoke-test flags: `--help` and `--version`.
- npm and GitHub package metadata for homepage and issue links.
- Windows Codex App + WSL workspace setup guidance using Windows `npx.cmd`.
- CI coverage for CLI smoke tests.
- `PWD` fallback for default project detection, reducing the need for fixed per-repo MCP configuration.
- README clarification for WSL `PWD/p` forwarding versus direct Gemini proxy configuration.

## [0.1.0] - 2026-06-13

### Added

- Local stdio MCP server for Codex App / CLI.
- Gemini Embedding 2 provider with official Gemini and v1beta proxy compatibility.
- Configurable auth modes: `x-goog-api-key`, `bearer`, and `query`.
- SQLite metadata store, SQLite FTS5 keyword index, and sqlite-vec vector index.
- File scanner, chunker, persistent metadata indexing, and embedding cache.
- Semantic, keyword, and hybrid search.
- Lightweight symbol/dependency graph with related-file lookup.
- `repo_context_pack` with context budgeting, bounded multi-hop traversal, and optional related snippets.
- `repo_index_status` metadata, embedding, and freshness diagnostics.
- `gemini_embedding_probe` provider diagnostics with secret-safe errors.
- Multilingual README files: Traditional Chinese, English, and Simplified Chinese.
- GitHub CI, issue templates, PR template, security policy, contributing guide, and Apache-2.0 license.

### Notes

- Embedding text is sent to the configured Gemini-compatible endpoint only when embedding operations are requested.
- Local indexes are stored under `.scythe-context/` by default and are not committed.
