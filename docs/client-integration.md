# Client integration: Codex, Claude Code and Antigravity CLI

Reviewed on 2026-10-18 with Scythe 0.1.24. The same Scythe CLI, index and packaged Skill can be used across clients. Skill discovery, MCP registration, permissions and process environments belong to the client. The verification table below distinguishes documentation compatibility from an actual agent lookup.

## Choose CLI + Skill or MCP

- **CLI + Skill:** install Scythe where the agent executes shell commands, then install the entire `skills/scythe-context/` folder in a location that client discovers. The Skill teaches lookup routing and optional vector maintenance.
- **MCP:** register the `scythe-context-mcp` executable as a local stdio server in the client. A separate Skill is optional for MCP use; server instructions already describe the tool workflow.

Both interfaces use the same engine. CLI search/context default to local keyword; MCP defaults to hybrid. Explicitly choose keyword for local MCP lookup. Do not assume that selecting a different client changes retrieval quality or makes API use necessary.

Start with the [README](../README.md#quick-start) and [platform setup](setup.md) for Node, installation and Windows/WSL details.

## Install and discover the Skill

After globally installing the npm package, run `npm root -g`. Under the printed directory, copy the entire `scythe-context-mcp/skills/scythe-context/` folder into one of the following locations. From a source checkout, copy `skills/scythe-context/` instead.

| Client | Repository installation | User installation | Explicit invocation |
| --- | --- | --- | --- |
| Codex CLI | `.agents/skills/scythe-context/` | `~/.agents/skills/scythe-context/` | `$scythe-context`; `/skills` lists skills. |
| Claude Code | `.claude/skills/scythe-context/` | `~/.claude/skills/scythe-context/` | `/scythe-context` |
| Antigravity CLI | `.agents/skills/scythe-context/` | `~/.gemini/antigravity-cli/skills/scythe-context/` | `/scythe-context`; `/skills` lists skills. |

Each installed folder must contain `SKILL.md`, not another nested `scythe-context/` directory. Use one scope per client where possible to avoid duplicate same-name skills. npm upgrades do not refresh separately copied Skills. If a client does not discover a new or changed Skill, refresh its skill list or restart it.

These are the current documented locations. An existing managed App installation may expose Skills through its own UI; check what the CLI actually lists instead of assuming the App's installed folder is shared. Antigravity App/IDE and CLI have different documented user locations: the App/IDE use `~/.gemini/config/skills/`, while CLI uses `~/.gemini/antigravity-cli/skills/`.

Sources: [OpenAI Skills](https://developers.openai.com/codex/skills), [Claude Code Skills](https://code.claude.com/docs/en/skills), [Antigravity Skills](https://antigravity.google/docs/skills).

## Register MCP when choosing that interface

Install Scythe first so `scythe-context-mcp` is on the server process's PATH. The following commands use no embedding key and do not pin a default repository. Run only the example for the client and configuration scope you want to change.

### Codex CLI

```bash
codex mcp add scythe_context -- scythe-context-mcp
codex mcp list
```

This uses Codex's MCP configuration, normally `~/.codex/config.toml`; trusted projects can use `.codex/config.toml`. App, CLI and IDE share configuration for the same Codex host. A Windows App and WSL CLI can have different homes and execution environments, so shared configuration must be verified in that setup. In an interactive CLI session, `/mcp` shows active servers.

See [OpenAI MCP documentation](https://developers.openai.com/codex/mcp) and the existing [Codex integration notes](codex-integration.md).

### Claude Code

```bash
claude mcp add --transport stdio --scope user scythe_context -- scythe-context-mcp
claude mcp list
```

`--scope user` applies across projects. Use `--scope project` for a shared project `.mcp.json`, or `--scope local` for that client's project-local user configuration. Claude's configuration is separate from Codex's TOML. Options precede the server name; arguments after `--` are passed to the server.

See [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

### Antigravity CLI

```bash
agy mcp add --type stdio scythe_context scythe-context-mcp
agy mcp list
```

For the checked CLI version, flags must precede the server name. `/mcp` opens the interactive MCP manager. Current official documentation places global server definitions in `~/.gemini/config/mcp_config.json` and workspace definitions in `.agents/mcp_config.json`, under the `mcpServers` key. Do not infer the MCP configuration directory from the different Skill directory above.

See [Antigravity MCP documentation](https://antigravity.google/docs/mcp). Use your installed client's help to check version-specific registration flags.

## Project paths, credentials and permissions

- Run CLI commands in the target repository or pass `--project /absolute/path/to/repo`. For MCP calls, pass `project_path` explicitly, using a path visible to the server process. Do not pin one repository in global configuration unless intentional.
- Verify `scythe-context --version` inside the agent's shell. Installing it in Windows does not install it in WSL, or conversely. Keep Node/native SQLite and the index in the same execution environment; use the [platform guide](setup.md).
- Client model authentication and Scythe embedding credentials are separate. Local indexing and keyword lookup do not need `GEMINI_API_KEY`. Hybrid/vector work requires usable vectors and the configured embedding provider; see [semantic search](semantic-search.md).
- MCP server `env` settings do not automatically become shell-command environment variables. Scythe also loads `.env` from its command working directory; `--project` does not select that file. Use protected process credentials or a protected, ignored `.env`, and inspect only `hasApiKey` through full status/doctor.
- The client must permit the required shell command and local index access. Headless runs may deny tool actions without an interactive prompt. Antigravity can exit successfully after a tool is soft-denied; verify tool events and actual lookup output, not just the exit code. See [Antigravity headless permissions](https://antigravity.google/docs/cli/headless#permissions-in-headless-mode) and [Claude Code permissions](https://code.claude.com/docs/en/permissions).

For embeddings, use the same Skill decision rules across clients: check configured coverage, create/update vectors only when justified and source transmission/provider usage are within scope, reuse existing vectors, and inspect fallback results. A client's model login is not an embedding authorization or a substitute for the provider key.

## Check an installation

First verify the client discovers the Skill. Then explicitly invoke it and ask:

```text
Use the scythe-context skill for a local keyword lookup of session access badge validation in this repository. Read the matching source range and report the file, function and successful return label. Do not use embeddings or edit source.
```

Replace the lookup subject with a real feature in your repository. A successful check has observable evidence of Skill activation, a Scythe command, a read of the returned range, and an answer supported by that source. A correct answer alone can come from another search path.

For MCP, separately check the client lists Scythe's seven tools, then follow the [README's explicit keyword tool calls](../README.md#mcp). MCP list/configuration syntax is not evidence that an agent successfully called the tools.

## Verification performed

| Client / version | Result on 2026-10-18 |
| --- | --- |
| Codex CLI 0.163.0 | Passed CLI + Skill lookup: read the project Skill, invoked Scythe keyword context, read the matching source range, and returned the correct file/function/label. |
| Claude Code 2.1.302 | Skill discovery confirmed: `scythe-context` appeared in startup skills and slash commands. Agent execution was blocked by `Not logged in`; no Scythe command ran. Full lookup remains unverified until client login is completed. |
| Antigravity CLI 1.4.0 | Passed CLI + Skill lookup: startup reported the expanded skill command, invoked Scythe keyword context, read the source through `view_file`, and returned the correct file/function/label. |

The checks used separate temporary repositories containing two generic TypeScript files and identical packaged Skills. Successful clients found `src/session.ts`, `checkAccessBadge`, and `amber-kite`; this label was not supplied in the task. A transparent PATH wrapper recorded calls to the installed Scythe 0.1.24 executable, while the agent event stream established source reading. Scythe used keyword mode; no embedding requests were made.

Global client configuration files were not changed. Codex used an ephemeral run without user config, Claude used project settings with an empty per-run MCP configuration, and the Antigravity fixture disabled inherited MCP entries within that workspace. No model was explicitly selected, and no blanket permission-bypass flags were used. These checks confirm one explicitly invoked local workflow, not implicit Skill selection quality, all permission modes, all platforms, or client-specific MCP end-to-end execution.

The package's existing tests cover CLI/MCP operation parity and multilingual navigation independently. See [retrieval workflow verification](retrieval-workflow-audit.md) for vector lifecycle checks and remaining retrieval limits.
