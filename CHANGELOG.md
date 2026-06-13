# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning before npm publication where practical.

## [Unreleased]

### Added

- CLI smoke-test flags: `--help` and `--version`.
- npm and GitHub package metadata for homepage and issue links.
- Windows Codex App + WSL workspace setup guidance using Windows `npx.cmd`.
- CI coverage for CLI smoke tests.
- `PWD` fallback for default project detection, reducing the need for fixed per-repo MCP configuration.

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
