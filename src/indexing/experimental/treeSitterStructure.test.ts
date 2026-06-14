import { describe, expect, it } from "vitest";
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

  it("falls back to the regex extractor until a parser is wired", () => {
    const extractor = createExperimentalTreeSitterStructureExtractor();

    for (const fixture of structureExtractionFixtures) {
      expect(extractor.extractFileGraph(fixture.relativePath, fixture.content)).toEqual(
        regexStructureExtractor.extractFileGraph(fixture.relativePath, fixture.content),
      );
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

