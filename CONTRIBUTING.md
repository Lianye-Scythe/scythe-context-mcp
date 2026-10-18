# Contributing

## Development

```bash
git clone https://github.com/Lianye-Scythe/scythe-context-mcp.git
cd scythe-context-mcp
npm ci
npm test
npm run build
```

Before submitting a completed change, run:

```bash
npm run verify
```

## Tests

Tests live beside the implementation and are grouped by responsibility:

| Area | Test files |
| --- | --- |
| TS/JS aliases, project selection and workspace exports | `typescriptPaths.test.ts`, `typescriptProjects.test.ts`, `workspacePackages.test.ts` |
| Cargo roots and Rust navigation rules | `rustTargets.test.ts` |
| Metadata persistence, incremental updates and chunk/FTS caches | `indexWriter.test.ts` |
| Related-file traversal, path classification and snippet budgets | `relatedFiles.test.ts`, `relatedSnippets.test.ts` |
| Configuration refresh and real CLI/MCP workflows | `configNavigation.test.ts`, `multiLanguage.test.ts`, `cli.integration.test.ts` |

The indexing tests are under `src/indexing/`; `cli.integration.test.ts` is directly under `src/`. Resolution-rule tests and workflow tests cover different boundaries, including filesystem changes, persistent indexes and transport behavior.

## Project Boundaries

- Keep indexing, storage, provider, search, and MCP tool wiring decoupled.
- Preserve stable chunk row ids for unchanged files so embedding cache remains useful.
- Add focused tests when changing scanner, chunker, schema, ranking, formatting, provider compatibility, or MCP output shape.
- Do not commit `.scythe-context/`, `.repo-beacon/`, `local/`, `.env`, API keys, proxy tokens, or private test fixtures.

## Documentation

`README.md` is the canonical English entry point. Keep `README.zh-TW.md` (Traditional Chinese) and `README.zh-CN.md` (Simplified Chinese) synchronized in the same change: section order, examples, defaults, privacy behavior, limitations, and document links must agree. Use identical executable code blocks across languages; translate explanations around them.

Update the relevant file in `docs/` when behavior changes. Put platform and advanced settings in `docs/setup.md` rather than expanding the quick start. Mark linked documents that are currently available only in Traditional Chinese. Keep `docs/README.md` up to date; put historical plans and experiments in `docs/archive/` with dates and a status notice. Prefer concrete Codex config examples and avoid machine-specific absolute paths except as placeholders.

## Dependency Updates

Dependabot opens grouped patch/minor update PRs monthly; major updates remain separate. Merging and publishing remain reviewed actions. Follow the [dependency maintenance policy](docs/dependency-maintenance.md), including current-commit CI, migration notes, script review, full audit, and benchmark checks.

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
npm run release:prepare -- patch
npm run verify
git add package.json package-lock.json CHANGELOG.md
git commit -m "Release x.y.z"
git push origin main
git tag vx.y.z
git push origin vx.y.z
```

Use `minor`, `major`, or an explicit `x.y.z` version instead of `patch` when needed.

The publish workflow checks that the tag matches `package.json`, reruns `npm run verify`, publishes to npm through OIDC trusted publishing when the version is not already published, and creates the matching GitHub Release from that version's `CHANGELOG.md` section. If the workflow is rerun after npm publication, it skips `npm publish` and still creates the GitHub Release when it is missing.
