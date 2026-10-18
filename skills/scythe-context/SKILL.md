---
name: scythe-context
description: Find code in unfamiliar repositories with ranked local search, bounded context packs, and import navigation through the Scythe Context CLI. Prefer rg for exact strings and direct reads for known file ranges.
---

# Scythe Context CLI

Use the installed `scythe-context` command. Read `scythe-context --help` when additional options are needed. If unavailable, use a built source checkout through `node /absolute/path/to/scythe-context-mcp/dist/command.js`; do not download or install packages just to discover commands.

## Choose the lookup tool

- Read files directly when the relevant path and range are known. Use `rg --files` to locate a known filename or path pattern.
- Use `rg` for exact names, error messages, literals, regular expressions, or an exhaustive textual match list. It searches current files without an index; prefer it for a simple lookup rather than building an index solely for that lookup.
- Use Scythe `search` when you need ranked candidates across an unfamiliar repository. Use `context` when import relationships and bounded related snippets would help trace the implementation; use `related` for a focused view of an indexed file's symbols, imports, and reverse imports.
- Local `keyword` retrieval depends on matching terms; it does not provide semantic understanding or reliably bridge different languages or synonyms. Start with identifiers or technical terms likely to appear in the source. If wording mismatch prevents useful results, consider the optional embeddings workflow below when within scope.
- Once results identify enough relevant code, read those file ranges and continue the task. Avoid repeating the same lookup through both tools without a missing piece to resolve. Neither faster task completion nor lower total token use is guaranteed.

## Local lookup

Run commands in the target repository or supply `--project /absolute/repo/path`. Explicit project selection overrides the configured default.

```bash
scythe-context status
# Only when metadata is missing or stale:
scythe-context index
scythe-context context "auth token validation"
```

Search and context commands default to local `keyword` mode and `paths` output. Index freshness affects these results; `rg` and direct reads use current file contents. Read the matching file ranges next.

For a short code preview, add `--format compact`. Use `--format snippets` for fuller snippets and ranking fields with `--json`. Keep output bounded with `--max-results` and `--max-context-chars`.

```bash
scythe-context context "auth token validation" --format compact --max-results 3
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
