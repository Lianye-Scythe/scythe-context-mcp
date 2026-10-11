# Runtime and Technology Stack

Status: current implementation, reviewed on 2026-10-11. Exact dependency versions are maintained in [package.json](../package.json) and [package-lock.json](../package-lock.json). Historical performance targets and dependency proposals are in the [archive](archive/tech-stack-design.zh-TW.md).

## Runtime

The package supports Node.js `>=24.11.0 <27`; Node.js 24 is the CI baseline. TypeScript compiles to ESM in `dist/`. MCP transport is stdio. Use Node and dependencies installed in the same environment, particularly across Windows and WSL.

## Components

| Component | Responsibility |
| --- | --- |
| Node `fs.readdir` | Repository traversal without a glob dependency. |
| `ignore` | Apply the repository root `.gitignore`. |
| `better-sqlite3` | SQLite metadata and FTS5 access. |
| `sqlite-vec` | Local vector storage and nearest-neighbor retrieval. |
| `@modelcontextprotocol/sdk` | MCP tool registration and stdio transport. |
| `zod` | Validate tool inputs. |
| `dotenv` | Load local environment configuration at server startup. |
| Node `fetch` | Gemini-compatible REST requests with a per-request timeout. |
| `web-tree-sitter` | Experimental optional structure extraction with external WASM grammars. |
| Vitest / TypeScript | Tests and build checks. |

## Operational limits and evidence

Scanning and chunking limits bound index size; embedding batch/chunk limits bound each indexing pass. Output budgets control snippets, and related traversal is bounded. These controls are not performance or cost guarantees for every repository.

The [retrieval benchmark](benchmark.md) reports file-finding quality and estimated output tokens. The [Codex task A/B protocol](codex-evaluation.md) defines an evaluation of actual task outcomes; retrieval scores alone do not establish model productivity gains.

See [dependency security maintenance](dependency-security.md) for the 2026-10-11 audit and install-script review. That is a dated snapshot, not a permanent security guarantee. See [setup](setup.md) for configuration and [architecture](architecture.md) for module responsibilities.
