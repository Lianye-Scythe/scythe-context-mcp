import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Node } from "web-tree-sitter";
import { regexStructureExtractor } from "../structureExtractor.js";
import { structureExtractionFixtures } from "./structureFixtures.js";
import { createExperimentalTreeSitterStructureExtractor, extractGraphFromTree, isTreeSitterCandidatePath } from "./treeSitterStructure.js";

function symbolKey(symbol: { name: string; kind: string; exported: boolean }): string {
  return `${symbol.kind}:${symbol.name}:${symbol.exported ? "export" : "local"}`;
}

interface FakeNodeOptions {
  type: string;
  text: string;
  line?: number;
  namedChildren?: Node[];
  fields?: Record<string, Node>;
  descendants?: Node[];
}

function fakeNode(options: FakeNodeOptions): Node {
  return {
    type: options.type,
    text: options.text,
    startPosition: { row: (options.line ?? 1) - 1, column: 0 },
    namedChildren: options.namedChildren ?? [],
    childForFieldName(name: string) {
      return options.fields?.[name] ?? null;
    },
    descendantsOfType(type: string) {
      return (options.descendants ?? []).filter((node) => node.type === type);
    },
  } as unknown as Node;
}

function identifier(name: string, line = 1): Node {
  return fakeNode({ type: "identifier", text: name, line });
}

function variableDeclarator(name: string, line = 1): Node {
  return fakeNode({ type: "variable_declarator", text: `${name} = 1`, line, fields: { name: identifier(name, line) } });
}

describe("experimental tree-sitter structure extractor", () => {
  it("identifies TypeScript and JavaScript candidate files", () => {
    expect(isTreeSitterCandidatePath("src/index.ts")).toBe(true);
    expect(isTreeSitterCandidatePath("src/component.tsx")).toBe(true);
    expect(isTreeSitterCandidatePath("scripts/build.mjs")).toBe(true);
    expect(isTreeSitterCandidatePath("src/index.py")).toBe(false);
    expect(isTreeSitterCandidatePath("README.md")).toBe(false);
  });

  it("falls back to the regex extractor until a parser is wired", async () => {
    const extractor = await createExperimentalTreeSitterStructureExtractor();
    expect(extractor.parserAvailable).toBe(false);
    expect(extractor.fallbackReason).toBe("missing_grammar_dir");

    for (const fixture of structureExtractionFixtures) {
      expect(extractor.extractFileGraph(fixture.relativePath, fixture.content)).toEqual(
        regexStructureExtractor.extractFileGraph(fixture.relativePath, fixture.content),
      );
    }
  });

  it("falls back when grammar wasm loading fails", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-tree-sitter-"));
    try {
      await fs.writeFile(path.join(tempDir, "tree-sitter-javascript.wasm"), "not wasm");
      const extractor = await createExperimentalTreeSitterStructureExtractor({ grammarDir: tempDir });

      expect(extractor.parserAvailable).toBe(false);
      expect(extractor.fallbackReason).toBe("grammar_load_failed");
      expect(extractor.extractFileGraph("src/index.js", "export function main() {}\n")).toEqual(
        regexStructureExtractor.extractFileGraph("src/index.js", "export function main() {}\n"),
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("extracts every variable declarator and preserves let/var versus const kind", () => {
    const localLet = fakeNode({
      type: "lexical_declaration",
      text: "let first = 1, second = 2;",
      line: 3,
      namedChildren: [variableDeclarator("first", 3), variableDeclarator("second", 3)],
    });
    const exportedConst = fakeNode({
      type: "export_statement",
      text: "export const exportedOne = 1, exportedTwo = 2;",
      line: 5,
      namedChildren: [
        fakeNode({
          type: "lexical_declaration",
          text: "const exportedOne = 1, exportedTwo = 2;",
          line: 5,
          namedChildren: [variableDeclarator("exportedOne", 5), variableDeclarator("exportedTwo", 5)],
        }),
      ],
    });
    const localVar = fakeNode({
      type: "variable_declaration",
      text: "var legacyOne = 1, legacyTwo = 2;",
      line: 8,
      namedChildren: [variableDeclarator("legacyOne", 8), variableDeclarator("legacyTwo", 8)],
    });
    const graph = extractGraphFromTree(
      fakeNode({ type: "program", text: "", namedChildren: [localLet, exportedConst, localVar] }),
    );

    expect(graph.symbols.map(symbolKey)).toEqual([
      "variable:first:local",
      "variable:second:local",
      "const:exportedOne:export",
      "const:exportedTwo:export",
      "variable:legacyOne:local",
      "variable:legacyTwo:local",
    ]);
  });

  it("keeps explicit fixtures for future tree-sitter comparison", () => {
    const checkedFixtures = structureExtractionFixtures.filter((fixture) => fixture.id !== "nested-declarations");
    for (const fixture of checkedFixtures) {
      const graph = regexStructureExtractor.extractFileGraph(fixture.relativePath, fixture.content);
      const actualSymbols = new Set(graph.symbols.map(symbolKey));
      const actualDependencies = graph.dependencies.map((dependency) => dependency.specifier);

      for (const symbol of fixture.expectedSymbols) {
        expect(actualSymbols).toContain(`${symbol.kind}:${symbol.name}:${symbol.exported ? "export" : "local"}`);
      }
      expect(actualDependencies).toEqual(expect.arrayContaining(fixture.expectedDependencies));
    }
  });
});
