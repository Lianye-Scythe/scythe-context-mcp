# Dependency Maintenance

## Routine updates

Dependabot opens version-update PRs monthly. npm production and development patch/minor updates are grouped separately; GitHub Actions patch/minor updates form one group. Major updates remain separate for review. Version-update queues are limited to three npm PRs and two Actions PRs.

Actions use full release tags so patch/minor updates are visible in reviewed PRs rather than silently following a moving major tag.

This automates discovery and PR creation, not merging or npm publication. Security alerts/updates have separate GitHub settings and scheduling; the monthly version-update interval does not replace security triage. Review security fixes promptly when notified. No repository security settings were changed by this maintenance slice.

Before merging, check **all** direct dependencies with `npm outdated` and live registry metadata, not only the packages named by a pending PR. Record any deliberately retained versions and their concrete reasons. A clean `npm audit` does not mean dependencies are current.

Inspect upstream compatibility notes and install scripts, restore dependencies with `npm ci`, and run `npm run verify` plus `npm run bench:gate`. Confirm CI belongs to the current PR commit. Treat native SQLite, parser, compiler, and GitHub Action major updates as explicit migrations rather than assuming older CI results still apply.

Automatic merging is not enabled. It can be considered later for narrowly scoped patch updates after reliable Windows/WSL and provider workflow coverage exists. Do not auto-publish a new npm release merely because a dependency PR passes CI.

## Cleanup on 2026-10-12

Four old Dependabot PRs were superseded by an integrated update on current `main`:

| PR | Original proposal | Integrated version |
| --- | --- | --- |
| [#17](https://github.com/Lianye-Scythe/scythe-context-mcp/pull/17) | Production dependency group | `better-sqlite3` 13.0.3; `web-tree-sitter` 0.27.1 |
| [#13](https://github.com/Lianye-Scythe/scythe-context-mcp/pull/13) | Development dependency group | TypeScript 7.0.2; Node types 26.6.5; tsx 4.23.15; Vitest 5.0.4 |
| [#8](https://github.com/Lianye-Scythe/scythe-context-mcp/pull/8) | checkout v7 | `actions/checkout@v7.0.1` |
| [#15](https://github.com/Lianye-Scythe/scythe-context-mcp/pull/15) | setup-node v7 | `actions/setup-node@v7.1.0` |

Versions were checked against the configured npm registry and official repositories on the review date. None of the selected npm releases was deprecated. Exact transitive versions are in the lockfile. Full npm audit reported zero vulnerabilities after the update; this is a dated observation, not an ongoing guarantee.

The original #17 CI failed at the production audit. Its old base still included the removed fast-glob chain; its checks predate intervening maintenance, so the proposals were revalidated on current `main`. The integrated update preserves the MCP SDK security update and current documentation.

`better-sqlite3` 13 switches to N-API and bundled prebuilds. Its implicit `node-gyp rebuild` checks for a host prebuild before compiling. The script was reviewed and approval is pinned to 13.0.3; the old 12.10.1 approval was removed. Existing esbuild approval remains pinned to 0.28.1.

TypeScript 7 distributes a native compiler through official platform packages. The build and type checks passed with the existing project configuration. Vitest 5 passed the existing test suite. These checks establish this repository's supported flow, not every third-party platform or grammar configuration.

setup-node v7 removes the dummy `NODE_AUTH_TOKEN` fallback. Upstream explicitly states that npm Trusted Publishing through OIDC is unaffected; this project uses OIDC. The Actions updates are verified by current GitHub CI; the publication workflow is not run until a release tag is created.

## Upstream references

- [better-sqlite3 13.0.0 migration](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
- [TypeScript 7.0.2](https://github.com/microsoft/TypeScript/releases/tag/v7.0.2)
- [Tree-sitter releases](https://github.com/tree-sitter/tree-sitter/releases)
- [Vitest releases](https://github.com/vitest-dev/vitest/releases)
- [setup-node v7 behavior](https://github.com/actions/setup-node#whats-new-in-v7)
- [checkout releases](https://github.com/actions/checkout/releases)

The [2026-10-11 dependency security record](dependency-security.md) describes the previous maintenance slice and its historical versions.

## Full direct-dependency review on 2026-10-17

| Dependency | Previous lockfile version | Reviewed update |
| --- | --- | --- |
| dotenv | 17.4.2 | 18.0.8 |
| ignore | 7.0.5 | 7.0.12 |
| zod | 4.4.3 | 4.6.7 |
| @types/better-sqlite3 | 7.6.13 | 9.6.0 |
| Vitest | 5.0.4 | 5.0.5 |

All twelve direct dependencies were compared with live metadata from the configured npm registry. These five were behind; the remaining seven already matched their latest stable releases. None of the selected releases was deprecated. No changed installed package introduced a preinstall, install, or postinstall script, and the existing pinned script approvals remained unchanged.

The [dotenv 18 changelog](https://github.com/motdotla/dotenv/blob/v18.0.8/CHANGELOG.md) describes the new CLI, logging changes, and removal of vault/preloading features. This project uses `import "dotenv/config"`, which remains supported. A fresh MCP process was launched from a temporary directory containing a synthetic `.env`: the configured default project and file-size limit were honored, stdio initialization succeeded, metadata indexing succeeded, and keyword context lookup returned the expected file. No embedding endpoint was called. Existing repository credentials were not used for that check.

SQLite type-definition versions do not need to match the driver version numerically. The updated declarations passed the TypeScript build against better-sqlite3 13.0.3. Existing tests and the retrieval benchmark also passed. Full npm audit reported zero vulnerabilities and `npm outdated` reported no outdated direct dependencies on the review date. These are dated observations, not a guarantee about future registry changes.
