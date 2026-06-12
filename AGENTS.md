# Repo Beacon MCP Agent Guide

## Workflow

- Start with `repo_index_status` to check whether `.repo-beacon/index.sqlite` exists and whether files, chunks, symbols, dependencies, and embeddings are present.
- If metadata is missing or stale, run `repo_reindex` with `dry_run=false`.
- Set `index_embeddings=true` only when semantic search is needed. This sends chunk text to the configured Gemini-compatible endpoint.
- Prefer `repo_context_pack` for task-oriented code lookup. It combines hybrid search, snippet budgeting, related-file metadata, and suggested paths.
- Use `repo_semantic_search` when debugging raw ranking behavior. Prefer a smaller `max_context_chars` for broad exploration and increase it only when the returned snippets are not enough.
- After a search result identifies a useful file, call `repo_related_files` for that file when you need a focused view of its symbols, imports, and reverse imports.

## Privacy

- Do not commit `.repo-beacon/` or `local/`.
- Do not print API keys, proxy tokens, or contents of files under `local/secrets/`.
- Treat third-party Gemini-compatible proxy endpoints as remote services that can see query and chunk text.

## Development

- Keep indexing, storage, provider, search, and MCP tool wiring decoupled.
- Preserve stable chunk row ids for unchanged files so embedding cache remains useful.
- Add focused tests when changing scanner, chunker, schema, ranking, formatting, or provider compatibility.
- Run `npm test`, `npm run build`, and `npm audit --omit=dev` before committing a completed development slice.
