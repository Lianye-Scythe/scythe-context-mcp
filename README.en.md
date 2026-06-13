# Scythe Context MCP

[繁體中文](README.md) | [English](README.en.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP is a local code-context engine for Codex App / Codex CLI. It uses local indexing, hybrid search, and a configurable embedding provider to help Codex find relevant files, line ranges, symbol relationships, and actionable context faster.

Current status: repo scanning, chunking, SQLite/sqlite-vec metadata and embedding index, semantic search, FTS keyword search, hybrid ranking, lightweight symbol/dependency graph, related-file lookup, context budgeting, context packer, bounded multi-hop related-file traversal, opt-in related snippet packing, provider diagnostics, and index freshness diagnostics are implemented. Next priorities are provider capability caching, more actionable remediation messages, and tree-sitter symbols if needed.

## Quick Start

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm install
cp .env.example .env
npm run build
```

Runtime target: Node.js 24 LTS. Node 26 may work, but it is not the baseline until it enters LTS.

The old project name `repo-beacon-mcp` has been renamed to `scythe-context-mcp`. Existing local Codex threads can temporarily keep using the old path symlink; new MCP configuration should use the new path and `[mcp_servers.scythe_context]`. Legacy `REPO_BEACON_*` environment variables are still accepted as fallback, but new setups should use `SCYTHE_CONTEXT_*`.

## Codex Setup

Add this to Codex `~/.codex/config.toml` or to a trusted project's `.codex/config.toml`:

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

For a third-party v1beta proxy:

```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
cwd = "/path/to/scythe-context-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Set `GEMINI_API_KEY` in the shell or system environment before starting Codex. Do not write API keys into synced or committed config files.

If installed from npm later, the command can use the package binary:

```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
startup_timeout_sec = 20
tool_timeout_sec = 120
env_vars = ["GEMINI_API_KEY"]
```

## MCP Tools

- `repo_index_status`: Shows project path, index path, provider config, metadata/embedding coverage, and freshness diagnostics with stale reason samples for new/modified/missing/metadata_changed files.
- `gemini_embedding_probe`: Sends one embedding request to verify official Gemini or proxy compatibility. Success and failure responses include endpoint, latency, and remediation hints without returning the API key.
- `repo_reindex`: Scans a project. `dry_run=true` reports the plan; `dry_run=false` writes file/chunk metadata to `.scythe-context/index.sqlite`. Gemini embeddings are only created when `index_embeddings=true`, and are limited by `max_embedding_chunks`.
- `repo_semantic_search`: Runs hybrid search over indexed embeddings and keyword rows, returning paths, line ranges, score/distance, snippets, and grep keywords. `mode=semantic` is useful for debugging pure vector ranking. `max_context_chars` controls the total returned snippet budget, defaulting to 12000.
- `repo_related_files`: Returns symbols, imports, and reverse imports for one indexed file. Use it after search finds a candidate file and you need focused graph context.
- `repo_context_pack`: Packs primary snippets, match reasons, grep keywords, symbols, imports, importedBy, and suggested paths for a task query. It supports bounded multi-hop traversal with `max_seed_files`, `max_related_files`, and `related_depth`. Related traversal prefers source files and marks each `role`. `include_related_snippets=true` adds small related snippets under a separate `max_related_context_chars` budget.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Development Plan](docs/DEVELOPMENT_PLAN.md)
- [Gemini Compatibility](docs/GEMINI_COMPATIBILITY.md)
- [Tech Stack](docs/TECH_STACK.md)
- [Codex Integration Review](docs/CODEX_INTEGRATION.md)

## Local-only Files

Put local references and private API files under `local/`. This directory is ignored by `.gitignore` and is not committed.

- `local/references/`: Manually saved articles, HTML, screenshots, and other reference material.
- `local/secrets/`: API keys, proxy test files, and private configuration.

The default index directory is `.scythe-context/`; legacy `.repo-beacon/` is also ignored to avoid accidental commits during migration.

## Publishing Checklist

Before publishing or pushing publicly:

```bash
npm test
npm run build
npm audit --omit=dev
npm pack --dry-run
```

Confirm the package does not include `.env`, `.scythe-context/`, `.repo-beacon/`, `local/`, API keys, or private reference files.
