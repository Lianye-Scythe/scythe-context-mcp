# Gemini-Compatible Provider

Status: current adapter behavior, reviewed against version 0.1.15 on 2026-10-11. This guide describes what Scythe sends and validates; endpoint/model availability and data retention depend on the provider. Use [setup](setup.md#gemini--v1beta-proxy) for Codex configuration. Local `mode="keyword"` search requires none of these provider settings.

## Defaults and request format

| Setting | Default |
| --- | --- |
| `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` |
| `GEMINI_MODEL` | `gemini-embedding-2` |
| `GEMINI_AUTH_MODE` | `x-goog-api-key` |
| `GEMINI_API_KEY_HEADER` | `x-goog-api-key` |
| `GEMINI_API_KEY_QUERY_PARAM` | `key` |
| `GEMINI_OUTPUT_DIMENSIONALITY` | `1536` |
| `GEMINI_REQUEST_TIMEOUT_MS` | `10000` |

`GEMINI_API_KEY` is required for provider calls. The adapter uses REST methods `models/{model}:embedContent` and `models/{model}:batchEmbedContents`, with text under `content.parts` and an `output_dimensionality` field. A model name may include the `models/` prefix.

Scythe formats query and document text before sending it:

```text
task: code retrieval | query: {query}
title: {path or title} | text: {chunk}
```

The adapter uses these prefixes rather than a `task_type` field. Check [Google's embeddings documentation](https://ai.google.dev/gemini-api/docs/embeddings) for the current API contract; proxies must accept the format used by this adapter.

## URL normalization and authentication

A base URL may include a path prefix. Trailing slashes are removed; `/v1beta` is appended unless the last path segment is already `v1` or `v1beta`. Query strings and fragments in the base URL are discarded. Do not put credentials in the base URL.

| Mode | Credential placement |
| --- | --- |
| `x-goog-api-key` | Header named by `GEMINI_API_KEY_HEADER`. |
| `bearer` | `Authorization: Bearer ...`. |
| `query` | Query parameter named by `GEMINI_API_KEY_QUERY_PARAM`. |

A custom header does not automatically add `Bearer `. If the provider requires Bearer authentication, choose `bearer`. Query authentication places the credential in the request URL; avoid sharing URLs or unredacted diagnostics. Configuration examples live in [setup](setup.md#gemini--v1beta-proxy).

## Dimensions and cached embeddings

Choose dimensions supported by the endpoint and model. Scythe defaults to 1536; it validates vector lengths against the expected dimensions. Larger dimensions increase vector size but are not an established accuracy improvement for every repository.

Changing provider, endpoint, model, or dimensions requires appropriate vectors for that configuration. Build them explicitly with `repo_reindex(index_embeddings=true)` and inspect coverage with `repo_index_status`. Do not assume old vectors can be reused with a different model.

## Batch compatibility

The embedding writer tries batch requests unless a verified observation marks batch unsupported. Batch HTTP 404, 405 or 501 can fall back to individual requests; the unsupported observation is recorded only after an individual request succeeds with the expected dimensions. Authentication errors, rate limits, timeouts, malformed responses and other errors do not trigger single-request fan-out or disable batch support. Results report `batchFallbacks`, including use of a cached fallback. Once verified unsupported, later batches in the same job also use individual requests.

Observations are stored in repo-local `.scythe-context/provider-capabilities.json` and keyed by provider, endpoint, model, dimensions, and auth mode. `batchEmbeddingVerified=true` distinguishes the new evidence from legacy observations that could have been caused by transient failures. Legacy unsupported records are rechecked on the next explicit embedding job; manually deleting the cache is not needed.

A successful single request does not prove batch support or compatibility for every input. This cache records observed behavior, not a provider certification.

## Timeouts and failure behavior

`GEMINI_REQUEST_TIMEOUT_MS` must be an integer from 1 to 2147483647 milliseconds. Each single or batch request uses this deadline, including reading the response body. An indexing pass may contain many requests and is not limited to this duration.

Document embedding requests (initial creation and incremental updates) retry transient network errors, timeouts, HTTP 408/409/425/429 and 500/502/503/504 at most twice after the initial attempt. Waiting uses exponential backoff starting at 500 ms plus jitter. A valid `Retry-After` in seconds or HTTP-date form sets the minimum wait. Cumulative waiting is limited to 10 seconds per request: if the requested delay exceeds the remaining budget, Scythe stops and reports the delay instead of retrying too early. Each attempt has its own request timeout; the whole indexing job has no single time deadline. Retries can repeat provider work and are not a billing guarantee.

Timeouts return a retryable `GeminiEmbeddingError`. Query requests and embedding probes are not automatically retried. Hybrid search falls back to local keyword results with `fallback.reason="embedding_unavailable"`; semantic search returns `status="embedding_unavailable"` without keyword fallback.

If embedding indexing stops, CLI returns exit code 1 and MCP marks the reindex tool result as an error, both with `status="embedding_unavailable"`. Metadata and saved vectors remain available. The result includes an error `reason`, HTTP status when present, `attempts` and `retryAfterMs` when provided, plus `embeddingProgress` for this job and configured `embeddingCoverage` for the full index. Progress counts cover the selected job budget, which may be smaller than all missing chunks. Successful individual fallback vectors are persisted immediately, so resuming skips them even if a later request fails.

For 429, wait for the suggested delay or check provider quotas before running the same explicit embedding index command again. A `retryable` flag means a transient classification, not a promise that retries will succeed. `repo_doctor` shows the last observed error category, attempt count and delay without requiring a new provider call.

## Diagnostics and privacy

Use the following MCP call only when you intend to send the test text to the configured endpoint:

```text
gemini_embedding_probe({ "text": "find code that handles payment logging" })
```

The default output reports status, latency, dimensions, compatibility observations, and remediation hints. Full diagnostics can include provider response snippets; review them before sharing. Scythe redacts the configured API key from provider snippets, but that is not a guarantee that every field is safe to publish.

Metadata indexing and keyword queries stay local. Embedding indexing sends repository chunks; hybrid/semantic searches send queries; probes send test text. Third-party services may see or retain that text. See [troubleshooting](troubleshooting.md#embedding-probe-fails) and the [security policy](../SECURITY.md).
