import { describe, expect, it } from "vitest";
import { createDependencyResolver } from "./dependencyResolver.js";

function resolver(files: string[], configs: Record<string, unknown>) {
  const sources = new Map(Object.entries(configs).map(([file, value]) => [file, JSON.stringify(value)]));
  const resolve = createDependencyResolver(new Set([...files, ...sources.keys()]), sources);
  return (from: string, specifier: string) => resolve(from, { specifier, line: 1 });
}

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
