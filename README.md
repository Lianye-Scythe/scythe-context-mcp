# Scythe Context MCP

[![CI](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Lianye-Scythe/scythe-context-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/scythe-context-mcp.svg)](https://www.npmjs.com/package/scythe-context-mcp)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js >=24.11](https://img.shields.io/badge/Node.js-%3E%3D24.11-339933.svg)](package.json)

[English](README.md) | [繁體中文](README.zh-TW.md) | [简体中文](README.zh-CN.md)

Scythe Context MCP helps coding agents find relevant code and trace symbols, imports, and reverse imports. It returns file paths, line ranges, and selected snippets through CLI + Skill or MCP. Local keyword search works without an API key; semantic search is optional.

## When to use it

| What you need | Start with |
| --- | --- |
| A known file, exact identifier, error message, or regular expression | Direct file reads or `rg`. |
| Ranked matches and related-file context in an unfamiliar repository | Scythe keyword search and navigation. |
| Relevant code may use different wording from your description | Optional hybrid search with embeddings. |

Keyword search depends on matching terms. Scythe's additional value is ranking and cross-file context; it is not a replacement for every `rg` lookup.

## Choose an interface

Both interfaces ship in the same `scythe-context-mcp` npm package. Choose either, or use both.

| Interface | Use it when | Search default |
| --- | --- | --- |
| CLI + Skill | Your agent runs shell commands and loads skills, or you search from a terminal. | Local `keyword`. |
| MCP | Your client uses MCP tools. | `hybrid`; set `mode="keyword"` for local-only lookup. |

Scythe requires Node.js `>=24.11.0 <27`; Node.js 24 is the tested baseline. Your target repository does not need Node.js. Install and run Scythe in the same environment as its files; see [Windows, WSL, Linux, and macOS setup](docs/setup.md).

## Quick start

### CLI + Skill

**1. Install the CLI and search your repository.** Replace the path and query with your own repository and relevant terms:

```bash
cd /absolute/path/to/your/repo
npm install -g scythe-context-mcp@0.1.24
scythe-context index
scythe-context context "auth token" --format compact --max-results 1
```

The example limits results to one with `--max-results 1` for display; remove that option to return more matches.

`index` writes local metadata to `.scythe-context/`; it does not request embeddings. Refresh it after source changes. The terminal commands work without installing a Skill.

**2. Install the Skill for your agent.** Locate the global npm package directory:

```bash
npm root -g
```

Inside that directory, install the entire `scythe-context-mcp/skills/scythe-context/` folder using your agent's skill installer, or copy it into the agent's configured skill directory. It teaches the agent when to use `rg`, Scythe, and embeddings. npm installation or upgrades do **not** install or refresh this separate copy. See [client-specific Skill locations and invocation](docs/client-integration.md#install-and-discover-the-skill).

### MCP

**Codex configuration example.** For Claude Code and Antigravity CLI, see [client-specific MCP registration](docs/client-integration.md#register-mcp-when-choosing-that-interface).

For Codex on Linux, macOS, or WSL, add the following to `~/.codex/config.toml` (or your configured Codex home), then restart the client. For native Windows or Windows App + WSL, use the [platform setup guide](docs/setup.md).

```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

Ask the agent to execute these **MCP tool calls, not shell commands**. Replace the path; reindex only when metadata is missing/stale:

```text
repo_index_status({ "project_path": "/absolute/path/to/your/repo" })
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": false })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "auth token", "mode": "keyword" })
```

This example stays local by explicitly selecting keyword. If setup fails, use `repo_doctor` and [troubleshooting](docs/troubleshooting.md).

## What a result looks like

Actual CLI output from a two-file `src/auth.ts` / `src/app.ts` example, using the command above; the project path is normalized. Results depend on your repository:

```text
Project: /absolute/path/to/your/repo
Mode: keyword
src/auth.ts:1-3
  keyword/path match
export function validateToken(token: string) {
  return token.length > 0;
}
Related: src/auth.ts (source)
Related: src/app.ts (source)
Suggested: src/auth.ts
Suggested: src/app.ts
```

The agent can read the returned ranges and follow related files. See the [command and output reference](docs/setup.md#cli-commands-and-mcp-tools) for `search`, `related`, `status`, `doctor`, JSON, budgets, and saved results.

## Language support

Text search works on supported text files. Structure and local navigation cover:

| Language | Navigation coverage |
| --- | --- |
| JS / TS | Declarations, relative imports, config aliases/inheritance, explicit project references, declared workspace source exports. |
| Python | Declarations, flat/`src` packages, relative imports. |
| Go | Declarations and packages in the nearest `go.mod` module. |
| Rust | Declarations, Cargo file modules, anchored paths, literal library/binary target roots. |
| C# | Namespace/type/common method declarations and literal `.csproj` project references; `using` remains a hint. |
| C++ | Namespace/type/common function declarations and exact file-relative quoted includes. |

No target-language compiler or SDK is required. Navigation uses conservative source parsing, with language-specific limits; see [language support](docs/language-support.md) and [config-driven navigation](docs/config-navigation.md). Older installs should read [index upgrade notes](docs/setup.md#upgrading-an-existing-index).

## Optional: embeddings

Use keyword first when likely source terms are known. When wording differences make local results insufficient, hybrid combines keyword and vector retrieval; semantic uses vectors alone. The Skill guides initial vector creation and updates when useful and within the task's authorized scope.

Embeddings require a Gemini-compatible endpoint. Vector indexing sends code chunks; hybrid/semantic queries send query text when matching code vectors exist. Provider charges may apply. Without matching vectors, hybrid falls back locally and semantic errors before sending a query. CLI defaults to keyword; MCP defaults to hybrid.

See [semantic search, credentials, updates, and privacy](docs/semantic-search.md). An API key alone neither creates vectors nor enables automatic CLI mode switching.

## Limits and privacy

- Indexes need refreshing after edits; there is no automatic watcher. Related files are navigation hints, not compiler binding or a complete runtime call graph.
- Exclude private files with the root `.gitignore`. Keep `.scythe-context/`, legacy `.repo-beacon/`, `.env`, and `local/` out of version control.
- Retrieval benchmarks do not establish faster agent task completion or lower total token use. See the [benchmark](docs/benchmark.md) and [task A/B protocol (Traditional Chinese)](docs/codex-evaluation.md).

## More information

- [Client setup: Codex CLI, Claude Code, Antigravity CLI](docs/client-integration.md)
- [Documentation index](docs/README.md) · [Setup and command reference](docs/setup.md) · [Troubleshooting](docs/troubleshooting.md)
- [Architecture](docs/architecture.md) · [Workflow verification and remaining limits](docs/retrieval-workflow-audit.md)
- [Changelog](CHANGELOG.md) · [Contributing and source development](CONTRIBUTING.md) · [Release process](docs/release.md)
