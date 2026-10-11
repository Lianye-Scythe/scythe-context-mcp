# Dependency security maintenance — 2026-10-11

The production audit initially reported 11 affected packages (1 low, 3 moderate, 6 high, 1 critical). Two dependency chains required changes: the MCP SDK and its transitive HTTP/validation dependencies, and `fast-glob` through `micromatch`/`braces`.

## Changes

| Package | Previous lockfile | Updated lockfile |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.29.0 | 1.32.1 |
| `@hono/node-server` | 1.19.14 | 2.1.4 |
| `body-parser` | 2.2.2 | 2.3.0 |
| `fast-uri` | 3.1.2 | 3.1.8 |
| `hono` | 4.12.25 | 4.13.13 |
| `ip-address` | 10.2.0 | 10.7.3 |
| `proxy-addr` | 2.0.7 | 2.0.8 |
| `qs` | 6.15.2 | 6.16.0 |
| `fast-glob` / `micromatch` / `braces` | 3.3.3 / 4.0.8 / 3.0.3 | Removed |

Release tags, publication history, deprecation metadata, repositories, and lifecycle scripts were checked against the configured public npm registry. The SDK update uses the latest stable release of the existing `@modelcontextprotocol/sdk` package. Its supported v1 security line remains separate from the v2 split packages; this maintenance slice does not migrate the MCP API. See the [official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk).

The SDK's dependency constraint now permits `@hono/node-server` 2.x. AJV still requires `fast-uri` `^3.0.1`, so the lockfile uses the patched 3.1.8 release in that upstream range. No override forces an unsupported major into AJV. Other direct dependencies and development dependency versions remain unchanged.

`braces` had no patched release at the time of review. The scanner now uses Node `fs.readdir` with Dirents, traverses regular directories, and indexes only regular files. Hidden files, sorted output, root-scoped built-in exclusions, `.gitignore` handling, size/binary checks, and skipping file/directory symlinks are preserved. The project does not accept arbitrary glob patterns, so it no longer needs a glob dependency. See the [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).

## Reachability

The production entry point registers a `StdioServerTransport`, not an HTTP/OAuth client or an Express listener. The [SDK OAuth advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h) explicitly excludes SDK servers and stdio clients. The [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) concerns HTTP proxy trust configuration; this application has no such configuration. Those distinctions reduce current exposure, but the vulnerable packages were still updated.

The old scanner used constant internal patterns, not user-supplied brace expressions. Removing its unpatched dependency chain avoids retaining the affected parser and does not require introducing another third-party scanner.

## Installation and validation

Dependency updates and the initial clean `npm ci` ran with scripts disabled. After inspection, only `better-sqlite3@12.10.1` and `esbuild@0.28.1` were approved in the project `allowScripts` field. These pinned approvals support npm's default script-blocking behavior without allowing arbitrary dependency scripts. Older npm clients continue using their normal lifecycle behavior; the field does not backport script blocking.

The pre-existing `prebuild-install@7.1.3` dependency is deprecated but has no reported production vulnerability in this audit. It belongs to the unchanged `better-sqlite3` dependency chain; replacement should be coordinated with an upstream driver update rather than overridden independently.

Run `npm ci`, `npm test`, `npm run build`, `node scripts/context-benchmark-gate.mjs`, `npm run smoke`, `npm audit --omit=dev`, and `npm pack --dry-run`. MCP client/server integration tests cover local search, hybrid/semantic success, timeout fallback, and output defaults; scanner tests cover exclusions, hidden files, binary/size limits, and symlink boundaries. Also verify the rebuilt stdio executable through an MCP client. Production audit results are a snapshot of the registry advisory database, not a guarantee against undisclosed issues.
