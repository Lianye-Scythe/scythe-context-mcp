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

Choose the retrieval mode by the lookup need, not by whether an API key is configured. CLI search/context remain `keyword` by default; a key does not automatically select hybrid or build code embeddings.

| Lookup need | Preferred action |
| --- | --- |
| Exact identifier, error message, or literal | Use `rg`. |
| Likely source terms, with ranked results or related context needed | Use `keyword`. |
| Functional description with unknown implementation wording | Follow the hybrid preparation workflow below, then use `hybrid`. |
| Keyword results are insufficient because relevant code may use different terms | Follow the same workflow to try `hybrid`. |
| Enough relevant code has been located | Read the matching ranges; skip another retrieval pass. |

### Prepare or refresh hybrid retrieval

1. Run `status` to check metadata freshness, chunk counts and embedding sets; use `status --format full` or `doctor` when configuration details are needed. Do not print credentials. Counts alone do not prove that vectors cover current relevant code or match the configured endpoint.
2. If current vectors are usable for the lookup and query transmission is within scope, search with `--mode hybrid` directly. Do not rebuild vectors before every query.
3. If vectors are absent, incomplete for the needed code, or source files have changed, decide whether semantic retrieval justifies creating/updating them. Sustained exploration of unfamiliar code with unknown terminology, or repeated keyword misses caused by wording differences, are useful reasons. A precise one-off lookup or an index coverage recommendation alone is not.
4. When justified, credentials are available, and the task permits transmitting the indexed source and incurring provider usage, proactively run `index --embeddings` to create or refresh vectors. Continue under existing authorization; ask only if a required data-transmission or cost decision is unresolved. Preview unfamiliar indexing scope with `index --dry-run` when needed, and use `--max-embedding-chunks` to bound the job to a task-appropriate budget. The limit caps chunk count, not monetary cost, and does not select files by relevance.
5. Check the indexing result and `status` before hybrid lookup. Metadata refresh happens before missing-vector indexing; unchanged chunks with existing vectors are reused for the configured endpoint/model/dimensions. Job limits or failures may leave partial coverage. Use hybrid with that limitation when useful, or continue with keyword/direct reads. Do not loop to fill all vectors unless the task warrants it, and do not repeat a failed API operation without addressing its cause.

If source transmission or provider usage is outside scope, continue local lookup. A configured API key by itself is not authorization to upload source. Query transmission and source-chunk transmission are separate decisions.

When step 4 applies, prepare embeddings before the query; otherwise use existing usable vectors:

```bash
# Only when creation/update is justified and source transmission is in scope:
scythe-context index --embeddings
scythe-context context "temporarily block login after repeated failures" --mode hybrid --format compact --max-results 3
```

`index --embeddings` sends indexed chunks; hybrid and semantic lookup send query text. The configured Gemini-compatible service may charge for requests and can see the text. Keep credentials in the environment or a protected local `.env`. Keep `.scythe-context/` and result files containing private code out of commits.

Hybrid lookup reports keyword fallback if query embedding fails; inspect the reported effective mode rather than assuming vector retrieval succeeded. Semantic mode returns an error instead. Do not repeat the same remote query without addressing the failure. Use explicit `--mode keyword` for local lookup, including when credentials are present.
