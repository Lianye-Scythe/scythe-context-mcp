import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeHybridResults, searchKeywordOnly } from "./hybridSearch.js";
import { persistentReindexMetadata } from "./indexWriter.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-hybrid-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("mergeHybridResults", () => {
  it("boosts results that match both semantic and keyword searches", () => {
    const results = mergeHybridResults(
      [
        {
          path: "semantic-only.ts",
          startLine: 1,
          endLine: 2,
          distance: 0.1,
          snippet: "semantic",
          matchType: "semantic",
        },
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          distance: 0.5,
          snippet: "both semantic",
          matchType: "semantic",
        },
      ],
      [
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          score: -1,
          snippet: "both keyword",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results[0].path).toBe("both.ts");
    expect(results[0].matchTypes).toEqual(["semantic", "keyword"]);
  });

  it("keeps keyword-only results for exact symbol matches", () => {
    const results = mergeHybridResults(
      [],
      [
        {
          path: "payment.ts",
          startLine: 1,
          endLine: 1,
          score: -10,
          snippet: "processPayment",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ path: "payment.ts", matchTypes: ["keyword"] }));
  });
});

describe("searchKeywordOnly", () => {
  it("returns hybrid-shaped keyword results without a query vector", async () => {
    await fs.writeFile(path.join(tempDir, "payment.ts"), "export function processPayment() { return 'paid'; }\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "processPayment",
      maxResults: 5,
      maxSnippetChars: 80,
    });

    expect(results[0]).toEqual(expect.objectContaining({ path: "payment.ts", matchTypes: ["keyword"] }));
  });

  it("adds source counterparts for matched test files during code-aware reranking", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.ts"),
      "export function persistentReindexMetadata() { return 'source implementation'; }\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.test.ts"),
      "it('preserves stable chunk row ids so embedding cache remains useful after reindex', () => {});\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "preserve stable chunk row ids so embedding cache remains useful after reindex",
      maxResults: 5,
      maxSnippetChars: 120,
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("src/indexWriter.ts");
    expect(paths.indexOf("src/indexWriter.ts")).toBeLessThan(paths.indexOf("src/indexWriter.test.ts"));
  });

  it("can disable code-aware reranking", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.ts"),
      "export function persistentReindexMetadata() { return 'source implementation'; }\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.test.ts"),
      "it('preserves stable chunk row ids so embedding cache remains useful after reindex', () => {});\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "preserve stable chunk row ids so embedding cache remains useful after reindex",
      maxResults: 5,
      maxSnippetChars: 120,
      rerankMode: "off",
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("src/indexWriter.test.ts");
    expect(paths.indexOf("src/indexWriter.test.ts")).toBeLessThan(paths.indexOf("src/indexWriter.ts"));
  });

  it("does not let source-role boosts outrank documentation for security policy queries", async () => {
    await fs.mkdir(path.join(tempDir, "src", "tools"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "SECURITY.md"),
      "Security policy: embedding text goes to the configured remote provider and local indexes are not committed.\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "tools", "registerTools.ts"),
      "export const message = 'embedding provider remote configured local index text';\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "security policy should explain embedding text goes to configured remote provider and local indexes are not committed",
      maxResults: 5,
      maxSnippetChars: 160,
    });

    expect(results[0].path).toBe("SECURITY.md");
  });
});
