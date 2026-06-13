import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { readDetailedIndexStatus, readIndexFreshness, recommendedNextActions, type DetailedIndexStatus } from "./indexStatus.js";

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

describe("readIndexFreshness", () => {
  async function createIndex() {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
    return persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });
  }

  it("reports fresh indexes", async () => {
    const metadata = await createIndex();

    const freshness = await readIndexFreshness({
      projectPath: tempDir,
      dbPath: metadata.dbPath,
      limits: { maxFileBytes: 1024 },
    });

    expect(freshness).toEqual(
      expect.objectContaining({
        checked: true,
        status: "fresh",
        indexedFiles: 1,
        scannedFiles: 1,
        staleFiles: 0,
      }),
    );
  });

  it("reports new, modified, and missing files", async () => {
    const metadata = await createIndex();
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 2;\n");
    await fs.writeFile(path.join(tempDir, "b.ts"), "export const b = 1;\n");

    const freshness = await readIndexFreshness({
      projectPath: tempDir,
      dbPath: metadata.dbPath,
      limits: { maxFileBytes: 1024 },
    });

    expect(freshness).toEqual(
      expect.objectContaining({
        status: "stale",
        staleFiles: 2,
        newFiles: 1,
        modifiedFiles: 1,
        missingFiles: 0,
      }),
    );
    expect(freshness.samples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "a.ts", reason: "modified" }),
        expect.objectContaining({ path: "b.ts", reason: "new" }),
      ]),
    );

    await fs.rm(path.join(tempDir, "a.ts"));
    const afterDelete = await readIndexFreshness({
      projectPath: tempDir,
      dbPath: metadata.dbPath,
      limits: { maxFileBytes: 1024 },
    });

    expect(afterDelete).toEqual(expect.objectContaining({ status: "stale", missingFiles: 1 }));
    expect(afterDelete.samples).toEqual(expect.arrayContaining([expect.objectContaining({ path: "a.ts", reason: "missing" })]));
  });

  it("reports metadata-only changes separately from content modifications", async () => {
    const metadata = await createIndex();
    const future = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(tempDir, "a.ts"), future, future);

    const freshness = await readIndexFreshness({
      projectPath: tempDir,
      dbPath: metadata.dbPath,
      limits: { maxFileBytes: 1024 },
    });

    expect(freshness).toEqual(
      expect.objectContaining({
        status: "stale",
        metadataChangedFiles: 1,
        modifiedFiles: 0,
      }),
    );
    expect(freshness.samples).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "a.ts", reason: "metadata_changed" })]),
    );
  });

  it("uses the sole indexed project path as a migration alias", async () => {
    const metadata = await createIndex();
    const legacyPath = `${tempDir}-legacy`;
    const db = new Database(metadata.dbPath);
    try {
      db.prepare("update files set project_path = ?").run(legacyPath);
    } finally {
      db.close();
    }

    const freshness = await readIndexFreshness({
      projectPath: tempDir,
      dbPath: metadata.dbPath,
      limits: { maxFileBytes: 1024 },
    });

    expect(freshness).toEqual(
      expect.objectContaining({
        status: "fresh",
        indexedFiles: 1,
        indexedProjectPaths: [tempDir, legacyPath],
      }),
    );
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

  it("recommends metadata refresh for stale indexes", () => {
    const status: DetailedIndexStatus = {
      exists: true,
      dbPath: "/repo/.scythe-context/index.sqlite",
      files: 1,
      chunks: 1,
      ftsRows: 1,
      symbols: 1,
      dependencies: 0,
      embeddingSets: [{ id: 1, provider: "gemini", model: "gemini-embedding-2", dimensions: 1536, embeddings: 1 }],
    };

    expect(
      recommendedNextActions(status, {
        desiredDimensions: 1536,
        freshness: {
          checked: true,
          status: "stale",
          checkedAt: new Date(0).toISOString(),
          indexedFiles: 1,
          indexedProjectPaths: ["/repo"],
          scannedFiles: 2,
          staleFiles: 1,
          newFiles: 1,
          modifiedFiles: 0,
          metadataChangedFiles: 0,
          missingFiles: 0,
          skippedFiles: 0,
          samples: [{ path: "new.ts", reason: "new" }],
        },
      }),
    ).toContain("Run repo_reindex with dry_run=false to refresh stale, new, missing, or metadata-changed files.");
  });
});
