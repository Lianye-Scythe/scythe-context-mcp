import { describe, expect, it } from "vitest";
import { createDependencyResolver } from "./dependencyResolver.js";
import { rustTargetRoots } from "./rustTargets.js";

function resolver(files: string[], sources: Record<string, string>) {
  return createDependencyResolver(new Set([...files, ...Object.keys(sources)]), new Map(Object.entries(sources)));
}
const dependency = (specifier: string) => ({ specifier, line: 1 });

describe("Cargo literal target roots", () => {
  const files = ["Cargo.toml", "cmd/tool/entry.rs", "cmd/tool/flags/mod.rs", "cmd/tool/flags/parse.rs", "lib/root.rs", "lib/value.rs"];
  const cargo = '[package]\nname = "tool"\nedition = "2024"\n[lib]\npath = "lib/root.rs"\n[[bin]]\nname = "tool"\npath = "cmd/tool/entry.rs"\n';
  const sources = { "Cargo.toml": cargo, "cmd/tool/entry.rs": "pub fn main() {}", "lib/root.rs": "pub fn exported() {}" };
  it("links custom binary/library modules and anchored uses, including root symbols", () => {
    const resolve = resolver(files, sources);
    expect(resolve("cmd/tool/entry.rs", { specifier: "flags", line: 1, kind: "rust_module" })).toEqual(["cmd/tool/flags/mod.rs"]);
    expect(resolve("cmd/tool/entry.rs", dependency("crate::flags::parse::run"))).toEqual(["cmd/tool/flags/parse.rs"]);
    expect(resolve("cmd/tool/flags/parse.rs", dependency("super::super::main"))).toEqual(["cmd/tool/entry.rs"]);
    expect(resolve("lib/root.rs", { specifier: "value", line: 1, kind: "rust_module" })).toEqual(["lib/value.rs"]);
    expect(resolve("lib/value.rs", dependency("crate::exported"))).toEqual(["lib/root.rs"]);
    expect(resolve("cmd/tool/entry.rs", dependency("crate::exported"))).toEqual([]);
  });

  it("keeps shared-root symbol ambiguity unresolved, while a known root chooses its own crate", () => {
    const resolve = resolver(["Cargo.toml", "src/a.rs", "src/b.rs", "src/shared.rs"], {
      "Cargo.toml": '[[bin]]\npath="src/a.rs"\n[[bin]]\npath="src/b.rs"',
      "src/a.rs": "pub fn ready() {}", "src/b.rs": "pub fn ready() {}",
    });
    expect(resolve("src/a.rs", dependency("crate::ready"))).toEqual(["src/a.rs"]);
    expect(resolve("src/shared.rs", dependency("crate::ready"))).toEqual([]);
    expect(resolve("src/shared.rs", dependency("crate::shared"))).toEqual(["src/shared.rs"]);
  });

  it("honors explicit auto-discovery switches and ignores fake target sections in comments/multiline strings", () => {
    const active = new Set(["Cargo.toml", "src/main.rs", "src/lib.rs", "fake.rs", "cmd/main.rs"]);
    const roots = rustTargetRoots(active, new Map([["Cargo.toml", '[package]\nautobins=false\nautolib=false\ndescription="""\n[[bin]]\npath="fake.rs"\n"""\n# [[bin]]\n# path="fake.rs"\n[[bin]]\npath="cmd/main.rs"\n']]));
    expect(roots.map((item) => item.root)).toEqual(["cmd/main.rs"]);
  });

  it.each(["../outside.rs", "/absolute.rs", "C:/absolute.rs", "missing.rs"])("does not link unavailable or escaping target %s", (target) => {
    const resolve = resolver(["Cargo.toml", "src/value.rs"], { "Cargo.toml": `[lib]\npath="${target}"` });
    expect(resolve("src/value.rs", dependency("crate::value"))).toEqual([]);
  });

  it("inherits a literal workspace edition for target auto-discovery without resolving crate aliases", () => {
    const active = new Set(["Cargo.toml", "member/Cargo.toml", "member/src/lib.rs", "member/cmd/entry.rs"]);
    const roots = rustTargetRoots(active, new Map([
      ["Cargo.toml", '[workspace]\nmembers=["member"]\n[workspace.package]\nedition="2024"'],
      ["member/Cargo.toml", '[package]\nedition.workspace=true\n[[bin]]\npath="cmd/entry.rs"'],
    ]));
    expect(roots.filter((root) => root.manifest === "member/Cargo.toml").map((root) => root.root)).toEqual(["member/src/lib.rs", "member/cmd/entry.rs"]);
  });

  it("respects nested Cargo boundaries and does not infer undeclared integration-test targets", () => {
    const resolve = resolver([...files, "cmd/tool/nested/Cargo.toml", "cmd/tool/nested/mod.rs", "tests/test.rs"], sources);
    expect(resolve("cmd/tool/nested/mod.rs", dependency("crate::flags"))).toEqual([]);
    expect(resolve("tests/test.rs", dependency("crate::flags"))).toEqual([]);
    expect(resolve("cmd/tool/flags/mod.rs", dependency("super::super::flags"))).toEqual([]);
  });
});
