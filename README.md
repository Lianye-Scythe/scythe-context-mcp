# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP gives coding agents local code search, import navigation, and bounded context through CLI + Skill or MCP. Find relevant file paths, line ranges, symbols, and related files in an unfamiliar repository. Start with local keyword search: no API key or embedding service is required.

## When to use it

- Use it for unfamiliar repositories, conceptual code lookup, and tracing symbols or imports across files.
- Use `rg` or direct file reads when you already know the path or exact string.
- Local keyword search needs no API key. Semantic search requires a Gemini-compatible endpoint.

## Choose an interface

Both interfaces ship in the same npm package and share the indexing and retrieval engine. Choose either, or use both.

| Interface | Choose it when | Search default |
| --- | --- | --- |
| CLI + Skill | Your agent can run shell commands and load skills, or you want to search from a terminal. | Local `keyword`; no embedding requests. |
| MCP | Your client uses MCP tools. | `hybrid`; explicitly set `mode="keyword"` for local-only search. |

Requires Node.js `>=24.11.0 <27` in the environment running Scythe; Node.js 24 is the tested baseline. The target repository does not need to use Node.js. See [platform setup](docs/setup.md) for Windows, WSL, Linux, and macOS.

## CLI + Skill (same package)

The `scythe-context-mcp` npm package provides both a `scythe-context` CLI and the existing MCP entrypoint. Install once and choose CLI + Skill, MCP, or both. For a source checkout, run `npm run build` and substitute `node /absolute/path/to/scythe-context-mcp/dist/command.js` for `scythe-context` below.

```bash
npm install -g scythe-context-mcp@0.1.23
scythe-context status
# Run when metadata is missing/stale, or once after upgrading to 0.1.22:
scythe-context index
scythe-context search "where is auth token validation handled?"
scythe-context context "where is auth token validation handled?" --format compact
scythe-context related src/auth.ts
scythe-context doctor
```

CLI search/context default to local `keyword` mode and paths-only output. MCP retains its existing `hybrid` default. Both interfaces share validation, indexing, search, fallback, and response shaping; changing the interface does not improve retrieval accuracy by itself.

Use `--project /absolute/repo/path` to override the configured project. Add `--json` for structured search/context results; status/index/related/doctor already return JSON. `--format` controls detail (`paths`, `compact`, `snippets` for search/context; `compact`, `full` for other commands). `--output /absolute/result.json` saves the structured payload and prints its path for selective reading. `--help` lists budgets and other options. Exit code 0 includes empty searches and hybrid fallback; errors and missing lookup indexes return nonzero. `doctor` returns nonzero on error, while warnings return 0.

The packaged [Skill](skills/scythe-context/SKILL.md) teaches an agent when to search, read ranges, refresh metadata, and use embeddings. Copy the `skills/scythe-context/` folder into your agent's skill directory to enable discovery; the CLI must be available in that agent's execution environment. There is no automatic skill installation. `scythe-context` without arguments shows help; `scythe-context-mcp` without arguments continues to start MCP stdio. Either entrypoint accepts the subcommands above, and `serve` explicitly starts MCP.

## MCP quick start: local search

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

## Language support

Text search works across supported text files. Structure and import navigation are language-specific:

| Language | Navigation coverage |
| --- | --- |
| JS / TS | Common declarations/imports, config aliases/inheritance, explicit project references, and declared workspace source exports. |
| Python | Common declarations, flat/`src` packages, and relative imports. |
| Go | Common declarations and packages within the nearest `go.mod` module. |
| Rust | Common declarations, Cargo file modules, anchored paths, and literal library/binary target roots. |
| C# | Namespace/type/common method declarations and literal `.csproj` project references; `using` stays a namespace/type hint. |
| C++ | Namespace/type/common function declarations and exact file-relative quoted includes. |

Navigation is conservative and does not provide compiler-level binding or a complete runtime call graph. No target-language SDK or compiler is required. See [language support and limits](docs/language-support.md) and [config-driven navigation](docs/config-navigation.md).

When upgrading from a version before 0.1.22, run `scythe-context index --project /absolute/path/to/repo` once even if the index reports fresh. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false`. This refreshes navigation metadata and warms the chunking cache without requesting embeddings.

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

The project has retrieval benchmarks and integration tests. These do **not** establish that MCP improves GPT‑6.1 Sol task completion, speed, or total token use. See the [benchmark](docs/benchmark.md) and [task A/B protocol (Traditional Chinese)](docs/codex-evaluation.md).

## Optional: semantic search with embeddings

Start with keyword search and import navigation. If relevant code uses different wording from your query and local results are insufficient, try hybrid or semantic retrieval and compare the results on your repository. Embeddings are optional; they are not required for language navigation or context packing.

Enabling them requires a Gemini-compatible endpoint and sends code chunks during embedding indexing and query text during hybrid/semantic search. Provider charges may apply. See [optional semantic search](docs/semantic-search.md) for setup, commands, modes, and privacy details.

CLI search/context default to `keyword`; MCP defaults to `hybrid`. With a key configured, MCP queries can reach the provider unless you explicitly select `mode="keyword"`.

Keep `.scythe-context/`, legacy `.repo-beacon/`, `.env`, and `local/` out of version control. Use `.gitignore` to exclude private files from indexing.

## Documentation

- [Documentation index](docs/README.md)
- [Platform setup and advanced configuration](docs/setup.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Retrieval benchmark](docs/benchmark.md) · [Dogfood evaluation](docs/dogfood.md)
- [Codex task A/B protocol (Traditional Chinese)](docs/codex-evaluation.md)
- [Architecture](docs/architecture.md) · [Optional semantic search](docs/semantic-search.md)
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
