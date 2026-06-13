# Contributing

## Development

```bash
npm install
npm test
npm run build
```

Before submitting a completed change, run:

```bash
npm test
npm run build
npm audit --omit=dev
```

## Project Boundaries

- Keep indexing, storage, provider, search, and MCP tool wiring decoupled.
- Preserve stable chunk row ids for unchanged files so embedding cache remains useful.
- Add focused tests when changing scanner, chunker, schema, ranking, formatting, provider compatibility, or MCP output shape.
- Do not commit `.scythe-context/`, `.repo-beacon/`, `local/`, `.env`, API keys, proxy tokens, or private test fixtures.

## Documentation

Update `README.md` and the relevant file in `docs/` when behavior changes. Prefer concrete Codex config examples and avoid machine-specific absolute paths except as placeholders.
