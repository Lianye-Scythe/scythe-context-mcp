import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { regexStructureExtractor } from "../structureExtractor.js";
import { structureExtractionFixtures } from "./structureFixtures.js";
import { createExperimentalTreeSitterStructureExtractor, isTreeSitterCandidatePath } from "./treeSitterStructure.js";

function symbolKey(symbol: { name: string; kind: string; exported: boolean }): string {
  return `${symbol.kind}:${symbol.name}:${symbol.exported ? "export" : "local"}`;
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
