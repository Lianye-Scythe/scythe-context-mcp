import { describe, expect, it } from "vitest";
import { createDependencyResolver } from "./dependencyResolver.js";

function resolver(files: string[], sources: Record<string, string>) {
  return createDependencyResolver(new Set([...files, ...Object.keys(sources)]), new Map(Object.entries(sources)));
}
const dependency = (specifier: string) => ({ specifier, line: 1 });

describe("static TypeScript/JavaScript configuration paths", () => {
  it("supports JSONC, exact/wildcard aliases, longest prefix, ordered fallbacks, directory indexes and runtime extensions", () => {
    const resolve = resolver(["src/value.ts", "src/lib/index.ts", "src/special/x.ts", "src/general/special/x.ts", "src/view.tsx"], {
      "tsconfig.json": '// comment\n{"compilerOptions":{"baseUrl":".","paths":{"fixed":["missing","src/value"],"@/*":["src/*"],"@/special/*":["src/special/*"]},},}',
    });
    expect(resolve("src/app.ts", dependency("fixed"))).toEqual(["src/value.ts"]);
    expect(resolve("src/app.ts", dependency("@/lib"))).toEqual(["src/lib/index.ts"]);
    expect(resolve("src/app.ts", dependency("@/special/x"))).toEqual(["src/special/x.ts"]);
    expect(resolve("src/app.ts", dependency("@/value.js"))).toEqual(["src/value.ts"]);
    expect(resolve("src/app.tsx", dependency("@/view"))).toEqual(["src/view.tsx"]);
    expect(resolve("src/app.ts", dependency("@/missing"))).toEqual([]);
  });

  it("resolves inherited paths against their declaring config and inherited/overridden baseUrl", () => {
    const files = ["shared/value.ts", "packages/web/value.ts", "src/one.ts", "src/two.ts"];
    const sources = { "config/base.json": '{"compilerOptions":{"paths":{"@/*":["../shared/*"]}}}', "packages/web/tsconfig.json": '{"extends":"../../config/base"}' };
    expect(resolver(files, sources)("packages/web/app.ts", dependency("@/value"))).toEqual(["shared/value.ts"]);
    const withBase = { "config/base.json": '{"compilerOptions":{"baseUrl":"../shared","paths":{"@/*":["*"]}}}', "packages/web/tsconfig.json": '{"extends":"../../config/base"}' };
    expect(resolver(files, withBase)("packages/web/app.ts", dependency("@/value"))).toEqual(["shared/value.ts"]);
    expect(resolver(files, { ...withBase, "packages/web/tsconfig.json": '{"extends":"../../config/base","compilerOptions":{"baseUrl":"."}}' })("packages/web/app.ts", dependency("@/value"))).toEqual(["packages/web/value.ts"]);
    const array = resolver(files, { "a.json": '{"compilerOptions":{"paths":{"x":["src/one"]}}}', "b.json": '{"compilerOptions":{"paths":{"x":["src/two"]}}}', "tsconfig.json": '{"extends":["./a","./b"]}' });
    expect(array("app.ts", dependency("x"))).toEqual(["src/two.ts"]);
  });

  it("uses the nearest default config, prefers tsconfig over jsconfig, and allows explicit paths overrides", () => {
    const resolve = resolver(["root.ts", "sub/value.ts"], {
      "tsconfig.json": '{"compilerOptions":{"paths":{"x":["root"]}}}',
      "sub/jsconfig.json": '{"compilerOptions":{"paths":{"x":["../root"]}}}',
      "sub/tsconfig.json": '{"compilerOptions":{"paths":{"x":["value"]}}}',
      "sub/disabled/tsconfig.json": '{"extends":"../tsconfig","compilerOptions":{"paths":{}}}',
    });
    expect(resolve("sub/app.js", dependency("x"))).toEqual(["sub/value.ts"]);
    expect(resolve("app.ts", dependency("x"))).toEqual(["root.ts"]);
    expect(resolve("sub/disabled/app.ts", dependency("x"))).toEqual([]);
  });

  it("supports jsconfig baseUrl imports and exact non-code extensions without inventing package exports", () => {
    const resolve = resolver(["src/utils.js", "src/view.vue", "src/json.json"], { "jsconfig.json": '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}' });
    expect(resolve("app.js", dependency("utils"))).toEqual(["src/utils.js"]);
    expect(resolve("app.js", dependency("@/view.vue"))).toEqual(["src/view.vue"]);
    expect(resolve("app.js", dependency("@/json.json"))).toEqual(["src/json.json"]);
    expect(resolve("app.js", dependency("external-package"))).toEqual([]);
    expect(resolve("app.py", dependency("@/utils"))).toEqual([]);
  });

  it.each([
    '{"extends":"./missing","compilerOptions":{"paths":{"x":["value"]}}}',
    '{"extends":"package-config","compilerOptions":{"paths":{"x":["value"]}}}',
    '{"extends":"./tsconfig","compilerOptions":{"paths":{"x":["value"]}}}',
    '{"compilerOptions":{"paths":{"x":["../../outside"]}}}',
    '{"compilerOptions":{"baseUrl":"/outside","paths":{"x":["value"]}}}',
    '{"compilerOptions":{"paths":{"x":["C:\\\\outside"]}}}',
    '{not json}',
  ])("does not guess from unsupported/missing/cyclic/invalid/outside-root config: %s", (config) => {
    expect(resolver(["value.ts"], { "tsconfig.json": config })("app.ts", dependency("x"))).toEqual([]);
  });

  it("uses explicit mjs/cjs substitutions and keeps malformed/tied wildcard mappings unresolved", () => {
    const files = ["src/value.mts", "src/value.cts", "src/value.ts"];
    const resolve = resolver(files, { "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}' });
    expect(resolve("app.mts", dependency("@/value.mjs"))).toEqual(["src/value.mts"]);
    expect(resolve("app.cts", dependency("@/value.cjs"))).toEqual(["src/value.cts"]);
    expect(resolver(files, { "tsconfig.json": '{"compilerOptions":{"baseUrl":"src","paths":{"value":["*"]}}}' })("app.ts", dependency("value"))).toEqual([]);
    expect(resolver(files, { "tsconfig.json": '{"compilerOptions":{"paths":{"*ue":["src/*"],"*lue":["src/*"]}}}' })("app.ts", dependency("value"))).toEqual([]);
  });

  it("does not fall back to a less-specific alias after the selected mapping misses", () => {
    const resolve = resolver(["src/foo.ts"], { "tsconfig.json": '{"compilerOptions":{"paths":{"*": ["src/*"],"foo": ["missing"]}}}' });
    expect(resolve("app.ts", dependency("foo"))).toEqual([]);
  });
});
