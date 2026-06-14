# Codex App / CLI Integration Review

## Sources Checked

- Official OpenAI Codex manual fetched by the `openai-docs` skill on 2026-06-13.
- Official Codex MCP documentation.
- Official Codex `AGENTS.md` documentation.
- `openai/codex` GitHub README, current public repository page.

## Findings

### MCP transport

Scythe Context is aligned with Codex's local MCP path:

- Codex supports local STDIO MCP servers.
- Scythe Context runs as a STDIO server through `node dist/index.js`.
- Configuration should use `[mcp_servers.scythe_context]` and `[mcp_servers.scythe_context.env]` tables in `config.toml`.
- Secrets should be forwarded with `env_vars = ["GEMINI_API_KEY"]` instead of written into project config.

This is preferable to a remote HTTP MCP server for the current project because the index database and scanner are local to the repo.

### Server instructions

Codex reads the MCP server `instructions` field during initialization. The most important guidance should appear early because Codex may use the beginning of the instructions while deciding whether to call a server.

Scythe Context's server instructions now put the key workflow first:

1. Check `repo_index_status`.
2. Run metadata reindex only when needed.
3. Prefer `repo_context_pack` for task lookup.
4. Only embed when semantic vectors are needed.
5. Keep context budgets bounded.

### Codex surfaces

Codex CLI and the IDE extension share MCP configuration through `config.toml`. The Codex app also exposes plugins/MCP-related extension points, but local setup behavior can vary by App settings and installed plugins. For direct reproducible setup, document CLI/IDE `config.toml` first and keep App usage phrased as "Codex local MCP compatible" rather than assuming every App install auto-loads a project config.

### Platform setup paths

Codex's official MCP configuration model is platform-neutral: a stdio server has `command`, optional `args`, optional `cwd`, `env`, and `env_vars`. The practical launch command should still match the OS that runs Node:

- Native Windows: use Windows `node.exe` and npm's `npx-cli.js`, or the short binary command only when Codex can reliably see the npm global binary on PATH.
- WSL/Linux/macOS: use `npx -y scythe-context-mcp` or `node dist/index.js` from a build produced in that same environment.
- Windows Codex App with WSL workspaces: prefer Windows `wsl.exe` as a wrapper that starts WSL Node and WSL npm package dependencies. This keeps the repo-local SQLite index on the WSL filesystem. Use `SCYTHE_CONTEXT_DEFAULT_PROJECT` only when intentionally pinning one fixed default project.

Do not mix a Node runtime from one OS with `node_modules` installed by another OS. This matters because Scythe Context depends on native SQLite modules.

### Windows App with WSL workspaces

When Codex App runs a WSL project, prefer launching Scythe Context through Windows `wsl.exe` and a WSL-installed `scythe-context-mcp` binary:

- Current Codex App on Windows may not reliably start WSL-side stdio MCP servers directly while using WSL agent mode. If MCP tools are missing, handshakes time out, or config paths cross Windows/WSL boundaries, use `wsl.exe` as a wrapper.
- Install the package inside WSL, then point the wrapper command at the WSL global binary, for example `/home/you/.nvm/current/bin/scythe-context-mcp`.
- Keep the WSL Node path at the front of `PATH` inside the wrapper command. This avoids accidentally resolving a Windows npm global shim from the inherited Windows PATH.
- Do not pin `cwd` in global config. Let Codex's current workspace and `PWD` decide the target repo.
- Use `WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"` when config env variables must survive the WSL -> Windows `wsl.exe` -> WSL round trip.
- Do not use Windows Node to directly read or write `.scythe-context/index.sqlite` inside a WSL repo. In live testing this can fail with `database is locked` across the UNC / WSL filesystem boundary.
- Do not point Windows `node.exe` at a WSL checkout's `dist/index.js` unless dependencies were installed by Windows npm in that checkout.

The reason is both filesystem and native dependency compatibility. `better-sqlite3` and `sqlite-vec` load platform-specific binaries, and SQLite locking is more predictable when the Node process and index database live in the same OS filesystem.

### AGENTS.md

Codex reads `AGENTS.md` before work and layers global plus project guidance. Scythe Context's `AGENTS.md` is intentionally short enough to fit comfortably under the default project instruction limit and focuses on:

- Preferred tool workflow.
- Privacy rules for `.scythe-context/` and `local/`.
- Verification commands.

This is aligned with Codex's expected durable instruction surface.

### Tool output shape

The current MCP output is optimized for Codex use:

- JSON text responses are deterministic and easy to inspect.
- `repo_context_pack` is the preferred single-call workflow for code lookup.
- `max_context_chars` and `max_related_context_chars` keep output bounded.
- `suggestedPaths`, line ranges, `matchReason`, `grepKeywords`, symbols, imports, reverse imports, and related snippets give Codex actionable next steps without forcing whole-file reads.

### Tool policy

Recommended config should expose all tools by default during development, but `enabled_tools` is documented so users can pin the expected tool surface. Keep `gemini_embedding_probe` available because it is the fastest way to debug official Gemini or proxy compatibility.

## Optimizations Already Applied

- STDIO MCP server.
- Early, self-contained server instructions.
- `AGENTS.md` project guidance.
- Valid Codex TOML examples using `[mcp_servers.scythe_context.env]`.
- Secret-safe config examples using `env_vars` for `GEMINI_API_KEY`.
- `cwd` in MCP config so relative `.env` loading is predictable.
- Windows App + WSL setup guidance using Windows `wsl.exe`, WSL Node, npm package dependencies installed in WSL, `PWD`, and `WSLENV`.
- `startup_timeout_sec` and `tool_timeout_sec` tuned above defaults.
- Bounded context output for primary and related snippets.
- Explicit opt-in embedding and opt-in related snippet packing.
- `repo_index_status` freshness diagnostics for stale/new/modified/missing files.

## Remaining Work

- Consider a plugin package later if Codex App plugin distribution becomes the preferred installation route.
- Add tree-sitter symbol extraction only if regex extraction becomes a retrieval-quality bottleneck.
- Continue polishing error-specific remediation hints after more real proxy failures are observed.

## Troubleshooting

### MCP server does not appear

1. In the Codex TUI, run `/mcp` and confirm `scythe_context` appears.
2. Confirm the config is in `~/.codex/config.toml` or in a trusted project's `.codex/config.toml`.
3. Restart Codex after changing config. Codex reads MCP config at session startup.
4. Check that `command`, `args`, and `cwd` point to the built repo and that `npm run build` has produced `dist/index.js`.
5. If startup is slow on WSL or a cold Node install, raise `startup_timeout_sec`.

### Windows App starts but WSL repo indexing fails

1. Prefer the `wsl.exe` wrapper that starts WSL Node and a WSL-installed `scythe-context-mcp` binary.
2. Confirm WSL has its own install: `npm install -g scythe-context-mcp`, then `command -v scythe-context-mcp`.
3. Keep WSL Node's bin directory before Windows paths in the wrapper command's `PATH`.
4. Do not set global `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT` unless you intentionally want one fixed repo.
5. Use `WSLENV` without suffixes for the wrapper mode, for example `PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY`.
6. If you see `invalid ELF header`, the process probably loaded a Windows npm package or shim from WSL; fix `PATH` or reinstall inside WSL.
7. If you see `database is locked` while using Windows Node against a WSL repo, switch to the `wsl.exe` wrapper so SQLite is opened by WSL Node on the WSL filesystem.

### Tool starts but embedding fails

1. Run `gemini_embedding_probe` with a short test string.
2. Verify `GEMINI_API_KEY` is present in the environment Codex launches from.
3. For proxy endpoints, verify `GEMINI_BASE_URL` can include or omit a trailing slash and can include or omit `/v1beta`.
4. If batch indexing fails but single requests work, run `repo_reindex(index_embeddings=true, max_embedding_chunks=...)` again; the embedding writer falls back to single requests.

### Search returns index missing

1. Run `repo_index_status`.
2. Run `repo_reindex(dry_run=false)` for metadata.
3. Run `repo_reindex(dry_run=false, index_embeddings=true)` only when semantic search or context packs need vectors.
4. Keep `max_embedding_chunks` low for the first pass on large repos.

### Context output is too large

1. Lower `max_context_chars`.
2. Keep `include_related_snippets=false` for broad exploration.
3. Lower `max_related_files`, `related_depth`, or `max_related_context_chars`.
4. Use `repo_related_files` for one focused file instead of a broad context pack.

### AGENTS.md changes do not apply

Codex reads `AGENTS.md` when a run or TUI session starts. Restart Codex in the project root after changing guidance. If using nested instructions, remember that closer files override earlier root guidance.
