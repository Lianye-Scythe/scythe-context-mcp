import { describe, expect, it } from "vitest";
import { extractFileGraph, resolveDependencyPath } from "./symbolGraph.js";

describe("extractFileGraph", () => {
  it("extracts TypeScript symbols and dependencies", () => {
    const graph = extractFileGraph(
      "src/service.ts",
      `
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config";
import { helper } from "./helper";
export interface ServiceOptions { enabled: boolean }
export class Service {}
export async function runService() {}
const localValue = helper();
`,
    );

    expect(graph.dependencies.map((dependency) => dependency.specifier)).toEqual([
      "node:fs/promises",
      "node:path",
      "../config",
      "./helper",
    ]);
    expect(graph.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ServiceOptions", kind: "interface", exported: true, line: 6 }),
        expect.objectContaining({ name: "Service", kind: "class", exported: true, line: 7 }),
        expect.objectContaining({ name: "runService", kind: "function", exported: true, line: 8 }),
        expect.objectContaining({ name: "localValue", kind: "const", exported: false, line: 9 }),
      ]),
    );
  });

  it("extracts Python, Go, and Rust declarations conservatively", () => {
    const python = extractFileGraph("app.py", "from pkg.service import run\nclass Handler:\n    pass\ndef main():\n    pass\n");
    const go = extractFileGraph("main.go", 'import "fmt"\ntype Server struct{}\nfunc Run() {}\n');
    const rust = extractFileGraph("lib.rs", "use crate::service;\npub struct Server {}\npub fn run() {}\n");

    expect(python.symbols.map((symbol) => symbol.name)).toEqual(["Handler", "main"]);
    expect(python.dependencies.map((dependency) => dependency.specifier)).toEqual(["pkg.service"]);
    expect(go.symbols.map((symbol) => symbol.name)).toEqual(["Server", "Run"]);
    expect(go.dependencies.map((dependency) => dependency.specifier)).toEqual(["fmt"]);
    expect(rust.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Server", exported: true }),
        expect.objectContaining({ name: "run", exported: true }),
      ]),
    );
  });
});

describe("resolveDependencyPath", () => {
  it("resolves relative module specifiers to active repo paths", () => {
    const activePaths = new Set(["src/config.ts", "src/helper.ts", "src/nested/index.ts", "shared/util.ts"]);

    expect(resolveDependencyPath("src/service.ts", "./helper", activePaths)).toBe("src/helper.ts");
    expect(resolveDependencyPath("src/service.ts", "./nested", activePaths)).toBe("src/nested/index.ts");
    expect(resolveDependencyPath("src/service.ts", "../shared/util", activePaths)).toBe("shared/util.ts");
    expect(resolveDependencyPath("src/tools/registerTools.ts", "../config.js", activePaths)).toBe("src/config.ts");
    expect(resolveDependencyPath("src/service.ts", "node:fs", activePaths)).toBeNull();
  });
});
