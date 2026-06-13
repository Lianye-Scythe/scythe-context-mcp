# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
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

After the package is published:

```bash
npm install -g scythe-context-mcp
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

### npm binary

If installed globally from npm:

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

### Local checkout

If running from source:

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
