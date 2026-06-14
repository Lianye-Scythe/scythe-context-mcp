import { describe, expect, it } from "vitest";
import {
  shapeContextPackPayload,
  shapeDoctorPayload,
  shapeEmbeddingProbePayload,
  shapeIndexStatusPayload,
  shapeReindexPayload,
  shapeRelatedFilesPayload,
  shapeSemanticPayload,
} from "./responseShape.js";

const longSnippet = "x".repeat(900);

describe("response shaping", () => {
  it("compacts doctor output by keeping ok checks summary-only", () => {
    const shaped = shapeDoctorPayload(
      {
        status: "warn",
        projectPath: "/repo",
        indexPath: "/repo/.scythe-context",
        checks: [
          {
            name: "node_runtime",
            status: "ok",
            summary: "Node is supported.",
            details: { executable: "/usr/bin/node", node: "24.16.0" },
          },
          {
            name: "gemini_config",
            status: "warn",
            summary: "API key is missing.",
            details: { hasApiKey: false, model: "gemini-embedding-2" },
            recommendedActions: ["Set GEMINI_API_KEY."],
          },
        ],
        recommendedNextActions: ["Set GEMINI_API_KEY."],
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      responseMode: "compact",
      checkSummary: { ok: 1, warn: 1 },
      checks: [
        {
          name: "node_runtime",
          status: "ok",
          summary: "Node is supported.",
        },
        {
          name: "gemini_config",
          status: "warn",
          details: { hasApiKey: false, model: "gemini-embedding-2" },
        },
      ],
    });
    expect((shaped.checks as Array<Record<string, unknown>>)[0]).not.toHaveProperty("details");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("keeps raw doctor output in full mode", () => {
    const shaped = shapeDoctorPayload(
      {
        status: "ok",
        checks: [{ name: "node_runtime", status: "ok", details: { executable: "/usr/bin/node" } }],
      },
      "full",
    );

    expect(shaped).toMatchObject({
      checks: [{ details: { executable: "/usr/bin/node" } }],
    });
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("compacts successful embedding probes without vector samples or raw provider keys", () => {
    const shaped = shapeEmbeddingProbePayload(
      {
        status: "ok",
        latencyMs: 123,
        projectPath: "/repo",
        indexPath: "/repo/.scythe-context",
        diagnostics: {
          baseUrl: "https://example.test",
          normalizedBaseUrl: "https://example.test/v1beta",
          endpoint: "https://example.test/v1beta/models/gemini-embedding-2:embedContent",
          model: "gemini-embedding-2",
          expectedDimensions: 1536,
          authMode: "bearer",
          hasApiKey: true,
        },
        providerCapabilities: {
          provider: "gemini",
          key: "provider-secret-cache-key",
          baseUrlHash: "hash",
          model: "gemini-embedding-2",
          dimensions: 1536,
          authMode: "bearer",
          outputDimensionality: "supported",
        },
        model: "gemini-embedding-2",
        dimensions: 1536,
        dimensionsMatchExpected: true,
        sample: [0.1, 0.2, 0.3],
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      status: "ok",
      responseMode: "compact",
      diagnostics: {
        model: "gemini-embedding-2",
        expectedDimensions: 1536,
        authMode: "bearer",
        hasApiKey: true,
        normalizedBaseUrl: "https://example.test/v1beta",
      },
      providerCapabilities: {
        provider: "gemini",
        model: "gemini-embedding-2",
        outputDimensionality: "supported",
      },
      dimensionsMatchExpected: true,
    });
    expect(shaped).not.toHaveProperty("sample");
    expect(JSON.stringify(shaped)).not.toContain("provider-secret-cache-key");
    expect(JSON.stringify(shaped)).not.toContain("baseUrlHash");
    expect(JSON.stringify(shaped)).not.toContain("embedContent");
  });

  it("compacts failed embedding probes without response body snippets", () => {
    const shaped = shapeEmbeddingProbePayload(
      {
        status: "embedding_probe_failed",
        latencyMs: 123,
        diagnostics: { model: "gemini-embedding-2", expectedDimensions: 1536, authMode: "bearer", hasApiKey: true },
        error: {
          type: "GeminiEmbeddingError",
          message: "HTTP 500",
          httpStatus: 500,
          retryable: true,
          bodySnippet: "long upstream body",
        },
        recommendedNextActions: ["Retry later."],
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      status: "embedding_probe_failed",
      error: {
        type: "GeminiEmbeddingError",
        message: "HTTP 500",
        httpStatus: 500,
        retryable: true,
      },
      recommendedNextActions: ["Retry later."],
    });
    expect(JSON.stringify(shaped)).not.toContain("long upstream body");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("keeps raw embedding probe details in full mode", () => {
    const shaped = shapeEmbeddingProbePayload(
      {
        status: "ok",
        sample: [0.1],
        providerCapabilities: { key: "provider-secret-cache-key" },
      },
      "full",
    );

    expect(shaped).toMatchObject({
      sample: [0.1],
      providerCapabilities: { key: "provider-secret-cache-key" },
    });
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("compacts index status output for the default tool entrypoint", () => {
    const shaped = shapeIndexStatusPayload(
      {
        projectPath: "/repo",
        indexPath: "/repo/.scythe-context",
        status: "usable_mvp",
        index: {
          exists: true,
          dbPath: "/repo/.scythe-context/index.sqlite",
          files: 10,
          chunks: 20,
          ftsRows: 20,
          symbols: 5,
          dependencies: 4,
          embeddingSets: [{ id: 1, provider: "gemini", model: "gemini-embedding-2", dimensions: 1536, embeddings: 20 }],
        },
        freshness: {
          checked: true,
          status: "fresh",
          checkedAt: "2026-06-14T00:00:00.000Z",
          indexedProjectPaths: ["/repo"],
          staleFiles: 0,
          newFiles: 0,
          modifiedFiles: 0,
          metadataChangedFiles: 0,
          missingFiles: 0,
          skippedFiles: 2,
          samples: [],
        },
        recommendedNextActions: ["Index is ready."],
        implemented: ["mcp_server", "repo_doctor"],
        pending: ["tree_sitter_symbols"],
        indexing: { maxFileBytes: 1000 },
        gemini: { baseUrl: "https://example.test", hasApiKey: true },
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      responseMode: "compact",
      index: {
        exists: true,
        files: 10,
        chunks: 20,
      },
      freshness: {
        status: "fresh",
        skippedFiles: 2,
      },
    });
    expect(shaped).not.toHaveProperty("implemented");
    expect(shaped).not.toHaveProperty("pending");
    expect(shaped).not.toHaveProperty("indexing");
    expect(shaped).not.toHaveProperty("gemini");
    expect(JSON.stringify(shaped)).not.toContain("dbPath");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("keeps raw index status details in full mode", () => {
    const shaped = shapeIndexStatusPayload(
      {
        projectPath: "/repo",
        implemented: ["mcp_server"],
        gemini: { baseUrl: "https://example.test" },
      },
      "full",
    );

    expect(shaped).toMatchObject({
      implemented: ["mcp_server"],
      gemini: { baseUrl: "https://example.test" },
    });
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("compacts related file metadata by dropping symbol signatures", () => {
    const shaped = shapeRelatedFilesPayload(
      {
        projectPath: "/repo",
        dbPath: "/repo/.scythe-context/index.sqlite",
        path: "src/index.ts",
        symbols: [
          {
            name: "main",
            kind: "function",
            line: 10,
            signature: "export function main() { /* long signature */ }",
            exported: true,
          },
        ],
        imports: [{ specifier: "./config.js", resolvedPath: "src/config.ts", line: 1 }],
        importedBy: [{ path: "src/cli.ts", specifier: "./index.js", line: 2 }],
      },
      "compact",
    );

    expect(shaped).toMatchObject({
      responseMode: "compact",
      path: "src/index.ts",
      counts: {
        symbols: 1,
        imports: 1,
        importedBy: 1,
      },
      symbols: [{ name: "main", kind: "function", line: 10, exported: true }],
    });
    expect(shaped).not.toHaveProperty("dbPath");
    expect(JSON.stringify(shaped)).not.toContain("long signature");
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

  it("keeps raw related file metadata in full mode", () => {
    const shaped = shapeRelatedFilesPayload(
      {
        path: "src/index.ts",
        symbols: [{ name: "main", signature: "export function main()" }],
      },
      "full",
    );

    expect(shaped).toMatchObject({
      symbols: [{ name: "main", signature: "export function main()" }],
    });
    expect(shaped).toHaveProperty("responseStats.estimatedOutputTokens");
  });

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
