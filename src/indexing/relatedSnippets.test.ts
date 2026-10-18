import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import Database from "better-sqlite3";
import { readRelatedSnippets } from "./relatedSnippets.js";

describe("related snippets", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-related-snippets-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads related snippets with an independent context budget", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "service.ts"), "export function service() {\n  return 'service';\n}\n");
    await fs.writeFile(path.join(tempDir, "src", "repo.ts"), "export function repo() {\n  return 'repo';\n}\n");

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const pack = readRelatedSnippets({
      dbPath: metadata.dbPath,
      paths: ["src/service.ts", "src/repo.ts"],
      maxSnippetsPerFile: 1,
      maxSnippetChars: 24,
      maxRelatedContextChars: 40,
    });

    expect(pack.snippets.map((snippet) => snippet.path)).toEqual(["src/service.ts", "src/repo.ts"]);
    expect(pack.summary.relatedSnippetCount).toBe(2);
    expect(pack.summary.usedRelatedContextChars).toBeLessThanOrEqual(40);
    expect(pack.summary.truncatedRelatedSnippets).toBeGreaterThan(0);
  });

  it("returns an empty related snippet pack for an uninitialized database", async () => {
    const dbPath = path.join(tempDir, "empty.sqlite");
    const db = new Database(dbPath);
    db.close();

    expect(
      readRelatedSnippets({
        dbPath,
        paths: ["src/service.ts"],
        maxSnippetsPerFile: 1,
        maxSnippetChars: 100,
        maxRelatedContextChars: 100,
      }),
    ).toEqual({
      snippets: [],
      summary: {
        maxRelatedContextChars: 100,
        usedRelatedContextChars: 0,
        relatedSnippetCount: 0,
        truncatedRelatedSnippets: 0,
      },
    });
  });
});
