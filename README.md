# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP helps Codex find code when the file location is unknown. It indexes a repository locally and returns file paths, line ranges, and related files. Optional Gemini embeddings add semantic search.

## When to use it

- Use it for unfamiliar repositories, conceptual code lookup, and tracing symbols or imports across files.
- Use `rg` or direct file reads when you already know the path or exact string.
- Local keyword search needs no API key. Semantic search requires a Gemini-compatible endpoint.

The project has retrieval benchmarks and integration tests. These do **not** establish that MCP improves GPT‑6.1 Sol task completion, speed, or total token use. See the [benchmark](docs/benchmark.md) and [task A/B protocol (Traditional Chinese)](docs/codex-evaluation.md).

## Quick start: local search

Requires Node.js 24.11+ within the supported range `>=24.11.0 <27`; Node.js 24 is the tested baseline. Run Node and npm in the same environment as the MCP server.

For Codex CLI on Linux, macOS, or WSL, add this to `~/.codex/config.toml` (or your configured Codex home). A trusted project can use `.codex/config.toml`:

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

Global installation is optional: `npx` downloads the package on first use. For native Windows or Windows Codex App with a WSL repository, follow the [platform setup guide](docs/setup.md) instead.

Restart Codex after changing the configuration. In the CLI, `/mcp` shows connected servers. In the App, confirm that Scythe tools are available.

Ask Codex to run the following **MCP tool calls, not shell commands**. Replace the repository path with its absolute path in the server's environment:

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "keyword" })
```

Run `repo_reindex` only when the index is missing or stale. It writes metadata to `.scythe-context/`; `index_embeddings=false` avoids sending chunks to an embedding endpoint.

A successful lookup returns `primaryResults` containing paths and line ranges. `repo_context_pack` defaults to `response_mode="paths_only"`; let Codex read the matching file ranges next. Request `response_mode="compact"` for short snippets. If setup fails, start with `repo_doctor` and the [troubleshooting guide](docs/troubleshooting.md).

## Optional semantic search and privacy

Keep `GEMINI_API_KEY` in the environment that starts Codex and forward it to the existing server configuration. Do not commit the key. Then build vectors and use hybrid search:

```toml
# Add this field to the existing [mcp_servers.scythe_context] table.
env_vars = ["GEMINI_API_KEY"]
```

```text
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": true })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "hybrid" })
```

These calls send repository chunks and query text to the configured endpoint, which may incur provider charges. Defaults are `https://generativelanguage.googleapis.com/v1beta`, model `gemini-embedding-2`, and 1536 dimensions. For proxies and authentication settings, see [setup](docs/setup.md).

**Search mode defaults to `hybrid`, even though the quick start explicitly uses `keyword`.** If a key is configured, omitting `mode` can send the query to the provider. Use `mode="keyword"` to avoid embedding requests.

| Mode | Embedding requests | If query embedding fails |
| --- | --- | --- |
| `keyword` | None; metadata only | Not applicable |
| `hybrid` (default) | Sends the query; indexed vectors support semantic retrieval | Falls back to keyword and reports the fallback |
| `semantic` | Sends the query; requires indexed vectors | Returns an error without keyword fallback |

`GEMINI_REQUEST_TIMEOUT_MS` defaults to `10000` and bounds each embedding request, including the response body. It does not limit the entire indexing job. `gemini_embedding_probe` also sends its test text to the endpoint. Third-party proxies can see the text sent to them.

Index files stay in `.scythe-context/`. Keep that directory, legacy `.repo-beacon/`, `.env`, and `local/` out of version control. Exclude private files from indexing with `.gitignore`, and check scope before enabling embeddings. Do not include secrets, private source, or index databases in public issues or logs.

## Tools and current limits

| Tool | Purpose |
| --- | --- |
| `repo_index_status` | Check metadata, embedding coverage, and index freshness. |
| `repo_reindex` | Update metadata; embed chunks only with `index_embeddings=true`. |
| `repo_context_pack` | Find code for a task; paths and line ranges by default. |
| `repo_semantic_search` | Inspect keyword, hybrid, or semantic search ranking; compact output by default. |
| `repo_related_files` | Inspect a file's symbols, imports, and reverse imports. |
| `repo_doctor` | Check local setup and index health without external API calls. |
| `gemini_embedding_probe` | Test the configured embedding endpoint with supplied text. |

The default symbol/import extractor uses regex; tree-sitter is experimental and requires separately configured grammars. Related-file results are navigation hints, not a complete runtime call graph. Indexes need refreshing as files change; embedding coverage can be partial.

## Documentation

- [Documentation index](docs/README.md)
- [Platform setup and advanced configuration](docs/setup.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Retrieval benchmark](docs/benchmark.md) · [Dogfood evaluation](docs/dogfood.md)
- [Codex task A/B protocol (Traditional Chinese)](docs/codex-evaluation.md)
- [Architecture](docs/architecture.md) · [Gemini provider details](docs/gemini-compatibility.md)
- [Contributing](CONTRIBUTING.md) · [Release process](docs/release.md) · [Changelog](CHANGELOG.md)

## Development

Install dependencies in the environment that will run Node, especially when using Windows and WSL:

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm ci
npm run build
npm run verify
```

For a source-based MCP setup, point `node` at the absolute path to `dist/index.js`; see [setup](docs/setup.md). Update all three README languages together when changing user-facing behavior.
