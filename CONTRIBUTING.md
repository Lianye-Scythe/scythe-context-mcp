# Contributing

## Development

```bash
npm install
npm test
npm run build
```

Before submitting a completed change, run:

```bash
npm run verify
```

## Project Boundaries

- Keep indexing, storage, provider, search, and MCP tool wiring decoupled.
- Preserve stable chunk row ids for unchanged files so embedding cache remains useful.
- Add focused tests when changing scanner, chunker, schema, ranking, formatting, provider compatibility, or MCP output shape.
- Do not commit `.scythe-context/`, `.repo-beacon/`, `local/`, `.env`, API keys, proxy tokens, or private test fixtures.

## Documentation

Update `README.md` and the relevant file in `docs/` when behavior changes. Prefer concrete Codex config examples and avoid machine-specific absolute paths except as placeholders.

## Release

Releases are intended to publish from GitHub Actions, not from a local shell.
This avoids repeated local publish checks and npm one-time-password prompts.

One-time npm setup for the package owner:

1. Open the package settings on npmjs.com.
2. Add a [Trusted Publisher](https://docs.npmjs.com/trusted-publishers/) for GitHub Actions.
3. Use owner `Lianye-Scythe`, repository `scythe-context-mcp`, and workflow filename `publish.yml`.
4. Allow `npm publish`.

Release flow:

```bash
npm version patch --no-git-tag-version
# update CHANGELOG.md
npm run verify
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release x.y.z"
git push origin main
git tag vx.y.z
git push origin vx.y.z
```

The publish workflow checks that the tag matches `package.json`, reruns `npm run verify`, checks that the version is not already published, then publishes to npm through OIDC trusted publishing.
