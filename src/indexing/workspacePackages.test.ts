import { describe, expect, it } from "vitest";
import { createDependencyResolver } from "./dependencyResolver.js";

function resolver(files: string[], configs: Record<string, unknown>) {
  const sources = new Map(Object.entries(configs).map(([file, value]) => [file, JSON.stringify(value)]));
  const resolve = createDependencyResolver(new Set([...files, ...sources.keys()]), sources);
  return (from: string, specifier: string) => resolve(from, { specifier, line: 1 });
}
const app = { name: "app", dependencies: { "@repo/ui": "workspace:*" } };
const ui = (exports: unknown) => ({ name: "@repo/ui", exports });

describe("indexed workspace package source navigation", () => {
  it("links declared workspace packages and self references, with exact and most-specific wildcard exports", () => {
    const resolve = resolver(["packages/ui/src/index.ts", "packages/ui/src/button.tsx", "packages/ui/special/button.tsx"], {
      "apps/web/package.json": app,
      "packages/ui/package.json": ui({ ".": "./src/index.ts", "./*": "./src/*.tsx", "./special/*": "./special/*.tsx", "./private": null }),
    });
    expect(resolve("apps/web/src/main.tsx", "@repo/ui")).toEqual(["packages/ui/src/index.ts"]);
    expect(resolve("apps/web/src/main.tsx", "@repo/ui/button")).toEqual(["packages/ui/src/button.tsx"]);
    expect(resolve("apps/web/src/main.tsx", "@repo/ui/special/button")).toEqual(["packages/ui/special/button.tsx"]);
    expect(resolve("packages/ui/src/index.ts", "@repo/ui/button")).toEqual(["packages/ui/src/button.tsx"]);
    expect(resolve("apps/web/src/main.tsx", "@repo/ui/private")).toEqual([]);
    expect(resolve("apps/web/src/main.tsx", "@repo/ui/src/index.ts")).toEqual([]);
  });

  it("keeps external, undeclared, versioned, duplicate and conflicting dependency contexts unresolved", () => {
    const files = ["packages/ui/src/index.ts"];
    const manifest = { "packages/ui/package.json": ui("./src/index.ts") };
    for (const declarations of [{}, { dependencies: { "@repo/ui": "^1.0.0" } }, { dependencies: { "@repo/ui": "workspace:^1" } },
      { dependencies: { "@repo/ui": "workspace:*" }, devDependencies: { "@repo/ui": "^1" } }]) {
      expect(resolver(files, { ...manifest, "apps/web/package.json": declarations })("apps/web/main.ts", "@repo/ui")).toEqual([]);
    }
    expect(resolver(files, { ...manifest, "apps/web/package.json": app, "other/ui/package.json": ui("./index.ts") })("apps/web/main.ts", "@repo/ui")).toEqual([]);
  });

  it("links a single available conditional source but never invents a missing generated target or selects a conflicting branch", () => {
    const files = ["packages/ui/src/index.ts", "packages/ui/src/browser.ts"];
    const configs = { "apps/web/package.json": app };
    expect(resolver(files, { ...configs, "packages/ui/package.json": ui({ types: "./dist/index.d.ts", default: "./src/index.ts" }) })("apps/web/main.ts", "@repo/ui")).toEqual(["packages/ui/src/index.ts"]);
    for (const exports of [{ import: "./src/index.ts", require: "./src/browser.ts" }, { default: "./dist/index.js" },
      { browser: null, default: "./src/index.ts" }, ["./missing.ts", "./src/index.ts"], { ".": "./src/index.ts", default: "./src/index.ts" }]) {
      expect(resolver(files, { ...configs, "packages/ui/package.json": ui(exports) })("apps/web/main.ts", "@repo/ui")).toEqual([]);
    }
  });

  it.each(["../outside.ts", "./src/../index.ts", "./node_modules/value.ts", "./src/%2e%2e/index.ts", "/absolute.ts", "./src/index", "./missing.ts"])("does not follow unsafe, extensionless or unavailable export %s", (target) => {
    expect(resolver(["packages/ui/src/index.ts", "packages/outside.ts"], { "apps/web/package.json": app, "packages/ui/package.json": ui(target) })("apps/web/main.ts", "@repo/ui")).toEqual([]);
  });

  it("does not bypass a blocked specific export, infer main/types, or let a workspace package override a selected paths alias", () => {
    const files = ["packages/ui/src/button.tsx", "apps/web/local.ts"];
    const configs = { "apps/web/package.json": app, "packages/ui/package.json": ui({ "./*": "./src/*.tsx", "./button": null }) };
    expect(resolver(files, configs)("apps/web/main.ts", "@repo/ui/button")).toEqual([]);
    expect(resolver(files, { ...configs, "packages/ui/package.json": { name: "@repo/ui", main: "./src/button.tsx", types: "./src/button.tsx" } })("apps/web/main.ts", "@repo/ui")).toEqual([]);
    expect(resolver(files, { ...configs, "packages/ui/package.json": ui("./src/button.tsx"), "apps/web/tsconfig.json": { compilerOptions: { paths: { "@repo/ui": ["missing"] } } } })("apps/web/main.ts", "@repo/ui")).toEqual([]);
  });

  it("loads workspace config subpaths and their relative parents without importing config packages at runtime", () => {
    const resolve = resolver(["apps/web/src/value.ts"], {
      "apps/web/package.json": { devDependencies: { "@repo/tsconfig": "workspace:^" } },
      "tooling/typescript/package.json": { name: "@repo/tsconfig" },
      "tooling/typescript/base.json": { compilerOptions: { strict: true } },
      "tooling/typescript/app.json": { extends: "./base.json" },
      "apps/web/tsconfig.json": { extends: "@repo/tsconfig/app.json", compilerOptions: { paths: { "~/*": ["./src/*"] } } },
    });
    expect(resolve("apps/web/main.ts", "~/value")).toEqual(["apps/web/src/value.ts"]);
    expect(resolve("apps/web/main.ts", "@repo/tsconfig/app.json")).toEqual([]);
  });

  it("does not inherit workspace declarations across a nearer package boundary", () => {
    expect(resolver(["packages/ui/src/index.ts"], {
      "package.json": app, "apps/web/package.json": {}, "packages/ui/package.json": ui("./src/index.ts"),
    })("apps/web/main.ts", "@repo/ui")).toEqual([]);
  });

  it("does not bypass an ambiguous project or unreadable parent with a workspace export", () => {
    const configs = { "package.json": app, "packages/ui/package.json": ui("./src/index.ts") };
    const files = ["packages/ui/src/index.ts", "src/one.ts", "src/two.ts"];
    expect(resolver(files, { ...configs, "tsconfig.json": { extends: "unavailable-config" } })("src/main.ts", "@repo/ui")).toEqual([]);
    expect(resolver(files, {
      ...configs, "tsconfig.json": { files: [], references: [{ path: "one.json" }, { path: "two.json" }] },
      "one.json": { include: ["src"], compilerOptions: { paths: { "@repo/ui": ["src/one"] } } },
      "two.json": { include: ["src"], compilerOptions: { paths: { "@repo/ui": ["src/two"] } } },
    })("src/main.ts", "@repo/ui")).toEqual([]);
  });
});

describe("explicit solution project references", () => {
  const configs = {
    "tsconfig.json": { files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./node" }], compilerOptions: { paths: { "@/*": ["wrong/*"] } } },
    "tsconfig.app.json": { include: ["./src/**/*.ts"], exclude: ["./src/**/*.test.ts"], compilerOptions: { paths: { "@/*": ["src/*"] } } },
    "node/tsconfig.json": { files: ["../vite.config.ts"], compilerOptions: { paths: { "@/*": ["../node/*"] } } },
  };
  const files = ["src/value.ts", "node/value.ts", "wrong/value.ts"];
  it("selects a referenced config by explicit files/include/exclude, without inheriting solution aliases", () => {
    const resolve = resolver(files, configs);
    expect(resolve("src/main.ts", "@/value")).toEqual(["src/value.ts"]);
    expect(resolve("vite.config.ts", "@/value")).toEqual(["node/value.ts"]);
    expect(resolve("src/main.test.ts", "@/value")).toEqual([]);
    expect(resolve("unlisted.ts", "@/value")).toEqual([]);
  });

  it("does not merge project reference compiler options with those of the solution", () => {
    expect(resolver(files, { ...configs, "tsconfig.app.json": { include: ["src"] } })("src/main.ts", "@/value")).toEqual([]);
  });

  it("honors files over exclude, replaces inherited selectors, and does not select a sibling directory through include dot", () => {
    const resolve = resolver(files, {
      "tsconfig.json": { files: [], references: [{ path: "app.json" }, { path: "node/tsconfig.json" }] },
      "base.json": { include: ["node"], compilerOptions: { paths: { "@/*": ["src/*"] } } },
      "app.json": { extends: "./base.json", include: ["src"], files: ["src/main.test.ts"], exclude: ["src/**/*.test.ts"] },
      "node/tsconfig.json": { include: ["."], compilerOptions: { paths: { "@/*": ["value"] } } },
    });
    expect(resolve("src/main.ts", "@/value")).toEqual(["src/value.ts"]);
    expect(resolve("src/main.test.ts", "@/value")).toEqual(["src/value.ts"]);
    expect(resolve("node/main.ts", "@/value")).toEqual(["node/value.ts"]);
  });

  it("keeps overlapping, implicit, missing, invalid and cyclic referenced projects unresolved", () => {
    for (const second of [{ include: ["../src"] }, {}, { include: "../src" }, { files: [], references: [{ path: "../tsconfig.json" }] }]) {
      expect(resolver(files, { ...configs, "node/tsconfig.json": second })("src/main.ts", "@/value")).toEqual([]);
    }
    expect(resolver(files, { ...configs, "tsconfig.json": { files: [], references: [{ path: "missing" }] } })("src/main.ts", "@/value")).toEqual([]);
  });

  it("inherits file selectors relative to their origin, replaces include, and does not inherit references", () => {
    const resolve = resolver(files, {
      "config/base.json": { include: ["../src"], references: [{ path: "missing" }], compilerOptions: { paths: { "@/*": ["../src/*"] } } },
      "tsconfig.json": { files: [], references: [{ path: "app.jsonc" }] },
      "app.jsonc": { extends: "./config/base" },
    });
    expect(resolve("src/main.ts", "@/value")).toEqual(["src/value.ts"]);
    expect(resolve("other/main.ts", "@/value")).toEqual([]);
  });
});
