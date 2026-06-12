import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { keywordTerms, searchByKeyword } from "./keywordSearch.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-keyword-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("keyword search", () => {
  it("extracts stable keyword terms", () => {
    expect(keywordTerms("find processPayment() in payment-service.ts")).toEqual([
      "find",
      "processPayment",
      "in",
      "payment-service.ts",
    ]);
  });

  it("returns FTS matches with file ranges", async () => {
    await fs.writeFile(path.join(tempDir, "payment.ts"), "export function processPayment() { return 'paid'; }\n");
    await fs.writeFile(path.join(tempDir, "user.ts"), "export function loadUser() { return 'user'; }\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchByKeyword({
      dbPath: metadata.dbPath,
      query: "processPayment",
      maxResults: 5,
      maxSnippetChars: 80,
    });

    expect(results[0]).toEqual(
      expect.objectContaining({
        path: "payment.ts",
        startLine: 1,
        endLine: 1,
        matchType: "keyword",
      }),
    );
  });

  it("falls back to LIKE for short terms", async () => {
    await fs.writeFile(path.join(tempDir, "go.ts"), "go\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchByKeyword({
      dbPath: metadata.dbPath,
      query: "go",
      maxResults: 5,
      maxSnippetChars: 80,
    });

    expect(results[0]?.path).toBe("go.ts");
  });
});
