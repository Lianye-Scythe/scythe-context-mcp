import { describe, expect, it } from "vitest";
import { createDependencyResolver } from "./dependencyResolver.js";
import { extractFileGraph, type ExtractedDependency } from "./symbolGraph.js";

function resolve(files: string[], from: string, specifier: string, extra: Partial<ExtractedDependency> = {}, sources: Record<string, string> = {}) {
  return createDependencyResolver(new Set(files), new Map(Object.entries(sources)))(from, { specifier, line: 1, ...extra });
}

describe("Python local module resolution", () => {
  const files = ["src/shop/__init__.py", "src/shop/service.py", "src/shop/auth.py", "src/shop/sub/__init__.py", "src/shop/sub/handler.py"];
  it.each([
    ["main.py", "shop.auth", {}, ["src/shop/auth.py"]],
    ["src/shop/service.py", ".auth", { kind: "python_from" }, ["src/shop/auth.py"]],
    ["src/shop/sub/handler.py", "..auth", {}, ["src/shop/auth.py"]],
    ["src/shop/sub/handler.py", "...auth", {}, []],
    ["src/shop/service.py", ".", { kind: "python_from", importedNames: ["auth"] }, ["src/shop/__init__.py", "src/shop/auth.py"]],
    ["src/shop/service.py", "pathlib", {}, []],
    ["src/shop/service.py", ".missing", {}, []],
  ])("resolves %s importing %s", (from, specifier, extra, expected) => {
    expect(resolve(files, from, specifier, extra as Partial<ExtractedDependency>)).toEqual(expected);
  });

  it("handles flat packages, initializers and module attributes", () => {
    expect(resolve(["shop/__init__.py", "shop/auth.py"], "shop/__init__.py", ".auth")).toEqual(["shop/auth.py"]);
    expect(resolve(["__init__.py", "auth.py"], "__init__.py", ".auth")).toEqual(["auth.py"]);
    expect(resolve(["__init__.py", "auth.py"], "__init__.py", "..auth")).toEqual([]);
    expect(resolve(["shop/auth.py"], "main.py", "shop.auth", { kind: "python_from", importedNames: ["validate_token"] })).toEqual(["shop/auth.py"]);
  });

  it("leaves duplicate layouts and uncertain relative package roots unresolved", () => {
    expect(resolve([...files, "shop/auth.py"], "main.py", "shop.auth")).toEqual([]);
    expect(resolve([...files, "src/shop/auth/__init__.py"], "main.py", "shop.auth")).toEqual([]);
    expect(resolve(["app.py", "auth.py"], "app.py", ".auth")).toEqual([]);
  });
});

describe("Go package resolution", () => {
  const files = ["go.mod", "shop.go", "internal/auth/auth.go", "internal/auth/helpers.go", "internal/auth/auth_test.go", "nested/go.mod", "nested/service.go"];
  const sources = { "go.mod": 'module "example.com/shop" // local module\n', "nested/go.mod": "module example.com/nested\n" };
  it("links every indexed non-test file in a local package", () => {
    expect(resolve(files, "cmd/main.go", "example.com/shop/internal/auth", {}, sources)).toEqual(["internal/auth/auth.go", "internal/auth/helpers.go"]);
    expect(resolve(files, "cmd/main.go", "example.com/shop", {}, sources)).toEqual(["shop.go"]);
  });

  it.each(["fmt", "example.com/shopper/internal/auth", "example.com/shop/missing", "example.com/shop/../internal/auth", "example.com/shop/nested"])("does not guess an external or invalid package: %s", (specifier) => {
    expect(resolve(files, "cmd/main.go", specifier, {}, sources)).toEqual([]);
  });

  it("respects nearest module boundaries even when nested metadata is invalid", () => {
    expect(resolve([...files, "x/go.mod", "x/auth.go"], "x/cmd/main.go", "example.com/shop/internal/auth", {}, sources)).toEqual([]);
    expect(resolve(files, "nested/main.go", "example.com/nested", {}, sources)).toEqual(["nested/service.go"]);
    expect(resolve(files, "nested/main.go", "example.com/shop/internal/auth", {}, sources)).toEqual([]);
  });
});

describe("Rust conventional file modules", () => {
  const files = ["Cargo.toml", "src/lib.rs", "src/auth/mod.rs", "src/auth/token.rs", "src/storage.rs", "src/storage/backend.rs"];
  it.each([
    ["src/lib.rs", "auth", { kind: "rust_module" }, ["src/auth/mod.rs"]],
    ["src/storage.rs", "backend", { kind: "rust_module" }, ["src/storage/backend.rs"]],
    ["src/auth/mod.rs", "token", { kind: "rust_module" }, ["src/auth/token.rs"]],
    ["src/auth/mod.rs", "self::token::check", {}, ["src/auth/token.rs"]],
    ["src/auth/token.rs", "super::validate_token", {}, ["src/auth/mod.rs"]],
    ["src/auth/token.rs", "super::super::storage::ready", {}, ["src/storage.rs"]],
    ["src/auth/token.rs", "crate::storage::ready", {}, ["src/storage.rs"]],
    ["src/lib.rs", "super::storage", {}, []],
    ["src/auth/mod.rs", "std::fmt", {}, []],
    ["src/auth/mod.rs", "auth::token", {}, []],
    ["src/auth/mod.rs", "crate::missing", {}, []],
    ["src/lib.rs", "auth", { kind: "unresolved" }, []],
  ])("resolves %s importing %s", (from, specifier, extra, expected) => {
    expect(resolve(files, from, specifier, extra as Partial<ExtractedDependency>)).toEqual(expected);
  });

  it("uses root declarations and nearest Cargo boundaries without guessing", () => {
    const sources = { "src/lib.rs": "pub fn ready() {}\n" };
    expect(resolve(files, "src/auth/mod.rs", "crate::ready", {}, sources)).toEqual(["src/lib.rs"]);
    expect(resolve([...files, "src/auth/token/mod.rs"], "src/lib.rs", "crate::auth::token::check")).toEqual([]);
    const workspace = [...files, "nested/Cargo.toml", "nested/src/lib.rs", "nested/src/storage.rs"];
    expect(resolve(workspace, "nested/src/lib.rs", "crate::storage::ready")).toEqual(["nested/src/storage.rs"]);
    expect(resolve(files, "tests/test.rs", "crate::storage::ready")).toEqual([]);
  });
});

describe("language-specific dependency extraction", () => {
  it("handles Python aliases, relative and multiline imports without docstring matches", () => {
    const source = '# """ is just a comment\n"""\nimport fake\n"""\nimport os, shop.service as svc\nfrom ..auth import (\n    validate_token as check,\n)\nfrom . import storage\nasync def serve(): pass\n';
    const graph = extractFileGraph("app.py", source);
    expect(graph.dependencies).toEqual([
      { specifier: "os", line: 5 }, { specifier: "shop.service", line: 5 },
      { specifier: "..auth", line: 6, kind: "python_from", importedNames: ["validate_token"] },
      { specifier: ".", line: 9, kind: "python_from", importedNames: ["storage"] },
    ]);
    expect(graph.symbols).toContainEqual(expect.objectContaining({ name: "serve", line: 10 }));
  });

  it("reads Go aliases only inside actual import declarations", () => {
    const source = 'package shop\n/*\nimport "fake"\n*/\nimport(\n  _ "example.com/a"\n  alias "example.com/b"\n  . `example.com/c`\n)\nvar text = `\nimport "fake-again"\n`\n';
    expect(extractFileGraph("app.go", source).dependencies).toEqual([
      { specifier: "example.com/a", line: 6 }, { specifier: "example.com/b", line: 7 }, { specifier: "example.com/c", line: 8 },
    ]);
  });

  it("expands nested Rust use groups and aliases and retains unsupported scope as unresolved", () => {
    const source = 'pub(crate) mod auth;\npub use crate::{\n  auth::{self, token::check as validate},\n  storage::*,\n};\n#[path = "other.rs"]\nmod custom;\nmod inline {\n  use crate::storage::ready;\n}\n';
    expect(extractFileGraph("lib.rs", source).dependencies).toEqual([
      { specifier: "auth", line: 1, kind: "rust_module" },
      { specifier: "crate::auth", line: 2 }, { specifier: "crate::auth::token::check", line: 2 }, { specifier: "crate::storage::*", line: 2 },
      { specifier: "custom", line: 7, kind: "unresolved" }, { specifier: "crate::storage::ready", line: 9, kind: "unresolved" },
    ]);
  });
});
