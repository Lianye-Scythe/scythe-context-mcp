# Codex Integration

Status: integration notes reviewed on 2026-10-18. CLI + Skill setup and the observed Codex CLI lookup are documented in the [client integration guide](client-integration.md). The MCP details below apply when that interface is chosen. Installation examples live in [setup](setup.md); first-run checks and failure recovery live in [troubleshooting](troubleshooting.md).

## Transport and configuration

Scythe provides a CLI and a local stdio MCP server. The same packaged Skill supports terminal and App agents that can discover it and run the CLI. For MCP, Codex starts the configured command and communicates over stdin/stdout; no hosted MCP endpoint is required. Node and native SQLite dependencies must run in the environment where they were installed.

Codex MCP configuration uses `command`, `args`, optional `cwd`, `env`, and `env_vars`. Consult the official [MCP documentation](https://developers.openai.com/codex/mcp) and [configuration reference](https://developers.openai.com/codex/config-reference) for current host behavior. This repository's [Windows/WSL wrapper](setup.md#windows-codex-app--wsl-repo) has been tested with Codex App; that observation does not establish compatibility for every App version or setup.

## Project selection

An explicit tool `project_path` takes precedence. Otherwise Scythe uses `SCYTHE_CONTEXT_DEFAULT_PROJECT`, usable `PWD`, or process `cwd`. Avoid fixing a single project in global configuration unless that is intentional. Use absolute repository paths as seen by the MCP server.

## Tool workflow

1. Check `repo_index_status`; rebuild metadata only if missing or stale.
2. Use `repo_context_pack(mode="keyword")` for unknown file locations without provider requests. The default response is `paths_only`.
3. Read the matching file ranges directly. Use `compact` for short snippets and `repo_related_files` for a focused symbol/import view.
4. Enable embeddings only when remote text transfer is appropriate and semantic retrieval is needed. Search mode defaults to `hybrid`; omit `mode` only when that behavior is intended.
5. Use `rg` or direct reads for exact strings and known paths. Reserve `repo_semantic_search` for inspecting ranking behavior.

The server supplies MCP instructions containing this workflow. Keep their first 512 characters self-contained, consistent with official guidance. Project `AGENTS.md` can supply durable tool and privacy rules; it is guidance to the agent, not an enforced network restriction.

## Boundaries and evaluation

Metadata and vector indexes are local, but embedding indexing, hybrid/semantic queries, and probes send text to the configured provider. Tool budgets limit snippets; they do not establish total model token savings.

Integration tests and a live App lookup verify connectivity and tool behavior. The [retrieval benchmark](benchmark.md) measures file-finding performance; the [task A/B protocol](codex-evaluation.md) (Traditional Chinese) is for evaluating actual Codex task outcomes. No controlled GPT‑6.1 Sol task-completion improvement is claimed.
