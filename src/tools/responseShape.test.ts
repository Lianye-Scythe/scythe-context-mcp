import { describe, expect, it } from "vitest";
import { shapeContextPackPayload, shapeReindexPayload, shapeSemanticPayload } from "./responseShape.js";

const longSnippet = "x".repeat(900);

describe("response shaping", () => {
  it("compacts reindex output for routine Codex use", () => {
    const shaped = shapeReindexPayload(
      {
        projectPath: "/repo",
        dryRun: false,
        status: "metadata_and_embeddings_indexed",
        dbPath: "/repo/.scythe-context/index.sqlite",
        stats: {
          scannedFiles: 10,
          indexedFiles: 8,
          skippedFiles: 2,
          chunks: 20,
          bytes: 1000,
          symbols: 5,
          dependencies: 4,
        },
        skipped: [
          { relativePath: "local/secrets/test api.txt", reason: "ignored" },
          { relativePath: "dist/index.js", reason: "ignored" },
        ],
        embeddings: {
          status: "embeddings_indexed",
          dbPath: "/repo/.scythe-context/index.sqlite",
          embeddingSetId: 1,
          dimensions: 1536,
          stats: {
            pendingChunks: 2,
            embeddedChunks: 2,
            skippedChunks: 0,
            batches: 1,
            batchFallbacks: 0,
          },
        },
        providerCapabilities: {
          provider: "gemini",
          baseUrl: "https://example.test",
          model: "gemini-embedding-2",
          dimensions: 1536,
          authMode: "bearer",
          key: "provider-secret-cache-key",
          baseUrlHash: "hash",
          batchEmbedding: "supported",
          outputDimensionality: "supported",
          lastSuccessAt: "2026-06-14T00:00:00.000Z",
        },
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      responseMode: "compact",
      indexPath: "/repo/.scythe-context",
      skippedSummary: {
        total: 2,
        byReason: { ignored: 2 },
      },
      embeddings: {
        status: "embeddings_indexed",
        dimensions: 1536,
      },
      providerCapabilities: {
        provider: "gemini",
        model: "gemini-embedding-2",
        batchEmbedding: "supported",
      },
    });
    expect(shaped).not.toHaveProperty("skipped");
    expect(shaped).not.toHaveProperty("dbPath");
    expect(JSON.stringify(shaped)).not.toContain("provider-secret-cache-key");
    expect(JSON.stringify(shaped)).not.toContain("baseUrlHash");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("keeps raw reindex details in full mode", () => {
    const shaped = shapeReindexPayload(
      {
        projectPath: "/repo",
        dryRun: true,
        limits: { maxFileBytes: 1000 },
        files: [{ path: "src/index.ts", size: 10, hash: "abc", chunks: 1 }],
        skipped: [{ relativePath: "dist/index.js", reason: "ignored" }],
      },
      "full",
    );

    expect(shaped).toMatchObject({
      dryRun: true,
      files: [{ path: "src/index.ts", size: 10, hash: "abc", chunks: 1 }],
      skipped: [{ relativePath: "dist/index.js", reason: "ignored" }],
    });
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("recommends embedding indexing after metadata-only reindex", () => {
    const shaped = shapeReindexPayload(
      {
        projectPath: "/repo",
        dryRun: false,
        status: "metadata_indexed",
        dbPath: "/repo/.scythe-context/index.sqlite",
        stats: { scannedFiles: 1, indexedFiles: 1, skippedFiles: 0, chunks: 1, bytes: 10 },
        skipped: [],
      },
      "compact",
    );

    expect(shaped.recommendedNextActions).toContain(
      "Run repo_reindex with dry_run=false and index_embeddings=true when semantic search or hybrid context packs need vectors.",
    );
  });

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
