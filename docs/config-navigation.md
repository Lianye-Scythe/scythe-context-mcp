# Configuration-driven local navigation

Status: available in 0.1.22. These features read indexed text/configuration as data. No Cargo, TypeScript compiler, package-manager install, project plugin, or startup script is executed. No runtime package was added.

## JS / TS paths

The nearest indexed `tsconfig.json` or `jsconfig.json` provides local aliases; `tsconfig.json` wins when both are in the same directory. JSON comments, trailing commas, a UTF-8 BOM, relative `extends` chains, and arrays of relative parents are supported. Explicitly referenced parents can have other filenames/extensions, including `.jsonc`. Only indexed parents are read. Indexed workspace config packages can also supply explicit parents (see below). Missing, external-package, circular, invalid, or excessively deep inheritance stays unresolved; relative imports retain their existing behavior.

`compilerOptions.paths` supports exact keys and a single `*` per pattern/target. Exact matches take precedence, then the longest matching prefix before `*`. Equal-prefix wildcard ambiguity is left unresolved. Target arrays try indexed candidates in order; a failed selected alias does not switch to a less-specific alias. This is index-based navigation, not a complete filesystem/compiler resolution algorithm.

Paths use the effective `baseUrl` when provided, otherwise the directory where the paths map was declared. Inherited relative settings retain their defining directory. A child `paths` object replaces the inherited object. Bare imports can also resolve through an explicit local `baseUrl`. Local file and directory-index lookup handles `.ts`, `.tsx`, `.d.ts`, `.js`, and `.jsx`; explicit `.js`/`.jsx` imports can map to TypeScript source, and `.mjs`/`.cjs` can map to `.mts`/`.cts` declarations/source. Explicit extensions such as `.vue`, `.svg`, or `.json` may link to the exact indexed file. Binary/ignored/missing targets are not invented.

Absolute/outside-repository paths, unsupported template expansion, invalid multi-wildcard maps, unavailable targets, and uncertain cases stay unresolved. This does not implement external package resolution, package `imports`, node_modules lookup, bundler plugins, generated config creation, `rootDirs`, module suffixes, or compiler binding.

### Solution project references

Starting from the nearest default config, indexed local `references` paths can point to config files (including arbitrary names/extensions) or directories containing `tsconfig.json`. Selection uses explicit `files` and/or `include`, with `exclude`, inherited selector origins, and child replacement. Basic `*`, `?`, `**` globs and directory prefixes are supported. A listed `files` entry takes precedence over exclusion. Compiler options come from the selected config and its `extends` chain; the solution's options are not inherited through `references`. References themselves are not inherited through `extends`.

Exactly one project must match. An unreadable or ambiguous selected project context does not fall back to workspace exports. Overlap, unknown membership, missing configs, cycles, unsupported patterns, and excessive traversal stay unresolved. Traversal is bounded to 64 levels, 256 references per config and 512 visits per source file. Without references, a nearest config without explicit selectors retains the previous directory-based heuristic. This is not full compiler program membership: default include/exclude inference, output-directory inference, extension eligibility and editor project selection are not reproduced. It does not execute build mode or map emitted declarations back to source.

### Indexed workspace packages

A JS/TS importer can navigate package `exports` when its nearest indexed `package.json` declares the dependency with `workspace:*`, `workspace:^`, or `workspace:~`, and exactly one indexed package has that name. Self-references use the owning package's exports. Nearest package boundaries are preserved, including invalid manifests. This uses explicit declarations as local navigation hints; it does not reconstruct pnpm/npm/Yarn workspace membership, installation or version selection.

Exports support root, exact subpaths and single-wildcard keys, choosing the longest prefix then suffix. Targets must be explicit `./` paths to indexed files inside the package; no extension guessing, generated-output inference or undeclared deep imports are performed. For conditional exports, every branch is inspected: a single distinct indexed target can supply a navigation hint, including when a generated `types` path is absent but a source `default` target exists. Several distinct available targets remain unresolved. This deliberately does not select runtime import/require/platform/custom conditions or promise compiler binding. Arrays, null blockers, malformed maps and path traversal stay unresolved.

The same explicit workspace declarations can resolve config-package `extends`. If the config package has exports, those exports govern access. Without exports, an explicit indexed subpath such as `@repo/tsconfig/base.json` can be read as configuration data. No scripts or package code are executed. Ordinary semver dependencies, versioned/aliased/relative workspace specs, `file:`/`link:`, package `main`/`types` fallback, package `imports`, external config packages and installed dependencies are not resolved.

## Rust target roots

Indexed Cargo manifests can specify literal `[lib] path` and `[[bin]] path` entries. Their roots and conventional `src/lib.rs` / `src/main.rs` roots provide context for outlined `mod` and `crate::`, `self::`, and `super::` navigation. The root filename can be arbitrary; modules declared at a target root are looked up relative to its containing directory. Root-level symbols are read from those indexed root files.

The static reader recognizes ordinary target tables, quoted one-line paths, comments, basic auto-discovery switches, and literal editions (including a nearest indexed workspace's literal edition for `edition.workspace=true`). It masks multiline strings before looking for tables. Paths must remain within the owning package and indexed repository; nested Cargo boundaries are preserved. This is a limited reader for source navigation, not a full TOML/Cargo implementation.

A known root selects its own crate context. Other source files use the deepest available target directory. When several same-directory contexts produce different resolutions, the dependency stays unresolved. This directory heuristic does not prove module membership. Targets guarded by features/platform configuration are not selected as an actual build would select them.

Automatic `src/bin` discovery, explicit example/test/benchmark targets, `#[path]`, macro expansion, `cfg` evaluation, Cargo package-name/crate aliases and dependencies, out-of-package target paths, nonstandard TOML representations, and complete workspace/target membership are not modeled. Inline-module/function-scope imports retain their earlier unresolved behavior.

## Reindexing and cache behavior

After updating the source build, refresh metadata once even if the existing index reports fresh:

```bash
scythe-context index --project /absolute/path/to/repo
```

MCP users can call `repo_reindex` with `dry_run=false`, `index_embeddings=false` on the updated server. There is no new schema migration for these additions. Symbols/dependencies refresh when config files or indexed target availability changes, while unchanged source chunks keep their ids and embedding records. Unit/integration tests cover alias-only config edits, arbitrary parent filenames, target removal, ignored configuration, Cargo-only root edits, workspace manifest/export changes, referenced config selection, dependency/target removal, and ambiguous/missing contexts.

## Fixed GitHub snapshots

The [navigation case file](../benchmarks/navigation-repositories.json) pins source commits and expected edges. Snapshots were downloaded as archives, filtered to regular files, and indexed as data without installing or running their scripts. Taxonomy is a historical Next.js source fixture, not a recommendation to use its application stack in production.

| Repository / commit | Indexed files | Fixed edge probes, 0.1.21 → source build | Newly resolved edges | Previously resolved edges removed |
| --- | ---: | ---: | ---: | ---: |
| [ripgrep `3fce3b5b`](https://github.com/BurntSushi/ripgrep/tree/3fce3b5bb0236da2df6d99672afb8a719642eca7) | 228 | 0/2 → 2/2 | 98 | 0 |
| [Taxonomy `298a8857`](https://github.com/shadcn-ui/taxonomy/tree/298a8857c7128a0d121e7f699dfd729f23b3966d) | 168 | 0/2 → 2/2 | 267 | 0 |
| [Next.js Boilerplate `b83157a8`](https://github.com/ixartz/Next-js-Boilerplate/tree/b83157a8018f55b926a3c25a4b7a7e14b0dfbc35) | 96 | 0/2 → 2/2 | 55 | 0 |

The six probes include ripgrep's `mod flags` and `crate::flags::HiArgs` at its custom binary root, Taxonomy's `@/lib/utils` and `@/config/site`, and Boilerplate's `@/utils/AppConfig` and the longer `@/public/*` mapping to an indexed SVG asset. Forward/reverse edges must agree. All four fixed source-search probes also hit, including ripgrep's earlier WalkBuilder/GlobSetBuilder probes. Chunks/symbols have identical logical digests between builds, and real CLI `related` processes match MCP client/server payloads for all three repositories.

The 420 newly resolved edges are observed graph differences, not a claim that every possible import or target is supported. Six hand-selected edge assertions and four source-search probes do not establish a universal coverage percentage. Missing generated targets and external dependencies remain unresolved.

Reproduce from reviewed Scythe builds with existing matching dependencies, using snapshot folders named `ripgrep`, `taxonomy`, and `Next-js-Boilerplate`:

```bash
npm run bench:navigation -- \
  --snapshots /absolute/path/to/snapshots \
  --baseline /absolute/path/to/scythe-0.1.21/dist \
  --candidate /absolute/path/to/current/dist \
  --output local/benchmark/navigation-evaluation.json
```

The driver copies snapshots to temporary directories, excludes symlinks/Git/index/dependency directories, asserts candidate edges/reverse edges and source probes, compares chunk/symbol digests, and records added/removed graph edges. Temporary copies are removed. Raw reports stay under ignored `local/benchmark/`. It is a navigation evaluation, not a performance or agent task-completion benchmark.

## Workspace and project-reference follow-up

The [workspace case file](../benchmarks/workspace-repositories.json) adds two fixed GitHub snapshots. The baseline here is the preceding unreleased source build with local aliases and Cargo target roots, before workspace exports/references were implemented; it is not a second comparison to the published package.

| Repository / source | Commit | Fixed assertions, prior source → current source | Added / removed resolved edges |
| --- | --- | ---: | ---: |
| [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo/tree/8f945b7bb3bfb3ca8358d48b1ff0214079bc11ee) | `8f945b7b` | 0/4 → 4/4 | +81 / −0 |
| [shadcn Vite template](https://github.com/shadcn-ui/ui/tree/d2fba50ee5b9113008b5bb908563527b7efd2f27/templates/vite-app) (subtree only) | `d2fba50e` | 2/2 → 2/2 | +0 / −0 |

T3 assertions cover `@acme/ui/button`, conditional `@acme/db/schema`, `@acme/auth`, and `~/trpc/server` through an indexed workspace config parent. The Vite template checks the existing theme-provider edge through the selected app config and verifies that the absent, generated Button stays unresolved. Its aliases already existed in the solution config, so this sample is preservation evidence rather than evidence of a recovered alias. Synthetic integration cases isolate aliases present only in referenced configs and verify metadata-only changes, missing config rejection and source chunk-id preservation.

All three additional source-search probes pass; chunks/symbols remain equal and real CLI/MCP related payloads match for both snapshots. The T3 archive and Vite subtree were fetched as regular source files; neither project was installed, built or executed. These assertions do not establish universal monorepo coverage.

```bash
npm run bench:navigation -- \
  --cases benchmarks/workspace-repositories.json \
  --snapshots /absolute/path/to/workspace-snapshots \
  --baseline /absolute/path/to/previous-source/dist \
  --output local/benchmark/workspace-evaluation.json
```

Use folders `create-t3-turbo` (full repository) and `shadcn-vite-app` (the unmodified `templates/vite-app` subtree). The case file records the source path. `target: null` asserts that an import stays unresolved.

## Resolver cleanup validation

The internal cleanup separates TypeScript config loading/overrides, nearest-config lookup, referenced-project selection, alias resolution and fallback dispatch. An explicit alias-match result distinguishes no matching alias from a matched but unresolved alias, preserving fallback blocking. Validated path maps and workspace resolver signatures carry types between stages; workspace package selection, export matching and conditional target collection use focused helpers. The supported resolution rules are unchanged.

A comparison against the source build saved immediately before this cleanup produced zero added/removed dependency edges across all five snapshots above. Chunk/symbol digests, fixed edge assertions and source-query results were identical; real CLI/MCP payload parity passed. The existing 319 tests and 61-case keyword quality gate also passed. This is behavior-preservation evidence for these cases, not a new coverage or performance claim.

## Post-0.1.22 maintenance (unreleased)

The follow-up source cleanup separates Cargo manifest parsing, nearest-workspace edition lookup, target selection, target contexts and anchored imports. The evaluation script separates argument parsing, snapshot copying, index inspection, edge/source probes, CLI/MCP comparison and report generation. No new resolution rules or runtime dependencies were added.

Against the verified published 0.1.22 tarball, all five fixed snapshots retain identical dependency graphs, chunk/symbol digests, edge assertions and source-query results. CLI/MCP payload parity passes. Running both the published evaluation driver and the refactored driver produces identical complete JSON reports for both case suites. The 319 tests, 61-case keyword gate, build, CLI smoke, package checks and production audit pass (zero vulnerabilities). Reports remain in ignored `local/benchmark/`; these maintenance changes are not part of 0.1.22.

## References

- [TypeScript paths](https://www.typescriptlang.org/tsconfig/#paths)
- [TypeScript configuration inheritance](https://www.typescriptlang.org/tsconfig/#extends)
- [Cargo targets and target paths](https://doc.rust-lang.org/cargo/reference/cargo-targets.html)
- [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Node.js package exports and self-references](https://nodejs.org/api/packages.html)
- [pnpm workspace protocol](https://pnpm.io/10.x/workspaces)
