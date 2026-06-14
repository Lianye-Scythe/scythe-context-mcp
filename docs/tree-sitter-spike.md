# Tree-sitter Spike Plan

This document defines a small, reversible spike for deciding whether Scythe Context should adopt tree-sitter for symbol extraction and/or code-aware chunking.

## Goal

Scythe Context currently uses lightweight line-based chunking plus regex-based symbol and dependency extraction. That keeps installation simple and preserves stable chunk row ids for unchanged files. Tree-sitter may improve symbol precision and structural chunk boundaries, but it also adds parser/runtime complexity and can invalidate existing embedding caches if chunk ranges change too often.

The spike should answer one question:

> Does tree-sitter improve retrieval quality, returned-context usefulness, or token efficiency enough to justify the extra dependency and cache churn?

## Non-goals

- Do not replace the current chunker in the first spike.
- Do not add a required native dependency to the MCP runtime until benchmark gains are proven.
- Do not send additional data to embedding providers during the spike unless `--include-hybrid` is explicitly requested.
- Do not optimize for only this repository. Use this repository as the first controlled measurement, then validate against at least one external TypeScript/JavaScript repo before making tree-sitter default.

## Candidate Dependencies

Current npm versions checked on 2026-06-14:

- `tree-sitter-cli`: `0.26.9`
- `web-tree-sitter`: `0.26.9`
- `tree-sitter`: `0.25.0` Node native binding package
- `tree-sitter-javascript`: `0.25.0`
- `tree-sitter-typescript`: `0.23.2`

### Native parser packages

Native packages are likely faster and simpler once installed, but they raise support risk for Codex App, Windows, WSL, and npm global installs. This project already depends on native SQLite packages, so native dependencies are not forbidden, but every new native module increases installation failure modes.

Use native packages only if:

- install behavior is acceptable on Windows, WSL, Linux, and GitHub Actions;
- package maintenance appears active enough;
- benchmark wins are clear; and
- fallback to the existing regex extractor remains automatic.

### `web-tree-sitter` plus WASM grammars

The WASM route avoids native builds, but it requires bundling or locating grammar `.wasm` files. That can complicate npm package contents, runtime loading, and ESM path handling.

Prefer this route if:

- grammar assets can be packaged predictably;
- parser startup cost is acceptable;
- it avoids cross-platform install failures; and
- it does not make `npx -y scythe-context-mcp` brittle.

## Integration Shape

Tree-sitter should enter behind a narrow interface, not inside `indexWriter.ts` directly:

```ts
export interface CodeStructureExtractor {
  extractFileGraph(relativePath: string, content: string): ExtractedFileGraph;
  chunkText?(
    relativePath: string,
    content: string,
    limits: Pick<IndexingLimits, "targetChunkChars" | "chunkOverlapChars" | "maxChunksPerFile">,
  ): TextChunk[];
}
```

Recommended first implementation:

1. Keep `chunkText` as the default chunker.
2. Add an optional tree-sitter-backed symbol extractor for TS/JS only.
3. Fall back to the existing regex extractor on unsupported language, parser load failure, parse error, or timeout.
4. Add metrics to compare symbol counts and dependency counts without changing persisted chunk rows.
5. Only consider structural chunks after symbol extraction proves useful.

## Benchmark Criteria

Before adopting tree-sitter by default, compare these on the current benchmark suite:

- `npm run bench:gate`
- `npm run bench:gate:hybrid` when API usage is acceptable
- `npm run bench:context:compare-rerank`
- `npm run bench:context:compare-response-modes`

Acceptance criteria for a default-on change:

- hit@5 does not regress;
- MRR improves by at least `+0.02` on relevant suites, or a known miss is fixed without new misses;
- compact output tokens do not increase by more than `5%`;
- metadata indexing time does not increase by more than `20%` on this repo;
- unchanged files keep stable chunk row ids unless structural chunking is explicitly enabled; and
- install/package checks still pass on GitHub Actions.

If only symbol extraction changes, embedding cache churn should be zero for unchanged files. If structural chunking changes, report how many chunk hashes and row ids changed.

## Spike Steps

1. Add a dev-only experimental extractor module under `src/indexing/experimental/`.
2. Limit support to TS/JS first.
3. Add fixture tests that compare regex vs tree-sitter extraction for:
   - exported functions/classes/types/interfaces;
   - arrow functions assigned to exported consts;
   - re-exports;
   - dynamic `require`;
   - nested declarations that should not dominate file-level symbols.
4. Add a script that runs both extractors over the current repo and prints:
   - files parsed;
   - parse failures;
   - symbol/dependency count deltas;
   - top changed files;
   - elapsed time.
5. Run the benchmark gate with tree-sitter symbols enabled behind an env flag.
6. Decide whether to keep, revise, or discard the approach.

Run the current skeleton with:

```bash
npm run spike:tree-sitter
```

Without grammar assets, the script reports `Parser wired: no` and falls back to regex extraction. To test the WASM extractor, provide a directory containing:

- `tree-sitter-javascript.wasm`
- `tree-sitter-typescript.wasm`
- `tree-sitter-tsx.wasm`

Then run:

```bash
npm run spike:tree-sitter -- --grammar-dir /path/to/tree-sitter-wasm
```

Runtime indexing remains opt-in:

```bash
SCYTHE_CONTEXT_STRUCTURE_EXTRACTOR=tree-sitter \
SCYTHE_CONTEXT_TREE_SITTER_GRAMMAR_DIR=/path/to/tree-sitter-wasm \
npx -y scythe-context-mcp
```

See [Tree-sitter Dependency Experiment](./tree-sitter-dependency-experiment.md) for the first dependency comparison. The current recommendation is to prefer a WASM-first optional extractor and avoid required native parser dependencies.

## Default Decision

The default recommendation is:

- **Do not make tree-sitter a required runtime dependency yet.**
- **Start with an optional TS/JS symbol extractor only.**
- **Do not change chunk boundaries until benchmark evidence shows it improves Codex context quality enough to justify embedding cache churn.**

This fits the project goal: improve Codex efficiency and reduce token waste without making installation or indexing less reliable.
