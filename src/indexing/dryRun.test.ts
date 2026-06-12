import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reindexDryRun } from "./dryRun.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-dryrun-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("reindexDryRun", () => {
  it("returns file, chunk, skip, and byte statistics", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(tempDir, "big.ts"), "x".repeat(200));

    const result = await reindexDryRun({
      projectPath: tempDir,
      maxFileBytes: 100,
      targetChunkChars: 20,
      chunkOverlapChars: 4,
      maxChunksPerFile: 10,
    });

    expect(result.dryRun).toBe(true);
    expect(result.stats.indexedFiles).toBe(1);
    expect(result.stats.skippedFiles).toBe(1);
    expect(result.stats.chunks).toBeGreaterThanOrEqual(1);
    expect(result.files[0]).toEqual(
      expect.objectContaining({
        path: "a.ts",
        chunks: expect.any(Number),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ relativePath: "big.ts", reason: "too_large" })]),
    );
  });
});
