# Security Policy

## Sensitive Data

Scythe Context indexes local repository text and can send chunk/query text to the configured Gemini-compatible embedding endpoint when `index_embeddings=true` or semantic search/context packs require query embeddings.

Do not use a third-party proxy for repositories whose contents you cannot share with that service. Keep API keys in environment variables or local secret stores, not in committed config files.

The following paths are local-only and must not be committed:

- `.scythe-context/`
- legacy `.repo-beacon/`
- `local/`
- `.env`

## Reporting Issues

If you find a security issue, open a private advisory if the repository host supports it. If that is unavailable, contact the maintainer privately before filing a public issue.

Do not include API keys, proxy tokens, private source snippets, or full local index databases in public reports.

## Install Scripts

This project depends on native/runtime packages such as `better-sqlite3`, `sqlite-vec`, and development tooling that may use install scripts. Review install scripts according to your package-manager policy before installing in restricted environments.
