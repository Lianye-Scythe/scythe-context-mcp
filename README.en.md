# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP is a local code-context engine for Codex App / Codex CLI. It builds a SQLite/sqlite-vec index inside the repo and combines semantic search, keyword search, symbol/dependency metadata, and context packing so Codex can retrieve actionable files, line ranges, snippets, and related paths faster.

## Why Use It

- **Local-first**: metadata, FTS, and vector indexes live under `.scythe-context/`.
- **Hybrid retrieval**: combines Gemini embeddings, SQLite FTS5, path boosts, and symbol-aware ranking instead of relying on one retrieval path.
- **Codex-oriented output**: returns line ranges, snippets, match reasons, grep keywords, related files, and suggested paths.
- **Bring your own provider**: supports the official Gemini API and third-party Gemini-compatible v1beta proxies.
- **Diagnosable**: includes provider probe, index freshness, embedding coverage, and actionable remediation hints.

Privacy note: query or chunk text is sent to the configured Gemini-compatible endpoint only when embedding features are used. Treat third-party proxies as services that can see that text.

## Feature Status

Implemented:

- repo scanning, binary/large-file skipping, and chunking
- SQLite metadata, SQLite FTS5, and sqlite-vec vector indexes
- Gemini Embedding 2 provider and batch fallback
- semantic / keyword / hybrid search
- lightweight symbol/dependency graph
- related-file lookup and bounded multi-hop traversal
- `repo_context_pack` context budgeting and related snippet packing
- provider diagnostics and index freshness diagnostics

Next:

- provider capability cache
- fuller install/native dependency doctor
- keyword-only fallback when embeddings fail
- tree-sitter symbol extraction if needed

## Installation

### From npm

Install the CLI globally from npm:

```bash
npm install -g scythe-context-mcp
scythe-context-mcp --version
```

### From source

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

Runtime target: Node.js 24 LTS. Node 26 may work, but it is not the baseline until it enters LTS.

The old project name `repo-beacon-mcp` has been renamed to `scythe-context-mcp`. Legacy `REPO_BEACON_*` environment variables are still accepted as fallback, but new setups should use `SCYTHE_CONTEXT_*`.

## Codex Setup

Codex MCP configuration uses fields such as `command`, `args`, `cwd`, `env`, and `env_vars`; see the official [Model Context Protocol](https://developers.openai.com/codex/mcp) and [Configuration Reference](https://developers.openai.com/codex/config-reference) docs.

### Native Windows

If Codex and the MCP server both run on Windows, prefer explicit Windows Node/npm paths. This avoids inconsistent `npx` and PATH resolution on Windows:

```toml
[mcp_servers.scythe_context]
command = "C:\\nvm4w\\nodejs\\node.exe"
args = ["C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js", "-y", "scythe-context-mcp"]
cwd = "C:\\Users\\you"
enabled = true
required = false
startup_timeout_sec = 40
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe"
]

[mcp_servers.scythe_context.env]
SCYTHE_CONTEXT_DEFAULT_PROJECT = "C:\\Users\\you\\Git\\your-repo"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

If `scythe-context-mcp` is installed globally and Codex can see it on PATH, the shorter form also works:

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe"
]

[mcp_servers.scythe_context.env]
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

### WSL/Linux/macOS

If Codex and the MCP server both run in the same Unix-like environment, use the npm package directly:

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
cwd = "/home/you/Git/your-repo"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

If running from source, point Codex at the built entry point:

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

### Windows Codex App + WSL repo

If Codex App starts MCP servers from a WSL project but the MCP server should run on Windows Node, use Windows `node.exe` plus npm's `npx-cli.js`, and keep `cwd` on a Windows-accessible directory. Set the WSL repo through `SCYTHE_CONTEXT_DEFAULT_PROJECT`; `WSLENV` with `/p` converts it into a UNC path that the Windows process can read:

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/nvm4w/nodejs/node.exe"
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', "-y", "scythe-context-mcp"]
cwd = "/mnt/c/Users/you"
enabled = true
required = false
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
enabled_tools = [
  "repo_index_status",
  "repo_reindex",
  "repo_context_pack",
  "repo_semantic_search",
  "repo_related_files",
  "gemini_embedding_probe"
]

[mcp_servers.scythe_context.env]
SCYTHE_CONTEXT_DEFAULT_PROJECT = "/home/you/Git/your-repo"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
WSLENV = "SCYTHE_CONTEXT_DEFAULT_PROJECT/p:GEMINI_API_KEY/w:GEMINI_OUTPUT_DIMENSIONALITY/w:GEMINI_BASE_URL/w:GEMINI_MODEL/w:GEMINI_AUTH_MODE/w:GEMINI_API_KEY_HEADER/w:GEMINI_API_KEY_QUERY_PARAM/w"
```

Do not set `cwd` to the WSL repo's UNC directory, because npm/npx may go through CMD, and CMD does not support UNC current directories. Also do not point Windows `node.exe` at `dist/index.js` inside a WSL checkout unless that checkout's dependencies were installed by Windows npm. `better-sqlite3` and `sqlite-vec` include native modules, and Windows Node cannot load native binaries installed by Linux npm.

### Third-party v1beta proxy

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
