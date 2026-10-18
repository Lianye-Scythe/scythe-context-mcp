# Language support

Scythe runs on Node.js, but the target repository does not need to use JavaScript, TypeScript, or npm. Text indexing, keyword search, line ranges, and optional embeddings work across languages. Repository contents are read as data; Scythe does not run Python imports, Cargo, Go commands, the .NET SDK, MSBuild, C++ compilers, CMake, or project setup scripts.

## Local dependency navigation

Python, Go, and Rust dependency improvements shipped in 0.1.19. C# and C++ basic structure and navigation support ship in 0.1.20. After upgrading, refresh an existing metadata index once with `scythe-context index`, even if status reports fresh, to populate the new edges. MCP users can call `repo_reindex` with `dry_run=false` and `index_embeddings=false` on the upgraded server. The 0.1.22 Rust target / JS–TS config navigation additions are described in [configuration-driven navigation](config-navigation.md). They require a metadata refresh but no new schema migration or embeddings. Unchanged source chunks keep their row ids.

| Language | Supported local navigation | Limits |
| --- | --- | --- |
| JS / TS | Relative imports and runtime-extension mapping; 0.1.22 local `tsconfig`/`jsconfig` paths, baseUrl, local/workspace config inheritance, explicit project-reference selection, and declared workspace source exports | Indexed configuration/dependency hints are conservative. Runtime condition selection, full workspace/program membership, external packages, package imports and complete compiler/bundler binding are not modeled. |
| Python | Flat and `src/` layouts, dotted module names, explicit relative imports inside regular packages, `__init__.py`, aliases, comma-separated imports, parenthesized `from` imports | Does not execute `sys.path`, import hooks, dynamic imports, or package re-exports. Relative imports require an indexed `__init__.py` package chain. Multiple matching source roots remain unresolved. |
| Go | Nearest indexed `go.mod` module path; local package imports link to all indexed non-test `.go` files in that directory; import blocks and aliases | Does not follow `go.work`, `replace`, downloaded modules, or vendor resolution. Nested module boundaries are retained even if their module directive cannot be read. Build constraints and platform-specific selection are not evaluated. |
| Rust | Conventional Cargo `src/lib.rs` / `src/main.rs` roots and 0.1.22 literal `[lib]` / `[[bin]]` target paths; outlined `mod`; `file.rs` and `file/mod.rs`; `crate::`, `self::`, `super::`; grouped and aliased `use` statements | Does not evaluate macros, `cfg`, `#[path]`, automatic binary discovery, test/example/benchmark roots, or re-exports. Custom target contexts use directory heuristics, with ambiguity retained as unresolved. Imports inside inline modules or function scopes stay unresolved. |
| C# (0.1.20) | Namespace, class/interface/struct/enum/record and common method/constructor declarations; literal `.csproj` `ProjectReference` links, including relative Windows-style paths | `using` directives stay unresolved namespace/type hints. No Roslyn binding, source-to-project membership, implicit/global-using expansion, Unity `.asmdef`, or MSBuild evaluation. |
| C++ (0.1.20) | Namespaces, class/struct/enum, common function/method/constructor declarations; exact quoted `#include` paths relative to the including file | No compiler/preprocessor or build-system evaluation; system headers, macro includes, missing targets and compiler include-directory lookup remain unresolved. |

Dependency edges point to existing indexed files, not directories or imaginary files. A Go package can produce several rows for one import statement, so dependency counts represent stored file edges, including unresolved entries. External or unresolved imports keep their original specifier and line with `resolvedPath: null`.

Python `from package import child` can link the package initializer and an existing child module; runtime attribute binding is not evaluated. Rust `use` navigation finds the closest existing file module for the anchored path; it does not resolve individual symbols or methods. A module declaration with a custom path attribute is retained as unresolved, and filename-based `use` navigation does not interpret those attributes. Duplicate `foo.rs` / `foo/mod.rs` candidates remain unresolved. These are source navigation hints, not compiler or language-server results.

Python `test_*.py` / `*_test.py` and Go `*_test.go` are classified as test files. Existing test directories and JS / TS test suffixes remain supported. Exclude build outputs and dependencies such as `target/`, `.venv/`, `__pycache__/`, and `vendor/` in the target repository's root `.gitignore`; the scanner's built-in exclusions are not a complete language-specific ignore policy.

## C# scope

C# files are tokenized after comments, preprocessor directive lines, and ordinary/verbatim/raw string contents are masked. Conditional branches are not selected, so declarations from multiple branches may be indexed. File-scoped and block-scoped namespaces, nested types, partial classes, generic/async methods, and ordinary constructors are recognized. Methods use the `method` symbol kind; namespaces and records use `namespace` and `record`. This is basic source navigation, not a complete C# parser: properties, events, delegates, operators, local functions, complex syntax, and conditional compilation are not modeled as compiler symbols.

Qualified-name forms of ordinary, global, static, and alias `using` directives retain their target text and source line with `resolvedPath: null`. A namespace may span several files and projects. Scythe does not infer a file from a namespace name or expand global usings across source files. Project references connect project files, not individual C# source files.

For `.csproj`, only literal `ProjectReference Include` paths to indexed local `.csproj` targets are linked. XML comments and CDATA are ignored; standard XML character references are decoded without loading external entities. Missing/ignored/outside-root targets and property/item expressions, wildcards, percent escapes, absolute paths, and item lists remain unresolved. References with a `Condition` or inside conditional groups/build targets stay unresolved. Explicit literal `ProjectReference Remove` entries invalidate matching links. Imported props/targets, other item updates/removals, package/assembly references, SDK defaults, and build-time selection are not evaluated.

C# `*Test.cs`, `*Tests.cs`, `*Spec.cs`, and `*Specs.cs` PascalCase suffixes, as well as `.Tests` / `.UnitTests` / `.IntegrationTests` project directories, are classified as test code. Add `**/bin/` and `**/obj/` to the repository's root `.gitignore` to exclude build output.

After upgrading to 0.1.20, refresh metadata once to populate the new C# symbols and project links. There are no new runtime dependencies, and unchanged source chunks retain their row ids.

## C++ scope

Basic extraction applies to `.cpp`, `.cc`, `.cxx`, `.h`, `.hpp`, `.hh`, `.hxx`, `.ipp`, and `.tpp` files. Comments and ordinary/raw string contents are masked before tokenization. Named/nested and anonymous namespaces, class/struct/enum declarations, common free functions and methods, simple constructors/destructors, multiline signatures, template declarations, and common `const`/`noexcept` qualifiers are recognized. Template parameters are not indexed as classes. Qualified out-of-line declarations are classified as methods heuristically; namespace-qualified free functions may also receive that kind. The `exported` flag stays false because linkage and access are not evaluated.

Only exact quoted `#include "relative/path.hpp"` targets relative to the including file are linked, and only when the target is inside the repository and indexed. No extension guessing, basename search, root fallback, or `-I` lookup is performed. Angle-bracket and macro includes retain their text and line as unresolved hints, even if a similarly named file is indexed. Backslash/absolute paths, missing/ignored files, and paths outside the repository remain unresolved. Deleting a header and reindexing removes its incoming links while preserving unchanged source chunk ids.

This is a lightweight source heuristic, not Clang or a complete C++ parser. Preprocessor directive lines and their continuations are masked; conditional branches are not selected, so declarations and includes from multiple branches may be indexed. Macro expansion, complex declarators, operators, constructor initializer lists, aliases/typedefs, C++ modules, and full preprocessing/line-splicing rules are not modeled. CMake, `compile_commands.json`, compiler include paths, platform selection, external libraries, and generated headers are not evaluated or executed.

Common `_test.cpp`, `_tests.cc`, `*Tests.cxx` names and existing test directories are classified as test code. Add output directories such as `build/` and `cmake-build-*/` to the repository's root `.gitignore`. Refresh metadata once after upgrading to 0.1.20 to populate C++ symbols and include edges. No C++ toolchain or new runtime package is needed.

## Use

```bash
scythe-context index --project /absolute/path/to/repo
scythe-context context "validate_token" --project /absolute/path/to/repo --format compact
scythe-context related src/auth.py --project /absolute/path/to/repo --format full
```

`related` expects a repository-relative file path. CLI lookup defaults to local keyword mode. The MCP tools use the same index and operation workflows; explicitly set `mode="keyword"` for local MCP lookup. Embeddings remain optional and send text to the configured endpoint.

## Validation

The source fixtures under `fixtures/languages/` include Python, Go, Rust, C#, and C++ projects with cross-file imports, duplicate function names in test code, and root ignore rules. Tests copy them into isolated temporary directories and check:

- Indexing, symbol and import line numbers, reverse imports, and two-hop navigation.
- Production code ranked ahead of a same-named test helper.
- Identical keyword context payloads through a real CLI process and an MCP client/server connection.
- Ignored build artifacts omitted from the index.
- Go module-name changes and removed package files updating edges without replacing unchanged chunks.
- C++ header traversal and removal, unresolved system includes, and unchanged source chunk ids.
- C# namespace hints staying unresolved, project-reference traversal and target removal, and unchanged C# source chunk ids.

These are retrieval and navigation fixtures, not language compiler tests or evidence of equivalent performance across real repositories.

## References

- [Python import system](https://docs.python.org/3/reference/import.html)
- [Go modules reference](https://go.dev/ref/mod)
- [Rust module source filenames](https://doc.rust-lang.org/reference/items/modules.html#module-source-filenames)
- [C# using directives](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/using-directive)
- [C# namespaces](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/namespace)
- [MSBuild ProjectReference items](https://learn.microsoft.com/en-us/visualstudio/msbuild/common-msbuild-project-items#projectreference)
