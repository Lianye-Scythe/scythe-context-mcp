import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { readDetailedIndexStatus, recommendedNextActions, type DetailedIndexStatus } from "./indexStatus.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-status-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("readDetailedIndexStatus", () => {
  it("returns empty status for a missing database", () => {
    expect(readDetailedIndexStatus(path.join(tempDir, "missing.sqlite"))).toEqual(
      expect.objectContaining({ exists: false, files: 0, chunks: 0, embeddingSets: [] }),
    );
  });

  it("returns metadata coverage for an existing database", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const status = readDetailedIndexStatus(metadata.dbPath);
    expect(status).toEqual(expect.objectContaining({ exists: true, files: 1, chunks: 1, ftsRows: 1 }));
  });
});

describe("recommendedNextActions", () => {
  it("recommends metadata indexing for a missing database", () => {
    const status = readDetailedIndexStatus(path.join(tempDir, "missing.sqlite"));
    expect(recommendedNextActions(status, { desiredDimensions: 1536 })).toEqual([
      "Run repo_reindex with dry_run=false to create the metadata index.",
      "Then run repo_reindex with dry_run=false and index_embeddings=true when semantic search or context packs need vectors.",
    ]);
  });

  it("recommends embedding indexing for metadata-only indexes", () => {
    const status: DetailedIndexStatus = {
      exists: true,
      dbPath: "/repo/.scythe-context/index.sqlite",
      files: 2,
      chunks: 4,
      ftsRows: 4,
      symbols: 3,
      dependencies: 1,
      embeddingSets: [],
    };

    expect(recommendedNextActions(status, { desiredDimensions: 1536 })).toEqual([
      "Run repo_reindex with dry_run=false and index_embeddings=true to create 1536-dimension embeddings for semantic search.",
    ]);
  });

  it("recommends context pack when the index is ready", () => {
    const status: DetailedIndexStatus = {
      exists: true,
      dbPath: "/repo/.scythe-context/index.sqlite",
      files: 2,
      chunks: 4,
      ftsRows: 4,
      symbols: 3,
      dependencies: 1,
      embeddingSets: [{ id: 1, provider: "gemini", model: "gemini-embedding-2", dimensions: 1536, embeddings: 4 }],
    };

    expect(recommendedNextActions(status, { desiredDimensions: 1536 })).toEqual([
      "Index is ready. Prefer repo_context_pack for task-oriented lookup.",
    ]);
  });
});
