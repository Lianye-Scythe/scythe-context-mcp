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
});
