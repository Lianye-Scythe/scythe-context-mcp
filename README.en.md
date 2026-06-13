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
| Codex App on Windows opens a WSL repo | The App's WSL MCP bridge may still be unreliable; run MCP on Windows Node and pass the current WSL workspace to the Windows process with `PWD` + `WSLENV`. |

### Native Windows

Minimum config:

```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
cwd = 'C:\Users\you\Git\your-repo'
env_vars = ["GEMINI_API_KEY"]
```

If `scythe-context-mcp` is installed globally and Codex can see it on PATH, it can be shorter:

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
cwd = 'C:\Users\you\Git\your-repo'
env_vars = ["GEMINI_API_KEY"]
```

### WSL/Linux/macOS

When Codex and the MCP server both run in the same Unix-like environment, the minimum config is:

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
cwd = "/home/you/Git/your-repo"
env_vars = ["GEMINI_API_KEY"]
```

When running from source:

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
env_vars = ["GEMINI_API_KEY"]
```

### Windows Codex App + WSL repo

Codex App on Windows may not reliably start WSL-side stdio MCP servers while using WSL agent mode. If MCP tools do not appear in the App, MCP handshakes time out, or config paths cross Windows/WSL boundaries, run the MCP server on Windows Node and let Scythe Context index the WSL repo path.

Minimum config:

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/nvm4w/nodejs/node.exe"
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', "-y", "scythe-context-mcp"]
cwd = "/mnt/c/Users/you"
env_vars = ["GEMINI_API_KEY", "PWD"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD/p:GEMINI_API_KEY/w"
```

Notes:

- Keep `cwd` on a Windows-accessible directory such as `/mnt/c/Users/you`. Do not use the WSL repo's UNC directory as `cwd`, because npm/npx may go through CMD, and CMD does not support UNC current directories.
- `PWD/p` lets WSL convert the current workspace path into a UNC path readable by the Windows process, so you do not need to edit config for every repo.
- Do not point Windows `node.exe` at `dist/index.js` inside a WSL checkout unless that checkout's dependencies were installed by Windows npm. `better-sqlite3` and `sqlite-vec` include native modules, and Windows Node cannot load native binaries installed by Linux npm.

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
  "gemini_embedding_probe"
]
```

`enabled = true` and `required = false` are usually the default behavior and do not need to be written explicitly.

If you really want to pin one default project, set `SCYTHE_CONTEXT_DEFAULT_PROJECT` under `[mcp_servers.scythe_context.env]`. Normal multi-repo usage should not need this; Scythe prefers a tool call's `project_path`, then `PWD`, then the MCP process `cwd`.

### Gemini / v1beta proxy

```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Supported auth modes:

- `x-goog-api-key`
- `bearer`
- `query`

Set `GEMINI_API_KEY` in the shell or system environment before starting Codex. Do not write API keys into synced or committed config files.

When using the Windows Codex App + WSL repo mode, add any extra Gemini variables to `WSLENV`, for example `PWD/p:GEMINI_API_KEY/w:GEMINI_BASE_URL/w:GEMINI_AUTH_MODE/w:GEMINI_OUTPUT_DIMENSIONALITY/w`.

## Typical Workflow

1. Check index status first:

   ```text
   repo_index_status
   ```

2. If metadata is missing or freshness is stale:

   ```text
   repo_reindex({ "dry_run": false })
   ```

3. Build embeddings only when semantic search or context packs need vectors:

   ```text
   repo_reindex({ "dry_run": false, "index_embeddings": true })
   ```

4. Ask Codex for task-oriented context:

   ```text
   repo_context_pack({ "query": "where is auth token validation handled?" })
   ```

5. Expand imports / reverse imports for a matched file:

   ```text
   repo_related_files({ "path": "src/server/auth.ts" })
   ```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `repo_index_status` | Shows index path, metadata/embedding coverage, freshness diagnostics, and recommended actions. |
| `repo_reindex` | Scans the project and writes metadata; calls the embedding provider only when `index_embeddings=true`. |
| `repo_context_pack` | Packs primary snippets, match reasons, related files, and suggested paths for a task query. |
| `repo_semantic_search` | Runs hybrid or semantic search over indexed chunks; useful for ranking diagnostics. |
| `repo_related_files` | Shows symbols, imports, and importedBy for one file. |
| `gemini_embedding_probe` | Tests Gemini or proxy compatibility and returns endpoint, latency, error classification, and remediation hints. |

## Feature Status

Implemented: repo scanning, chunking, SQLite metadata, SQLite FTS5, sqlite-vec, Gemini Embedding 2 provider, semantic/keyword/hybrid search, lightweight symbol/dependency graph, related-file lookup, `repo_context_pack`, provider diagnostics, and index freshness diagnostics.

Next: provider capability cache, install/native dependency doctor, keyword-only fallback when embeddings fail, and tree-sitter symbol extraction if needed.

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

## Development and Publishing Checks

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Confirm the package does not include `.env`, `.scythe-context/`, `.repo-beacon/`, `local/`, API keys, or private reference files.
