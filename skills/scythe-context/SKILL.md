---
name: scythe-context
description: Find code in unfamiliar repositories with the Scythe Context CLI, including conceptual lookup, bounded context packs, and tracing imports. Use direct reads or rg for known paths and exact strings.
---

# Scythe Context CLI

Use the installed `scythe-context` command. Read `scythe-context --help` when additional options are needed. If unavailable, use a built source checkout through `node /absolute/path/to/scythe-context-mcp/dist/command.js`; do not download or install packages just to discover commands.

## Local lookup

Run commands in the target repository or supply `--project /absolute/repo/path`. Explicit project selection overrides the configured default.

```bash
scythe-context status
# Only when metadata is missing or stale:
scythe-context index
scythe-context context "where is authentication validated?"
```

Search and context commands default to local `keyword` mode and `paths` output. Read the matching file ranges next. Use `search` for ranked matches alone; `context` also includes related-file navigation hints. Prefer `rg` or direct reads when a path or exact string is already known.

For a short code preview, add `--format compact`. Use `--format snippets` for fuller snippets and ranking fields with `--json`. Keep output bounded with `--max-results` and `--max-context-chars`.

```bash
scythe-context context "where is authentication validated?" --format compact --max-results 3
scythe-context related src/auth.ts
```

`related` takes an indexed repository-relative path. Its graph shows symbols, imports, and reverse imports; it is not a complete runtime call graph.

## Structured and saved results

`--json` returns the shared operation payload. Status, index, related, and doctor already print JSON by default. `--output /absolute/result.json` saves that payload and prints the absolute output path, allowing selective file reads instead of putting the full result into context. `--format` controls payload detail independently of `--json`.

Exit code 0 includes successful empty searches and reported hybrid fallback. Nonzero exit codes indicate invalid arguments, missing indexes for lookups, failed operations, or doctor errors. Check the JSON status and stderr. `doctor` runs local diagnostics without embedding requests. If a payload recommends an MCP tool, use `status` for `repo_index_status` or `index` for `repo_reindex`.

## Optional embeddings

Use embeddings when semantic retrieval is needed and sending the relevant text to the configured endpoint is within the task's scope:

```bash
scythe-context index --embeddings
scythe-context context "authentication flow" --mode hybrid --format compact
```

`index --embeddings` sends indexed chunks; hybrid and semantic lookup send query text. The configured Gemini-compatible service may charge for requests and can see the text. Keep credentials in the environment or a protected local `.env`. Keep `.scythe-context/` and result files containing private code out of commits.

Hybrid lookup reports keyword fallback if query embedding fails. Semantic mode returns an error instead. Embedding coverage may be partial; inspect `status` before relying on vector retrieval.
