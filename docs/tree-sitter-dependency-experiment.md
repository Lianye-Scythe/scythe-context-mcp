# Tree-sitter Dependency Experiment

Date: 2026-06-14

Environment:

- OS: WSL2 Linux
- Node.js: `v24.16.0`
- npm: current local npm bundled with Node `v24.16.0`
- Project branch: `codex/tree-sitter-dependency-experiment`

This experiment compares dependency routes for a future optional tree-sitter-backed TS/JS structure extractor. It does not change runtime dependencies.

## Tested Packages

Current npm metadata checked during the experiment:

- `tree-sitter@0.25.0`
- `web-tree-sitter@0.26.9`
- `tree-sitter-javascript@0.25.0`
- `tree-sitter-typescript@0.23.2`

Important peer dependency mismatch:

- `tree-sitter-javascript@0.25.0` peer-optional dependency: `tree-sitter ^0.25.0`
- `tree-sitter-typescript@0.23.2` peer-optional dependency: `tree-sitter ^0.21.0`
- `tree-sitter-typescript@0.23.2` depends on `tree-sitter-javascript ^0.23.1`

That means the newest JavaScript grammar and newest TypeScript grammar do not align cleanly on the native `tree-sitter` runtime version.

## Install Results

| Route | Packages | Result | Notes |
| --- | --- | --- | --- |
| Native latest | `tree-sitter@0.25.0`, `tree-sitter-javascript@0.25.0`, `tree-sitter-typescript@0.23.2` | Failed | npm peer resolution fails because TypeScript wants `tree-sitter ^0.21.0`. |
| Native latest forced | Same as above with `--legacy-peer-deps` | Failed by default | Native build failed on Node 24 because the build did not use C++20 flags. |
| Native latest forced with C++20 | Same as above plus `CXXFLAGS=-std=c++20` | Installed in ~22s | Parses JS/TS, but requiring users to set C++ flags is not acceptable for default install. |
| Native compatible | `tree-sitter@0.21.1`, `tree-sitter-javascript@0.23.1`, `tree-sitter-typescript@0.23.2` | Installed in ~3s | Parses JS/TS, but pins the runtime/JS grammar to older versions. |
| Web runtime only | `web-tree-sitter@0.26.9` | Installed in ~3s | No language grammar included. Package size about 4.5 MB. |
| Web runtime plus npm grammars | `web-tree-sitter@0.26.9`, `tree-sitter-javascript@0.25.0`, `tree-sitter-typescript@0.23.2` | Installed in ~5s | Provides `.wasm` grammars, but also installs native grammar packages and install-script warnings. |

The native grammar packages showed npm `allow-scripts` warnings because they use install scripts such as `node-gyp-build`.

## Load Results

Native compatible route:

- `require()` time: ~8ms
- JS parse: ~3ms
- TS parse: ~6ms

Web route using grammar `.wasm` files from npm grammar packages:

- `Parser.init()`: ~10ms
- JavaScript grammar load: ~4ms
- TypeScript grammar load: ~3ms
- JS/TS parsing succeeded.

Both routes are fast enough after installation. The main decision is installation reliability and packaging complexity, not parse speed.

## Decision

Prefer a WASM-first optional extractor for the next implementation step.

Reasons:

- It avoids making the MCP runtime depend on native parser compilation.
- It fits Codex App / CLI cross-platform expectations better than requiring C++ build flags.
- Parser startup and grammar load are small enough for index-time use.
- It keeps the current regex extractor as an automatic fallback.

Do not add tree-sitter packages as required runtime dependencies yet.

## Open Packaging Question

The cleanest WASM runtime package, `web-tree-sitter`, does not include language grammars. The npm grammar packages include `.wasm` files, but they also include native `.node` prebuilds and install scripts.

Before defaulting this feature, test one of these packaging strategies:

- vendor only the required grammar `.wasm` assets in the npm package;
- load grammar `.wasm` assets from optional dependencies when present;
- keep tree-sitter support dev/experimental only until grammar packaging is clean.

## Next Step

Implement the tree-sitter extractor behind an explicit opt-in flag using `web-tree-sitter`, while preserving this behavior:

- unsupported language: fallback to regex extractor;
- missing grammar asset: fallback to regex extractor;
- parse/load error: fallback to regex extractor;
- no structural chunking change;
- no embedding cache churn for unchanged files.

