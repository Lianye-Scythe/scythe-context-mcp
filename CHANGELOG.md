# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning before npm publication where practical.

## [Unreleased]

### Changed

- Add client-specific Skill discovery and MCP setup for Codex CLI, Claude Code and Antigravity CLI. Record successful Codex/Antigravity CLI + Skill lookups and Claude Skill discovery blocked at model authentication.

- Restructure all three README languages around tool choice and first use, separate CLI/Skill installation, include captured CLI output, and move detailed commands, upgrade notes and source setup to maintained guides.

## [0.1.24] - 2026-10-18

### Fixed

- Recover exact snake_case/camelCase declarations in natural-language definition/registration queries when usages hide the implementation; retain existing caller-search behavior and recognize indented const declarations.
- Restrict semantic/hybrid vector candidates to the configured provider, endpoint, model and dimensions before nearest-neighbor selection, preventing mixed-model results and stale vector rows from suppressing valid candidates.
- Report configured embedding-set coverage in status and doctor. With no matching code vectors, hybrid falls back locally and semantic returns an error before sending a query.

### Changed

- Clarify Skill-driven initial embedding creation and incremental refresh before hybrid lookup, including existing authorization, job budgets, vector reuse, partial coverage and failure handling. Document the same workflow in the semantic-search guide.

## [0.1.23] - 2026-10-18

### Changed

- Define keyword/hybrid selection in the CLI Skill based on query wording, usable embedding coverage and permitted data transmission; avoid automatic whole-repository embedding for one-off lookups.
- Clarify CLI Skill routing between direct reads, `rg`, ranked search and related context; document keyword wording limits and stop searching once enough relevant code is found.
- Lead the three README languages and package description with local search, import navigation and bounded context. Add an interface comparison and optional semantic-search guide; keep MCP hybrid-default and remote-data disclosures explicit.
- Regroup TS configuration, project-reference, Cargo and related-navigation tests by responsibility. Keep all 319 cases and existing test assertions; scope temporary-directory setup to filesystem tests.
- Separate Cargo manifest parsing, workspace edition inheritance, target selection and anchored import resolution into named functions without changing supported resolution rules.
- Split the navigation evaluation driver into snapshot, indexing, probe, CLI/MCP parity and reporting stages. Validate identical complete reports from the old/new driver across five fixed GitHub snapshots, with no dependency graph changes against published 0.1.22.

## [0.1.22] - 2026-10-18

### Added

- Resolve declared indexed workspace source exports/self-references and workspace config parents without running package code. Select explicit local project references by file/include/exclude selectors; keep conflicting conditions, project overlaps and unavailable targets unresolved.
- Add fixed create-t3-turbo and shadcn Vite subtree probes: recover four T3 cases (+81 resolved edges against the preceding source build), preserve the Vite theme-provider edge and its missing generated Button, and verify CLI/MCP parity.
- Add static local tsconfig/jsconfig JSONC paths/baseUrl navigation, relative config inheritance, wildcard specificity, ordered indexed fallbacks, and runtime-extension/source mapping. Keep unavailable, invalid, cyclic, and ambiguous contexts unresolved.
- Read literal Cargo library/binary root paths and use those contexts for outlined modules and anchored imports, including arbitrary root filenames, auto-discovery controls, and basic workspace edition inheritance.
- Validate fixed ripgrep, Taxonomy, and Next.js Boilerplate snapshots against published 0.1.21: six edge probes and four source probes pass; chunks/symbols stay equal; CLI/MCP related payloads match. Record all graph additions/removals.
- Refresh configuration-driven dependencies after config-only edits and target removal while preserving unchanged source chunk ids. Reindex metadata once after upgrading to populate the new edges; no new embeddings, dependencies, or schema migration are needed.

### Changed

- Separate TypeScript config loading/overrides, project selection, alias matching and fallback dispatch into named functions. Add typed validated path maps and a typed workspace resolver; replace dense workspace export/dependency handling with focused helpers. Preserve navigation behavior across all five fixed GitHub snapshots.

## [0.1.21] - 2026-10-18

### Fixed

- Recover indexed exact-name declarations hidden by frequent usage/test matches during automatic keyword/hybrid reranking, with bounded candidates and previews anchored to declaration lines. Preserve existing visible candidates and the rerank-off path.
- Fix the PocketBase NewBaseCollection lookup: the source declaration previously fell outside the FTS shortlist and is now returned first. Add Go/Python/Rust regression coverage and verify identical CLI/MCP compact context payloads.
- Route external search probes through the production keyword-only pipeline and retain failures and intentional ranking changes in the evaluation report.

### Performance

- Reuse unchanged chunk layouts and healthy FTS rows while refreshing symbols and dependencies. Repair missing FTS rows and remove deleted files from FTS and the per-file cache.
- Track chunker identity/settings per file. Recompute changed settings and unkeyed custom chunkers conservatively, preserving equivalent legacy chunk ids and embedding records.
- Add synthetic and pinned Flask/Fastify/PocketBase/ripgrep comparisons. In the sampled public repositories, unchanged reindexing takes roughly 54–70% less time; first indexing remains approximately unchanged. These small local workloads are not universal speed claims. The corrected production-pipeline evaluation hits all eight fixed source probes without losing previously successful probes.

### Upgrade

- After upgrading to 0.1.21, run `scythe-context index --project /absolute/path/to/repo` once to warm the chunking cache. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false` on the upgraded server.
- Schema initialization adds the per-file chunking cache automatically. Equivalent chunks retain ids and embedding records; changing chunk settings may replace chunks and require optional re-embedding. See [index performance and validation](https://github.com/Lianye-Scythe/scythe-context-mcp/blob/v0.1.21/docs/index-performance.md) for scope, migration, and evaluation details.

## [0.1.20] - 2026-10-18

### Added

- Add basic C++ namespace/type/function/method extraction and exact file-relative quoted include navigation, with unresolved system/macro hints, fixtures, CLI/MCP parity, and documented compiler/build-system limits.
- Add basic C# namespace, type, constructor, and method extraction, including partial/record types and generic/async methods; preserve using directives as unresolved namespace/type hints.
- Add literal local .csproj ProjectReference navigation without executing MSBuild. Conditional/dynamic/missing/outside-root references remain unresolved, and literal removal entries invalidate matching links.
- Add C# fixtures and regression coverage for exact declaration/reference lines, test-file ranking, project traversal and removal, unchanged source chunk ids, and CLI/MCP keyword parity; document C# coverage and limitations in all three READMEs.

### Upgrade

- After upgrading to 0.1.20, refresh each existing project's metadata once, even if status reports fresh: `scythe-context index --project /absolute/path/to/repo`. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false` on the upgraded server. No new embeddings or schema migration are required.
- C# and C++ support provides basic source navigation, without Roslyn/Clang binding, MSBuild/CMake evaluation, compiler include paths, or macro expansion. See [language support and limits](https://github.com/Lianye-Scythe/scythe-context-mcp/blob/v0.1.20/docs/language-support.md).

## [0.1.19] - 2026-10-18

### Added

- Add basic local import navigation for Python flat/src packages and relative imports, Go packages within the nearest go.mod module, and conventional Cargo file modules through crate/self/super paths. Preserve unresolved imports and existing JS/TS resolution.
- Extract aliased/multiline Python imports, Go import blocks, and grouped Rust use statements; classify Python and Go test filenames for navigation and ranking.
- Add cross-language repository fixtures for source/import line numbers, duplicate test symbols, ignored artifacts, reverse imports, multi-hop navigation, and CLI/MCP keyword result parity.
- Rebuild package edges after Go manifest changes while retaining unchanged source chunk ids. Document language coverage and the remaining parser/runtime limitations.

### Upgrade

- After upgrading to 0.1.19, refresh each existing project's metadata once, even if status reports fresh: `scythe-context index --project /absolute/path/to/repo`. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false` on the upgraded server. No new embeddings or schema migration are required.
- Import navigation provides source-file hints; it does not resolve compiler-level symbols, dynamic imports, Go workspaces/replacements, or Rust macros/custom module paths. See [language support and limits](https://github.com/Lianye-Scythe/scythe-context-mcp/blob/v0.1.19/docs/language-support.md).

## [0.1.18] - 2026-10-18

### Added

- Add a `scythe-context` CLI in the existing npm package with status, index, search, context, related, and doctor commands, local keyword defaults, structured output, and optional result files.
- Package a Scythe Context skill for selective code lookup and explicit embedding use; preserve the existing MCP binary and defaults while sharing operation schemas and workflows.
- Cover CLI argument errors, process-level local indexing/search, import navigation, output files, explicit embeddings, and hybrid fallback alongside existing MCP integration tests.

## [0.1.17] - 2026-10-17

### Maintenance

- Share keyword, embedding validation, and hybrid fallback execution between both search tools while preserving their schemas and response formatting; add index-missing and dimension-mismatch regression coverage.
- Update dotenv to 18.0.8, ignore to 7.0.12, zod to 4.6.7, SQLite type definitions to 9.6.0, and Vitest to 5.0.5.
- Verify dotenv 18 environment loading and MCP stdio startup; document a complete direct-dependency freshness check alongside vulnerability review.

## [0.1.16] - 2026-10-12

### Maintenance

- Update the SQLite driver to N-API-based better-sqlite3 13.0.3 and web-tree-sitter to 0.27.1.
- Update TypeScript to 7.0.2, Node types to 26.6.5, tsx to 4.23.15, and Vitest to 5.0.4; refresh the lockfile and reviewed install-script approval.
- Update checkout and setup-node to v7. Consolidate stale Dependabot proposals on current main.
- Schedule routine dependency PRs monthly, group patch/minor updates, and keep major migrations and merging under review.

### Documentation

- Add a documentation index, current English architecture/provider guides, and an explicitly marked archive of early designs and experiments.
- Consolidate platform configuration in the setup guide and improve GitHub repository discovery and issue entry points.
- Make the main README English-first, with synchronized Traditional Chinese and Simplified Chinese versions.
- Lead with local keyword search without an API key; explain optional remote embeddings, defaults, privacy, and current evidence limits.
- Move platform and advanced configuration into an English setup guide and document translation maintenance rules.

## [0.1.15] - 2026-10-11

### Added

- Add explicit `mode="keyword"` to both search tools for local FTS, symbol, and dependency lookup without embedding requests or vectors.
- Add `GEMINI_REQUEST_TIMEOUT_MS` (default 10000) to bound each embedding request, including response body reads. Hybrid search falls back locally on timeout; semantic search reports a retryable error.
- Add real MCP client/server and local HTTP timeout tests, plus a reproducible Codex task A/B evaluation protocol.

### Changed

- Upgrade `@modelcontextprotocol/sdk` to 1.32.1 and refresh the affected transitive security patches in the npm lockfile.
- Replace `fast-glob` with Node directory traversal to remove the unpatched `braces` dependency chain while preserving scanner behavior.
- Pin install-script approvals for the existing SQLite driver and esbuild so clean installs work with npm script blocking; document dependency reachability and security maintenance.
- Default `repo_context_pack` output to `paths_only`; preserve the hybrid search default and explicit compact/snippets output.
- Deduplicate `paths_only` suggested paths against primary/related files and limit extra suggestions to 10, reporting omitted paths when capped.
- Prefer documentation over source/test metadata for explicit documentation lookup without code or test intent.

## [0.1.14] - 2026-06-15

### Added

- Add a dogfood evaluation document that compares MCP-first lookup with direct `rg` search across real maintenance tasks in this repository.

### Changed

- Tune local code-aware reranking so benchmark fixtures are downranked for runtime-behavior queries unless the query explicitly asks about benchmarks, gates, suites, or cases.
- Document the 2026-06-15 WASM tree-sitter dogfood spike results and keep tree-sitter as experimental opt-in because it did not improve retrieval quality or token efficiency on this repository.

## [0.1.13] - 2026-06-15

### Changed

- Make `repo_context_pack(response_mode="paths_only")` and `repo_semantic_search(response_mode="paths_only")` leaner by omitting grep keyword diagnostics and snippet-budget fields from first-pass scouting output.
- Tighten Codex-facing server and tool descriptions so Codex scouts unknown files with `paths_only`, uses `compact` when short snippets help, and reserves `snippets` for ranking or debug detail.
- Compact routine diagnostics by shortening all-OK `repo_doctor` output, hiding ignored-only skipped-file samples in compact `repo_reindex` output, and omitting provider capability timestamps from compact `gemini_embedding_probe` output.

## [0.1.12] - 2026-06-15

### Changed

- Update GitHub Actions dependencies to `actions/checkout@v6` and `actions/setup-node@v6`.
- Update `better-sqlite3` to `12.10.1`.
- Update development Node.js type definitions to `@types/node@25.9.3`.

## [0.1.11] - 2026-06-15

### Added

- Add troubleshooting and first-run check documentation for Codex, WSL, native modules, provider setup, and safe diagnostics.
- Add release process documentation for preparing versions, local verification, tagging, GitHub Releases, and npm publication checks.
- Add repository support, conduct, and Dependabot configuration for public GitHub maintenance.

### Changed

- Refresh README feature status and workflow guidance after the experimental opt-in tree-sitter extractor release.
- Clarify first-run diagnostics after clean install, including expected index-missing warnings and native install-script warnings.

## [0.1.10] - 2026-06-14

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
