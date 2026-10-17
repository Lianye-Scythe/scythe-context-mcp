# Language support

Scythe runs on Node.js, but the target repository does not need to use JavaScript, TypeScript, or npm. Text indexing, keyword search, line ranges, and optional embeddings work across languages. Repository contents are read as data; Scythe does not run Python imports, Cargo, Go commands, or project setup scripts.

## Local dependency navigation

The following improvements ship in 0.1.19. After upgrading, refresh an existing metadata index once with `scythe-context index`, even if status reports fresh, to populate the new edges. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false` on the upgraded server. No schema migration or new embeddings are needed. Unchanged source chunks keep their row ids.

| Language | Supported local navigation | Limits |
| --- | --- | --- |
| JS / TS | Existing relative imports and runtime-extension mapping | Existing behavior is preserved; compiler aliases and package exports are not resolved. |
| Python | Flat and `src/` layouts, dotted module names, explicit relative imports inside regular packages, `__init__.py`, aliases, comma-separated imports, parenthesized `from` imports | Does not execute `sys.path`, import hooks, dynamic imports, or package re-exports. Relative imports require an indexed `__init__.py` package chain. Multiple matching source roots remain unresolved. |
| Go | Nearest indexed `go.mod` module path; local package imports link to all indexed non-test `.go` files in that directory; import blocks and aliases | Does not follow `go.work`, `replace`, downloaded modules, or vendor resolution. Nested module boundaries are retained even if their module directive cannot be read. Build constraints and platform-specific selection are not evaluated. |
| Rust | Conventional Cargo `src/lib.rs` / `src/main.rs` roots; outlined `mod`; `file.rs` and `file/mod.rs`; `crate::`, `self::`, `super::`; grouped and aliased `use` statements | Does not evaluate macros, `cfg`, `#[path]`, Cargo custom targets, binary/test crate roots, or re-exports. Imports inside inline modules or function scopes stay unresolved. |

Dependency edges point to existing indexed files, not directories or imaginary files. A Go package can produce several rows for one import statement, so dependency counts represent stored file edges, including unresolved entries. External or unresolved imports keep their original specifier and line with `resolvedPath: null`.

Python `from package import child` can link the package initializer and an existing child module; runtime attribute binding is not evaluated. Rust `use` navigation finds the closest existing file module for the anchored path; it does not resolve individual symbols or methods. A module declaration with a custom path attribute is retained as unresolved, and filename-based `use` navigation does not interpret those attributes. Duplicate `foo.rs` / `foo/mod.rs` candidates remain unresolved. These are source navigation hints, not compiler or language-server results.

Python `test_*.py` / `*_test.py` and Go `*_test.go` are classified as test files. Existing test directories and JS / TS test suffixes remain supported. Exclude build outputs and dependencies such as `target/`, `.venv/`, `__pycache__/`, and `vendor/` in the target repository's root `.gitignore`; the scanner's built-in exclusions are not a complete language-specific ignore policy.

## Use

```bash
scythe-context index --project /absolute/path/to/repo
scythe-context context "validate_token" --project /absolute/path/to/repo --format compact
scythe-context related src/auth.py --project /absolute/path/to/repo --format full
```

`related` expects a repository-relative file path. CLI lookup defaults to local keyword mode. The MCP tools use the same index and operation workflows; explicitly set `mode="keyword"` for local MCP lookup. Embeddings remain optional and send text to the configured endpoint.

## Validation

The source fixtures under `fixtures/languages/` include Python, Go, and Rust projects with cross-file imports, duplicate function names in test code, and root ignore rules. Tests copy them into isolated temporary directories and check:

- Indexing, symbol and import line numbers, reverse imports, and two-hop navigation.
- Production code ranked ahead of a same-named test helper.
- Identical keyword context payloads through a real CLI process and an MCP client/server connection.
- Ignored build artifacts omitted from the index.
- Go module-name changes and removed package files updating edges without replacing unchanged chunks.

These are retrieval and navigation fixtures, not language compiler tests or evidence of equivalent performance across real repositories.

## References

- [Python import system](https://docs.python.org/3/reference/import.html)
- [Go modules reference](https://go.dev/ref/mod)
- [Rust module source filenames](https://doc.rust-lang.org/reference/items/modules.html#module-source-filenames)
