import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { readDetailedIndexStatus } from "./indexStatus.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-status-"));
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
      indexDirName: ".repo-beacon",
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
