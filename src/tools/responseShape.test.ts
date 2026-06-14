import { describe, expect, it } from "vitest";
import { shapeContextPackPayload, shapeSemanticPayload } from "./responseShape.js";

const longSnippet = "x".repeat(900);

describe("response shaping", () => {
  it("omits snippets and heavy metadata in paths_only mode", () => {
    const shaped = shapeContextPackPayload(
      {
        query: "find config loader",
        projectPath: "/repo",
        dbPath: "/repo/.scythe-context/index.sqlite",
        dimensions: 1536,
        mode: "hybrid",
        effectiveMode: "hybrid",
        rerankMode: "auto",
        rerankApplied: true,
        relatedDepth: 1,
        relatedSeedCount: 1,
        includeRelatedSnippets: true,
        primaryResults: [
          {
            path: "src/config.ts",
            startLine: 1,
            endLine: 20,
            matchTypes: ["keyword"],
            matchReason: "keyword/path match",
            grepKeywords: ["config"],
            snippet: longSnippet,
            snippetTruncated: false,
          },
        ],
        relatedFiles: [
          {
            sourcePath: "src/index.ts",
            role: "imported_by",
            depth: 1,
            via: "src/config.ts",
            symbols: ["main"],
            imports: ["./config.js"],
            importedBy: [],
          },
        ],
        relatedSnippets: [{ path: "src/index.ts", snippet: longSnippet }],
        suggestedPaths: ["src/config.ts", "src/index.ts"],
        context: { usedContextChars: 900 },
      },
      "paths_only",
    );

    expect(shaped).toMatchObject({
      responseMode: "paths_only",
      primaryResults: [
        {
          path: "src/config.ts",
          startLine: 1,
          endLine: 20,
          matchReason: "keyword/path match",
        },
      ],
      relatedFiles: [
        {
          sourcePath: "src/index.ts",
          role: "imported_by",
          depth: 1,
          via: "src/config.ts",
        },
      ],
      relatedSnippets: [],
    });
    expect(JSON.stringify(shaped)).not.toContain(longSnippet);
    expect(shaped).not.toHaveProperty("dbPath");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("marks compacted snippets as truncated", () => {
    const shaped = shapeSemanticPayload(
      {
        query: "find long snippet",
        projectPath: "/repo",
        mode: "hybrid",
        effectiveMode: "hybrid",
        rerankMode: "auto",
        rerankApplied: true,
        resultCount: 1,
        results: [
          {
            path: "src/search.ts",
            startLine: 10,
            endLine: 40,
            matchTypes: ["semantic"],
            matchReason: "semantic similarity",
            grepKeywords: [],
            score: 0.9,
            snippet: longSnippet,
            snippetTruncated: false,
          },
        ],
        context: { usedContextChars: 900 },
      },
      "compact",
    );

    const [result] = shaped.results as Array<Record<string, unknown>>;
    expect(result.snippetTruncated).toBe(true);
    expect(result.snippet).toContain("... [truncated]");
    expect(String(result.snippet).length).toBeLessThan(longSnippet.length);
  });

  it("keeps diagnostic fields in snippets mode", () => {
    const shaped = shapeSemanticPayload(
      {
        query: "embedding dimensions",
        projectPath: "/repo",
        dbPath: "/repo/.scythe-context/index.sqlite",
        dimensions: 1536,
        mode: "hybrid",
        effectiveMode: "hybrid",
        rerankMode: "auto",
        rerankApplied: true,
        resultCount: 0,
        results: [],
        context: { usedContextChars: 0 },
      },
      "snippets",
    );

    expect(shaped).toMatchObject({
      responseMode: "snippets",
      dbPath: "/repo/.scythe-context/index.sqlite",
      dimensions: 1536,
    });
  });
});
