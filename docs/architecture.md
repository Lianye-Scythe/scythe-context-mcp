# Architecture

Status: current for 0.1.22, including config-driven JS/TS and Rust navigation, C# structure/project-reference and C++ structure/include support. Start with [setup](setup.md) for installation or the [documentation index](README.md) for other guides. Early proposals are preserved in the [archive](archive/README.md).

## Responsibilities

Scythe scans and indexes one target repository, retrieves code, and returns navigation context through CLI commands and a local MCP stdio server. Codex decides when to call tools, reads the returned file ranges, edits code, and runs validation. The embedding endpoint creates vectors when requested; its data handling is governed by that service, not by Scythe.

## Repository map

```text
src/
  index.ts               Legacy MCP entrypoint (no arguments starts stdio)
  command.ts             CLI entrypoint (no arguments shows help)
  main.ts                Shared dispatch with lazy runtime imports
  mcp.ts                 MCP stdio startup and server instructions
  cli.ts                 Argument parsing, help, and package version
  cliRunner.ts           CLI execution, text output, and JSON file output
  core/operations.ts     Shared schemas and operation workflows
  config.ts              Environment settings and project selection
  tools/                 MCP registration adapter, diagnostics, response shaping
  indexing/              Scanning, chunking, indexing, retrieval, related files
    cpp.ts               C++ declarations and local quoted include hints
    csharp.ts            C# declarations, using hints, and literal project references
    languageImports.ts   Python, Go, and Rust import statement extraction
    dependencyResolver.ts  Local module/package-to-file resolution
    typescriptPaths.ts   Indexed JSONC inheritance, reference selection and path mappings
    workspacePackages.ts  Declared workspace exports/config source hints
    rustTargets.ts       Static Cargo library/binary target contexts
    resolutionSources.ts  Indexed config/root text collection
    experimental/        Optional tree-sitter structure extraction
  providers/             Gemini-compatible REST adapter and capability cache
  storage/               SQLite schema and sqlite-vec integration
skills/scythe-context/    Packaged CLI usage skill
benchmarks/              Retrieval cases and reranking profiles
scripts/                 Build helpers, benchmark and release commands
.github/                 CI, publication, and contribution templates
docs/                    Current guides and evaluation records
  archive/               Historical designs and experiments
```

Tests live beside the implementation as `*.test.ts`; TypeScript excludes them from `dist/`. Runtime dependencies, native modules, and index data belong to the environment that runs the MCP server.

## Interface boundaries

`core/operations.ts` owns operation schemas, defaults, validation, and execution. It does not import the MCP SDK. `tools/registerTools.ts` wraps the shared operations as MCP text responses; the CLI invokes them directly without starting or connecting to MCP. Both npm binaries ship in one package. CLI search/context explicitly select keyword and paths-only defaults; MCP retains its existing defaults. CLI errors use nonzero exit codes, and optional JSON files let agents read detailed output selectively. The packaged skill is installed separately into the consuming agent's skill directory.

## Indexing flow

1. Resolve `project_path`, then the configured default project, usable `PWD`, or process `cwd`.
2. Scan using Node directory traversal. Skip symlinks, apply built-in exclusions and the root `.gitignore`, and reject binary or oversized files. Nested `.gitignore` files are not loaded. Some built-in patterns are root-scoped; use the root `.gitignore` to specify exclusions throughout the repository.
3. Split text using character targets and line boundaries. Defaults are 512 KiB per file, 4,000 characters per chunk, 400 overlap characters, and at most 80 chunks per file. These are character limits, not token guarantees.
4. Read/hash files and rebuild symbols/imports. Reuse matching chunk layouts and healthy FTS rows with a per-file chunking key; changing chunk settings recomputes layouts. Preserve equivalent chunk row ids and embeddings. See [index performance](index-performance.md) for cache migration and work counters.
5. Embed chunks only when `repo_reindex(index_embeddings=true)` is requested. Batch requests may fall back to individual requests; the capability cache records observed endpoint behavior.

The default regex extractor handles common declarations and imports. Language-specific extraction and local dependency resolution cover Python packages, Go module/package directories, and conventional Rust file modules; see [language support](language-support.md) for boundaries. Dependencies are recomputed during metadata reindexing even when the importing file is unchanged. Optional tree-sitter extraction applies to JS/TS with configured WASM grammars, falling back to regex when unavailable. It does not replace the text chunker.

## Storage

The default `.scythe-context/` directory contains `index.sqlite` and provider capability observations. SQLite stores files, chunks, embedding sets, embedding metadata, symbols, dependencies, and the FTS5 keyword index. Dimension-specific sqlite-vec tables hold vectors. See [schema.ts](../src/storage/schema.ts) and [sqliteVec.ts](../src/storage/sqliteVec.ts) for the actual schema rather than a duplicated SQL draft.

Embedding sets distinguish provider, endpoint, model, and dimensions. Index metadata and embedding coverage are separate: a usable keyword index can have no vectors or partial vector coverage. Freshness is checked on demand; there is no automatic filesystem watcher.

## Retrieval and context packing

- `keyword` uses local FTS and code-aware reranking without embedding requests.
- `hybrid`, the MCP default mode, merges vector and keyword candidates, then applies optional local reranking. Query embedding failures fall back to keyword and report the reason.
- `semantic` uses vector retrieval and returns an error on embedding failure.

The merge uses distance/rank and keyword contributions, followed by path, symbol, dependency, and query-intent signals. It is not the fixed percentage formula proposed in the original design. See [hybridSearch.ts](../src/indexing/hybridSearch.ts) and [codeAwareReranker.ts](../src/indexing/codeAwareReranker.ts).

`repo_context_pack` adds bounded traversal of imports and reverse imports, suggested paths, and optional related snippets. It defaults to `paths_only`; `compact` adds short snippets and `snippets` exposes fuller ranking detail. Primary and related snippets use separate budgets. The graph provides navigation hints, not a complete runtime call graph.

## Boundaries and privacy

Scythe does not edit repository files, implement tenant access control, track IDE active context, index Git history, or coordinate multiple repositories in one index. `repo_open_ranges` and `repo_grep_suggest` from the early plan are not shipped tools; use direct reads and `rg`.

Keyword search and metadata indexing do not call the embedding endpoint. Hybrid/semantic queries, explicit embedding indexing, and provider probes send text remotely. There is no `SCYTHE_CONTEXT_DISABLE_REMOTE_EMBEDDINGS` switch; use explicit `mode="keyword"`, leave `index_embeddings=false`, and control which tools are enabled if needed. Keep local index data and credentials out of commits and public reports. See [provider compatibility](gemini-compatibility.md) and [security policy](../SECURITY.md).
