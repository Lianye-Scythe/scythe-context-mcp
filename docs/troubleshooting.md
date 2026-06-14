# Troubleshooting and First-Run Checks

This guide focuses on the first checks after installing Scythe Context MCP in Codex App / CLI. It avoids fixed repository paths: normal multi-repo usage should follow the current Codex workspace through `project_path`, `PWD`, or the MCP process `cwd`.

## Quick Check

After configuring the MCP server and restarting Codex:

1. Confirm the server is visible in Codex.
   - Codex CLI/TUI: run `/mcp` and check that `scythe_context` appears.
   - Codex App: confirm the configured project session exposes Scythe Context tools.
2. Run `repo_doctor`.
   - Use the default compact output first.
   - It does not call the Gemini endpoint.
   - It checks runtime, native modules, environment, WSL interop hints, provider capability cache, and index health.
   - On a brand-new repo, `repo_doctor` may report a warning because the index does not exist yet. Run `repo_reindex({ "dry_run": false })`, then run `repo_doctor` again.
3. Run `repo_index_status`.
   - If metadata is missing or stale, run `repo_reindex({ "dry_run": false })`.
   - Add `index_embeddings=true` only when semantic or hybrid search needs vectors.
4. Run `gemini_embedding_probe` only when you need to verify the configured Gemini-compatible endpoint.
   - This call sends the test text to the provider.
   - It does not print the API key.

## Project Detection

Scythe Context resolves the target project in this order:

1. Explicit tool argument `project_path`.
2. `SCYTHE_CONTEXT_DEFAULT_PROJECT`, only when intentionally pinning one repo.
3. `PWD`, when Codex forwards it.
4. MCP process `cwd`.

For global Codex config, do not set a fixed `cwd` or `SCYTHE_CONTEXT_DEFAULT_PROJECT`. Fixed paths are useful only in project-scoped `.codex/config.toml` or one-repo automation.

## Windows Codex App with WSL Repos

Current Codex App WSL behavior can make direct WSL-side stdio MCP startup unreliable. The recommended workaround is:

1. Install Scythe Context inside WSL:

   ```bash
   npm install -g scythe-context-mcp
   command -v scythe-context-mcp
   scythe-context-mcp --version
   ```

2. Configure Codex on Windows to launch Windows `wsl.exe`, and let `wsl.exe` start the WSL binary.
3. Keep the WSL Node/npm bin directory first in the wrapper `PATH`.
4. Forward `PWD` and secrets with `env_vars`, and preserve cross-boundary variables with `WSLENV`.

For wrapper mode, use no suffixes:

```toml
[mcp_servers.scythe_context]
command = "/mnt/c/Windows/System32/wsl.exe"
args = ["-d", "Ubuntu", "--", "bash", "-lc", "PATH=/home/you/.nvm/current/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin exec /home/you/.nvm/current/bin/scythe-context-mcp"]
startup_timeout_sec = 40
tool_timeout_sec = 120
env_vars = ["PWD", "GEMINI_API_KEY"]

[mcp_servers.scythe_context.env]
WSLENV = "PWD:GEMINI_API_KEY:GEMINI_BASE_URL:GEMINI_MODEL:GEMINI_AUTH_MODE:GEMINI_OUTPUT_DIMENSIONALITY"
GEMINI_BASE_URL = "https://your-proxy.example.com/v1beta"
GEMINI_MODEL = "gemini-embedding-2"
GEMINI_AUTH_MODE = "bearer"
GEMINI_OUTPUT_DIMENSIONALITY = "1536"
```

Use `PWD/p` only when deliberately running a Windows Node process that must receive a Windows-readable converted path. That mode is not recommended for directly indexing WSL repositories because SQLite locking and native module boundaries are easier to break.

## Common Failures

### npm Install Script Warnings

Fresh installs can print npm warnings about install scripts for native dependencies such as `better-sqlite3`. This is expected for packages that load native SQLite bindings.

- If installation completes and `scythe-context-mcp --version` works, continue with `repo_doctor`.
- If native module loading fails later, run `repo_doctor` and check the native module section.
- Do not copy `node_modules` between Windows and WSL. Reinstall in the same environment that runs the MCP server.

### MCP Tools Do Not Appear

- Restart Codex after editing config.
- Check the config file location and trust/project scope.
- Use absolute paths for Windows `node.exe`, npm `npx-cli.js`, or `wsl.exe` wrapper commands.
- Increase `startup_timeout_sec` for cold `npx` downloads or slow WSL startup.

### Native Module Errors

Errors such as `invalid ELF header`, missing `.node` files, or SQLite load failures usually mean the Node runtime and installed `node_modules` belong to different platforms.

- Windows Node must use dependencies installed by Windows npm.
- WSL Node must use dependencies installed by WSL npm.
- Do not point Windows Node at a WSL checkout's `dist/index.js` unless dependencies were installed by Windows npm in that checkout.

### WSL Database Locking

If a Windows Node process writes `.scythe-context/index.sqlite` inside a WSL repo through a UNC path, SQLite can fail with locking issues. Switch to the `wsl.exe` wrapper so WSL Node opens the database on the WSL filesystem.

### Embedding Probe Fails

- Confirm `GEMINI_API_KEY` is present in the environment Codex starts from, or is forwarded through `env_vars`.
- Confirm `GEMINI_BASE_URL` can be normalized to a valid endpoint. Scythe accepts roots with or without trailing slash and with or without `/v1beta`.
- Use `GEMINI_AUTH_MODE=bearer` for proxy services that expect `Authorization: Bearer ...`.
- Use `GEMINI_AUTH_MODE=x-goog-api-key` for official Gemini unless your proxy documents otherwise.
- Check whether the proxy supports `models/{model}:embedContent` and the configured `GEMINI_OUTPUT_DIMENSIONALITY`.

### Search Falls Back to Keyword

`repo_context_pack(mode="hybrid")` and `repo_semantic_search(mode="hybrid")` intentionally fall back to keyword-only results when query embedding is unavailable. The response includes `effectiveMode: "keyword"` and an embedding fallback reason.

Use `repo_doctor` and `gemini_embedding_probe` to diagnose provider configuration, then rerun `repo_reindex({ "dry_run": false, "index_embeddings": true })` when the provider is fixed.

## Keep Diagnostics Safe

Do not paste API keys, proxy tokens, private source code, `.scythe-context/`, `.repo-beacon/`, `local/`, or `.env` contents into public issues or PRs. Compact tool responses are designed to be easier to redact than full outputs.
