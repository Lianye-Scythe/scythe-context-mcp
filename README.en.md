# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP is a local code-context engine for Codex App / Codex CLI. It builds a SQLite/sqlite-vec index inside the repo and combines semantic search, keyword search, symbol/dependency metadata, and context packing so Codex can retrieve actionable files, line ranges, snippets, and related paths faster.

## Highlights

- Local-first: metadata, FTS, and vector indexes live under `.scythe-context/`.
- Hybrid retrieval: combines Gemini embeddings, SQLite FTS5, path boosts, and symbol-aware ranking instead of relying on one retrieval path.
- Codex-oriented output: returns line ranges, snippets, match reasons, grep keywords, related files, and suggested paths.
- Gemini-compatible: supports the official Gemini API and third-party v1beta proxies.
- Diagnosable: includes provider probe, index freshness, embedding coverage, and actionable remediation hints.

Privacy note: query or chunk text is sent to the configured Gemini-compatible endpoint only when embedding features are used. Treat third-party proxies as services that can see that text.

## Quick Start

Codex MCP config can use `npx -y scythe-context-mcp` directly; a global install is not required. Global installation is mostly useful for checking that the CLI runs, or for using the short command form in Codex config.

```bash
npm install -g scythe-context-mcp
scythe-context-mcp --version
```

Runtime target: Node.js 24 LTS. Node 26 may work, but it is not the baseline until it enters LTS.

Run from source:

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

The old project name `repo-beacon-mcp` has been renamed to `scythe-context-mcp`. Legacy `REPO_BEACON_*` environment variables are still accepted as fallback, but new setups should use `SCYTHE_CONTEXT_*`.

## Codex Setup

Codex MCP configuration uses fields such as `command`, `args`, `cwd`, `env`, and `env_vars`; see the official [Model Context Protocol](https://developers.openai.com/codex/mcp) and [Configuration Reference](https://developers.openai.com/codex/config-reference) docs.

### Choose The Runtime

| Scenario | Recommendation |
| --- | --- |
| Codex and MCP both run on Windows | Use Windows `node.exe` plus Windows npm `npx-cli.js`. |
| Codex CLI runs inside WSL/Linux/macOS | Use `npx` or `node dist/index.js` from the same environment. |
| Codex App on Windows opens a WSL repo | Use Windows `wsl.exe` to start WSL Node, so the SQLite index stays on the WSL filesystem. Avoid Windows Node directly reading or writing `.scythe-context/` inside a WSL repo. |

### Native Windows

Use `where node` and `npm root -g` to confirm your own Windows Node/npm paths first; the example below uses an nvm4w installation path.

Minimum config:

```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
env_vars = ["GEMINI_API_KEY"]
```

If `scythe-context-mcp` is installed globally and Codex can see it on PATH, it can be shorter:

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
env_vars = ["GEMINI_API_KEY"]
```

### WSL/Linux/macOS

When Codex and the MCP server both run in the same Unix-like environment, the minimum config is:

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
env_vars = ["GEMINI_API_KEY"]
```

When running from source:

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
env_vars = ["GEMINI_API_KEY"]
```

Here `args` points to the built Scythe Context MCP entrypoint; do not pin `cwd` to one repo in global config. Scythe prefers a tool call's `project_path`, then the workspace `PWD` / process `cwd` used when Codex starts the MCP server. Set `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT` only in project-scoped `.codex/config.toml`, or when you intentionally want to pin one repo.

### Windows Codex App + WSL repo

Codex App on Windows may not reliably start WSL-side stdio MCP servers while using WSL agent mode. The most reliable tested workaround is to let Codex run Windows `wsl.exe`, then let `wsl.exe` start WSL Node and the WSL npm package.

Install inside WSL first:

```bash
npm install -g scythe-context-mcp
command -v scythe-context-mcp
scythe-context-mcp --version
```

Then use this Codex config:

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/Windows/System32/wsl.exe"
args = ["-d", "Ubuntu", "--", "bash", "-lc", "PATH=/home/you/.nvm/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin exec /home/you/.nvm/current/bin/scythe-context-mcp"]
startup_timeout_sec = 40
tool_timeout_sec = 120
env_vars = ["PWD", "GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Notes:

- Replace `Ubuntu` with your WSL distribution name; check it with `wsl.exe -l -v`.
- Replace `/home/you/.nvm/current/bin` with your WSL Node/npm path; check it inside WSL with `which node` and `which scythe-context-mcp`.
- Do not pin `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT` in global config. This setup follows the current Codex workspace, so you do not need to edit config for every repo.
- `WSLENV` lists variable names to preserve across WSL/Windows interop; it does not contain the key itself. Prefer keeping `GEMINI_API_KEY` in the environment that starts Codex, then forward it with `env_vars`; write it directly under `[mcp_servers.scythe_context.env]` only for local throwaway testing.
- Avoid using Windows Node to index `.scythe-context/` directly inside a WSL repo. SQLite can report `database is locked` across the UNC / WSL filesystem boundary, and native modules can also accidentally mix Windows and WSL binaries.

### Optional hardening

These settings are not required for a minimal launch, but they help for large repos, first-time `npx` downloads, or a fixed tool surface:

```toml
[mcp_servers.scythe_context]
startup_timeout_sec = 40
tool_timeout_sec = 120
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe",
  "repo_doctor"
]
```

`enabled = true` and `required = false` are usually the default behavior and do not need to be written explicitly.

If you really want to pin one default project, set `SCYTHE_CONTEXT_DEFAULT_PROJECT` under `[mcp_servers.scythe_context.env]`. Normal multi-repo usage should not need this; Scythe prefers a tool call's `project_path`, then `PWD`, then the MCP process `cwd`.

`SCYTHE_CONTEXT_RERANK_MODE` can be `auto` or `off`. The default `auto` enables the local code-aware reranker; set it to `off` temporarily when diagnosing ranking behavior and comparing against the raw semantic/keyword merge.

Scythe stores observed Gemini-compatible provider capabilities in repo-local `.scythe-context/provider-capabilities.json`, including whether batch embedding works, whether output dimensionality matches the expected size, and the latest probe / success / failure timestamps. This file is not committed; `repo_reindex(index_embeddings=true)` uses it to avoid repeatedly trying a batch endpoint that is already known to be unsupported.

### Gemini / v1beta proxy

If URL/model/auth are not set, Scythe uses the official Gemini-compatible defaults:

- `GEMINI_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL`: `gemini-embedding-2`
- `GEMINI_AUTH_MODE`: `x-goog-api-key`
- `GEMINI_OUTPUT_DIMENSIONALITY`: `1536`

Official Gemini users usually only need to provide `GEMINI_API_KEY`. Third-party proxies or custom models can override these non-secret settings:

For model names and REST endpoint behavior, see Google's official [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings).

```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Set `GEMINI_API_KEY` in the environment that starts Codex, or in the system environment, and forward it with `env_vars = ["GEMINI_API_KEY"]`. Do not write the key into synced or committed config files except for local throwaway testing.

Supported auth modes:

- `x-goog-api-key`
- `bearer`
- `query`

Official Gemini usually uses `x-goog-api-key`; many third-party proxies use `bearer`. If a proxy requires a query-string key, use `query` and set `GEMINI_API_KEY_QUERY_PARAM` if needed.

`WSLENV` is a WSL interop rule, not a Codex-specific field. You only need it when Windows Codex App opens a WSL repo and the server is launched through a `wsl.exe` wrapper or another cross-environment command. With the `wsl.exe` wrapper above, use the no-suffix form:

```toml
[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Use `PWD/p` only if you intentionally run a Windows Node process and need WSL to convert the workspace path to a Windows-readable UNC path. That mode is currently not recommended for directly reading or writing the repo-local SQLite index in WSL.

## Typical Workflow

1. Check index status first:

   ```text
   repo_index_status
   ```

2. If metadata is missing or freshness is stale:

   ```text
   repo_reindex({ "dry_run": false })
   ```

3. For first-run setup or environment problems, run local diagnostics:

   ```text
   repo_doctor
   ```

4. Build embeddings only when semantic search or context packs need vectors:

   ```text
   repo_reindex({ "dry_run": false, "index_embeddings": true })
   ```

5. Ask Codex for task-oriented context:

   ```text
   repo_context_pack({ "query": "where is auth token validation handled?" })
   ```

6. Expand imports / reverse imports for a matched file:

   ```text
   repo_related_files({ "path": "src/server/auth.ts" })
   ```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `repo_index_status` | Shows index path, metadata/embedding coverage, freshness diagnostics, and recommended actions. |
| `repo_reindex` | Scans the project and writes metadata; calls the embedding provider only when `index_embeddings=true`. |
| `repo_context_pack` | Packs primary snippets, match reasons, related files, and suggested paths for a task query. |
| `repo_semantic_search` | Runs hybrid or semantic search over indexed chunks, mainly for raw ranking diagnostics. Prefer `repo_context_pack` for normal lookup. |
| `repo_related_files` | Shows symbols, imports, and importedBy for one file. |
| `gemini_embedding_probe` | Tests Gemini or proxy compatibility and returns endpoint, latency, error classification, and remediation hints. |
| `repo_doctor` | Checks Node runtime, native modules, Gemini env, provider capability cache, WSL interop, and index health without calling external APIs. |

`repo_context_pack(mode="hybrid")` and `repo_semantic_search(mode="hybrid")` degrade to keyword-only results when query embedding is unavailable, returning `effectiveMode: "keyword"` and `fallback.reason: "embedding_unavailable"`. `mode="semantic"` does not degrade and returns `status: "embedding_unavailable"` because pure semantic search requires query embedding. Use `rg` / direct file reads for exact strings, known paths, or small targeted checks.

To control Codex token usage, `repo_index_status`, `repo_related_files`, `repo_reindex`, `repo_doctor`, and `gemini_embedding_probe` return compact summaries by default, including decision-oriented details and estimated output tokens. Use `response_mode="full"` only when you need full diagnostics, the complete skipped file list, vector samples, or raw provider capability details.

`repo_context_pack` and `repo_semantic_search` also support `response_mode`:

- `compact`: default mode with short snippets, decision-oriented related metadata, suggested paths, and estimated output tokens.
- `paths_only`: first-pass scouting mode with paths, line ranges, match reasons, and compact related-path summaries.
- `snippets`: fuller snippets, ranking scores, and metadata when more context or ranking diagnostics are needed.

Prefer `repo_context_pack(response_mode="paths_only")` first, then let Codex read specific files or small ranges directly. Use the default `compact` mode when short snippets help with the edit. Use `repo_semantic_search(response_mode="snippets")` when you need ranking scores or fuller snippets for ranking diagnostics.

## Feature Status

Implemented: repo scanning, chunking, SQLite metadata, SQLite FTS5, sqlite-vec, Gemini Embedding 2 provider, semantic/keyword/hybrid search, keyword-only fallback when embeddings fail, local code-aware reranker, lightweight symbol/dependency graph, experimental opt-in tree-sitter extractor, related-file lookup, `repo_context_pack`, provider diagnostics, provider capability cache, index freshness diagnostics, and `repo_doctor`.

Next: focus on first-run diagnostics, Codex/WSL troubleshooting, release maintenance docs, and real usage feedback. Tree-sitter remains experimental opt-in until benchmark or user evidence shows clear value.

## Privacy and Local Files

- `.scythe-context/`: default index directory, not committed.
- `.repo-beacon/`: legacy index directory name, still ignored.
- `local/`: private API test files, reference HTML, screenshots, and other local-only material.
- `.env`: local configuration, not committed.

Do not include API keys, proxy tokens, private source snippets, or index databases in issues, PRs, or public logs.

## Documentation

- [Architecture](docs/architecture.md)
- [Development Plan](docs/development-plan.md)
- [Gemini Compatibility](docs/gemini-compatibility.md)
- [Tech Stack](docs/tech-stack.md)
- [Codex Integration Review](docs/codex-integration.md)
- [Context Search Benchmark](docs/benchmark.md)
- [Troubleshooting and first-run checks](docs/troubleshooting.md)
- [Release process](docs/release.md)

## Development and Publishing Checks

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Confirm the package does not include `.env`, `.scythe-context/`, `.repo-beacon/`, `local/`, API keys, or private reference files.
