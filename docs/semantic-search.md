# Optional Semantic Search

Keyword search, symbols, import navigation, and context packing work without embeddings or an API key. Start there. Try embeddings when relevant code uses different terms from your query and local results are insufficient; compare retrieval on representative tasks in your repository. A retrieval score does not establish an improvement in agent task completion or total token use; see the [benchmark](benchmark.md).

Both interfaces use the same provider and vector index. CLI search/context default to `keyword`; MCP defaults to `hybrid`. Selecting an interface does not change the embedding model or improve retrieval accuracy by itself.

## CLI setup

Supply `GEMINI_API_KEY` through the CLI process environment. Do not put the key in command arguments or committed files. Provider settings and proxy options are documented in [setup](setup.md#gemini--v1beta-proxy).

```bash
# Preview index scope locally first; this does not send embedding requests:
scythe-context index --project /absolute/path/to/repo --dry-run
# These commands send chunks or query text to the configured endpoint:
scythe-context index --project /absolute/path/to/repo --embeddings
scythe-context context "where is auth token validation handled?" --project /absolute/path/to/repo --mode hybrid --format compact
```

Use `--mode semantic` for vector retrieval without keyword fallback, or `--mode keyword` to search locally. The endpoint creates vectors used by Scythe's retrieval engine.

## MCP setup

Keep `GEMINI_API_KEY` in the environment that starts Codex and forward it to the existing server configuration. Do not commit the key. Then build vectors and use hybrid search:

```toml
# Add this field to the existing [mcp_servers.scythe_context] table.
env_vars = ["GEMINI_API_KEY"]
```

```text
repo_reindex({ "project_path": "/absolute/path/to/your/repo", "dry_run": false, "index_embeddings": true })
repo_context_pack({ "project_path": "/absolute/path/to/your/repo", "query": "where is auth token validation handled?", "mode": "hybrid" })
```

These calls send repository chunks and query text to the configured endpoint, which may incur provider charges. Defaults are `https://generativelanguage.googleapis.com/v1beta`, model `gemini-embedding-2`, and 1536 dimensions. For proxies and authentication settings, see [setup](setup.md).

## Modes and privacy

**MCP search mode defaults to `hybrid`, even though the quick start explicitly uses `keyword`; CLI search/context default to `keyword`.** If a key is configured, omitting `mode` can send the query to the provider. Use `mode="keyword"` to avoid embedding requests.

| Mode | Embedding requests | If query embedding fails |
| --- | --- | --- |
| `keyword` | None; metadata only | Not applicable |
| `hybrid` (MCP default) | Sends the query; indexed vectors support semantic retrieval | Falls back to keyword and reports the fallback |
| `semantic` | Sends the query; requires indexed vectors | Returns an error without keyword fallback |

`GEMINI_REQUEST_TIMEOUT_MS` defaults to `10000` and bounds each embedding request, including the response body. It does not limit the entire indexing job. `gemini_embedding_probe` also sends its test text to the endpoint. Third-party proxies can see the text sent to them.

Index files stay in `.scythe-context/`. Keep that directory, legacy `.repo-beacon/`, `.env`, and `local/` out of version control. Exclude private files from indexing with `.gitignore`, and check scope before enabling embeddings. Do not include secrets, private source, or index databases in public issues or logs.

Return to the [README](../README.md) or [documentation index](README.md).
