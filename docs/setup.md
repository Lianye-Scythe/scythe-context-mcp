# Setup and Advanced Configuration

Start with the [README](../README.md) for local search without an API key. This guide covers CLI + Skill, platform-specific MCP launches, and optional provider settings.

## CLI + Skill: local search first

Install the package in the environment where your agent runs shell commands, then use a target repository's path:

```bash
npm install -g scythe-context-mcp@0.1.24
scythe-context --version
scythe-context status --project /absolute/path/to/repo
scythe-context index --project /absolute/path/to/repo
scythe-context context "where is auth token validation handled?" --project /absolute/path/to/repo --format compact
```

Run `index` when metadata is missing/stale, or once when upgrading from before 0.1.22. This creates local metadata without embedding requests. CLI search/context use `keyword` by default; no API key is needed.

Copy the packaged `skills/scythe-context/` folder into your agent's skill directory using that agent's skill installation workflow. The CLI must be on PATH in the agent's execution environment; a global installation in another operating system or shell does not make it available automatically. Skill installation is separate from npm installation.

For a Windows app running commands in WSL, install Node and Scythe in WSL and verify `command -v scythe-context` there. Keep the repository and its SQLite index in that environment. The MCP wrappers below are needed only when choosing MCP.

From a source checkout, run `npm run build` and replace `scythe-context` with `node /absolute/path/to/scythe-context-mcp/dist/command.js`. The package also includes the MCP entrypoint, so choosing CLI does not require another package or an MCP server.

For optional remote retrieval, see [semantic search](semantic-search.md). The remaining sections cover MCP configuration and advanced settings.

## MCP configuration

Codex MCP configuration uses fields such as `command`, `args`, `cwd`, `env`, and `env_vars`; see the official [Model Context Protocol](https://developers.openai.com/codex/mcp) and [Configuration Reference](https://developers.openai.com/codex/config-reference) docs.

## Choose The Runtime

| Scenario | Recommendation |
| --- | --- |
| Codex and MCP both run on Windows | Use Windows `node.exe` plus Windows npm `npx-cli.js`. |
| Codex CLI runs inside WSL/Linux/macOS | Use `npx` or `node dist/index.js` from the same environment. |
| Codex App on Windows opens a WSL repo | Use Windows `wsl.exe` to start WSL Node, so the SQLite index stays on the WSL filesystem. Avoid Windows Node directly reading or writing `.scythe-context/` inside a WSL repo. |

## Native Windows

Use `where node` and `npm root -g` to confirm your own Windows Node/npm paths first; the example below uses an nvm4w installation path.

Minimum config:
```toml
[mcp_servers.scythe_context]
command = 'C:\nvm4w\nodejs\node.exe'
args = ['C:\nvm4w\nodejs\node_modules\npm\bin\npx-cli.js', '-y', 'scythe-context-mcp']
```

If `scythe-context-mcp` is installed globally and Codex can see it on PATH, it can be shorter:
```toml
[mcp_servers.scythe_context]
command = "scythe-context-mcp"
```

## WSL/Linux/macOS

When Codex and the MCP server both run in the same Unix-like environment, the minimum config is:
```toml
[mcp_servers.scythe_context]
command = "npx"
args = ["-y", "scythe-context-mcp"]
```

When running from source:
```toml
[mcp_servers.scythe_context]
command = "node"
args = ["/path/to/scythe-context-mcp/dist/index.js"]
```

Here `args` points to the built Scythe Context MCP entrypoint; do not pin `cwd` to one repo in global config. Scythe prefers a tool call's `project_path`, then the workspace `PWD` / process `cwd` used when Codex starts the MCP server. Set `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT` only in project-scoped `.codex/config.toml`, or when you intentionally want to pin one repo.

## Windows Codex App + WSL repo

The `wsl.exe` wrapper below was tested with a Windows Codex App and a WSL workspace. It starts WSL Node and keeps SQLite on the WSL filesystem. App startup behavior can vary by version and environment.

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
env_vars = ["PWD"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD"
```

Notes:

- Replace `Ubuntu` with your WSL distribution name; check it with `wsl.exe -l -v`.
- Replace `/home/you/.nvm/current/bin` with your WSL Node/npm path; check it inside WSL with `which node` and `which scythe-context-mcp`.
- Do not pin `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT` in global config. This setup follows the current Codex workspace, so you do not need to edit config for every repo.
- `WSLENV` lists variable names to preserve across WSL/Windows interop; it does not contain the key itself. Prefer keeping `GEMINI_API_KEY` in the environment that starts Codex, then forward it with `env_vars`; avoid storing it in shared or committed config.
- Avoid using Windows Node to index `.scythe-context/` directly inside a WSL repo. SQLite can report `database is locked` across the UNC / WSL filesystem boundary, and native modules can also accidentally mix Windows and WSL binaries.

## Optional hardening

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

## Gemini / v1beta proxy

This section is optional. For the complete CLI/MCP embedding workflow and data handling, start with [optional semantic search](semantic-search.md).

If URL/model/auth are not set, Scythe uses the official Gemini-compatible defaults:

- `GEMINI_BASE_URL`: `https://generativelanguage.googleapis.com/v1beta`
- `GEMINI_MODEL`: `gemini-embedding-2`
- `GEMINI_AUTH_MODE`: `x-goog-api-key`
- `GEMINI_OUTPUT_DIMENSIONALITY`: `1536`

Local `mode="keyword"` search does not need this section. For embeddings, keep `GEMINI_API_KEY` in the environment that starts Codex and add the following field to the existing server table:
```toml
[mcp_servers.scythe_context]
# Keep the command and args from your platform configuration.
env_vars = ["GEMINI_API_KEY"]
```

For the WSL wrapper, use `env_vars = ["PWD", "GEMINI_API_KEY"]` and preserve additional provider settings through `WSLENV` as shown below. Build vectors with `repo_reindex(index_embeddings=true)` only after checking which files will be sent. `hybrid` and `semantic` send queries to the provider; `keyword` does not.

Official Gemini users usually only need to provide `GEMINI_API_KEY`. Third-party proxies or custom models can override these non-secret settings:

For model names and REST endpoint behavior, see Google's official [Gemini embeddings docs](https://ai.google.dev/gemini-api/docs/embeddings).
```toml
[mcp_servers.scythe_context.env]
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Set `GEMINI_API_KEY` in the environment that starts Codex, or in the system environment, and forward it with `env_vars = ["GEMINI_API_KEY"]`. Do not write the key into synced or committed config files.

Supported auth modes:

- `x-goog-api-key`
- `bearer`
- `query`

Official Gemini usually uses `x-goog-api-key`; many third-party proxies use `bearer`. If a proxy requires a query-string key, use `query` and set `GEMINI_API_KEY_QUERY_PARAM` if needed.

`WSLENV` is a WSL interop rule, not a Codex-specific field. You only need it when Windows Codex App opens a WSL repo and the server is launched through a `wsl.exe` wrapper or another cross-environment command. With the `wsl.exe` wrapper above, use the no-suffix form:
```toml
[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY:GEMINI_REQUEST_TIMEOUT_MS"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Use `PWD/p` only if you intentionally run a Windows Node process and need WSL to convert the workspace path to a Windows-readable UNC path. That mode is currently not recommended for directly reading or writing the repo-local SQLite index in WSL.

## Request timeout and output controls

`GEMINI_REQUEST_TIMEOUT_MS` defaults to `10000` milliseconds per embedding request, including body reads. It must be an integer from 1 to 2147483647. Hybrid query failures fall back to local keyword search; semantic failures return an error. This is not a deadline for the entire indexing job.

`repo_context_pack` defaults to `paths_only`. Use `compact` for short snippets and `snippets` for ranking detail. `repo_semantic_search` defaults to `compact`. In `paths_only`, extra `suggestedPaths` are deduplicated against primary and related files and capped at 10; `suggestedPathsTruncated` counts omitted paths. Other modes retain the full suggestions.

Use `response_mode="full"` for detailed diagnostics from `repo_index_status`, `repo_related_files`, `repo_reindex`, `repo_doctor`, or `gemini_embedding_probe` only when necessary.

## Legacy names

The project was renamed from `repo-beacon-mcp`. Legacy `REPO_BEACON_*` variables remain fallback aliases; use `SCYTHE_CONTEXT_*` for new setups.

See [troubleshooting](troubleshooting.md) for startup, native-module, provider, and index failures. See [Gemini provider details](gemini-compatibility.md) for request formats, dimensions, batch handling, and privacy.
