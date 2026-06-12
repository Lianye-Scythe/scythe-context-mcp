import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { classifyRelatedPath, readRelatedFileGraph, readRelatedFiles } from "./relatedFiles.js";
import { vectorTableName } from "../storage/schema.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-writer-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("persistentReindexMetadata", () => {
  it("persists file and chunk metadata into the repo index database", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
    await fs.writeFile(path.join(tempDir, "b.ts"), "export const b = 2;\n");

    const result = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 10,
      chunkOverlapChars: 2,
      maxChunksPerFile: 10,
    });

    expect(result.status).toBe("metadata_indexed");
    expect(result.stats.indexedFiles).toBe(2);
    expect(result.stats.chunks).toBeGreaterThanOrEqual(2);

    const db = new Database(result.dbPath);
    try {
      const fileCount = db.prepare("select count(*) as count from files").get() as { count: number };
      const chunkCount = db.prepare("select count(*) as count from chunks").get() as { count: number };
      const vectorTables = db
        .prepare("select name from sqlite_master where name = ?")
        .all(vectorTableName(1536)) as Array<{ name: string }>;

      expect(fileCount.count).toBe(2);
      expect(chunkCount.count).toBe(result.stats.chunks);
      expect(vectorTables).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("replaces chunks for files that are reindexed", async () => {
    const filePath = path.join(tempDir, "a.ts");
    await fs.writeFile(filePath, "one\ntwo\nthree\n");
    const first = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 8,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    await fs.writeFile(filePath, "changed\n");
    const second = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 8,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const db = new Database(second.dbPath);
    try {
      const fileCount = db.prepare("select count(*) as count from files").get() as { count: number };
      const chunkCount = db.prepare("select count(*) as count from chunks").get() as { count: number };
      const file = db.prepare("select hash from files where path = ?").get("a.ts") as { hash: string };

      expect(first.dbPath).toBe(second.dbPath);
      expect(fileCount.count).toBe(1);
      expect(chunkCount.count).toBe(second.stats.chunks);
      expect(file.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      db.close();
    }
  });

  it("keeps unchanged chunk rows stable and removes stale files", async () => {
    const stableFile = path.join(tempDir, "stable.ts");
    const removedFile = path.join(tempDir, "removed.ts");
    await fs.writeFile(stableFile, "stable\n");
    await fs.writeFile(removedFile, "removed\n");

    const first = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 20,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });
    const firstDb = new Database(first.dbPath);
    const firstChunk = firstDb
      .prepare("select chunks.id from chunks join files on files.id = chunks.file_id where files.path = ?")
      .get("stable.ts") as { id: number };
    firstDb.close();

    await fs.rm(removedFile);
    const second = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 20,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const db = new Database(second.dbPath);
    try {
      const files = db.prepare("select path from files order by path").all() as Array<{ path: string }>;
      const stableChunk = db
        .prepare("select chunks.id from chunks join files on files.id = chunks.file_id where files.path = ?")
        .get("stable.ts") as { id: number };

      expect(files.map((file) => file.path)).toEqual(["stable.ts"]);
      expect(stableChunk.id).toBe(firstChunk.id);
    } finally {
      db.close();
    }
  });

  it("repairs missing FTS rows for unchanged files", async () => {
    const filePath = path.join(tempDir, "stable.ts");
    await fs.writeFile(filePath, "stable keyword\n");
    const first = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 20,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const db = new Database(first.dbPath);
    try {
      db.prepare("delete from chunk_fts").run();
    } finally {
      db.close();
    }

    await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 20,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const verifyDb = new Database(first.dbPath);
    try {
      const chunks = verifyDb.prepare("select count(*) as count from chunks").get() as { count: number };
      const fts = verifyDb.prepare("select count(*) as count from chunk_fts").get() as { count: number };
      expect(fts.count).toBe(chunks.count);
    } finally {
      verifyDb.close();
    }
  });

  it("persists symbols, dependencies, and reverse imports", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(
      path.join(tempDir, "src", "helper.ts"),
      "export function helper() {\n  return 1;\n}\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "service.ts"),
      'import { helper } from "./helper";\nexport class Service {\n  value = helper();\n}\n',
    );

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    expect(metadata.stats.symbols).toBe(2);
    expect(metadata.stats.dependencies).toBe(1);

    const helperRelations = readRelatedFiles({
      dbPath: metadata.dbPath,
      filePath: "src/helper.ts",
      maxResults: 10,
    });
    const serviceRelations = readRelatedFiles({
      dbPath: metadata.dbPath,
      filePath: "src/service.ts",
      maxResults: 10,
    });

    expect(helperRelations.symbols).toEqual([
      expect.objectContaining({ name: "helper", kind: "function", exported: true }),
    ]);
    expect(helperRelations.importedBy).toEqual([
      expect.objectContaining({ path: "src/service.ts", specifier: "./helper" }),
    ]);
    expect(serviceRelations.imports).toEqual([
      expect.objectContaining({ specifier: "./helper", resolvedPath: "src/helper.ts" }),
    ]);
  });

  it("reads a bounded multi-hop related file graph", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "controller.ts"), 'import { service } from "./service";\nservice();\n');
    await fs.writeFile(path.join(tempDir, "src", "service.ts"), 'import { repo } from "./repo";\nexport function service() { repo(); }\n');
    await fs.writeFile(path.join(tempDir, "src", "repo.ts"), "export function repo() {}\n");

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/controller.ts"],
      maxDepth: 2,
      maxFiles: 10,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => ({ path: node.path, depth: node.depth, via: node.via }))).toEqual([
      { path: "src/controller.ts", depth: 0, via: null },
      { path: "src/service.ts", depth: 1, via: "src/controller.ts" },
      { path: "src/repo.ts", depth: 2, via: "src/service.ts" },
    ]);
  });

  it("prioritizes source neighbors before tests in related traversal", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "service.ts"), "export function service() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "controller.ts"), 'import { service } from "./service";\nservice();\n');
    await fs.writeFile(path.join(tempDir, "src", "service.test.ts"), 'import { service } from "./service";\nservice();\n');

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/service.ts"],
      maxDepth: 1,
      maxFiles: 3,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => node.path)).toEqual(["src/service.ts", "src/controller.ts", "src/service.test.ts"]);
  });

  it("prioritizes source files globally across queued traversal branches", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "root.ts"), 'import { a } from "./a";\nimport { b } from "./b";\na(); b();\n');
    await fs.writeFile(path.join(tempDir, "src", "a.ts"), "export function a() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "b.ts"), "export function b() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "a.test.ts"), 'import { a } from "./a";\na();\n');
    await fs.writeFile(path.join(tempDir, "src", "b-helper.ts"), 'import { b } from "./b";\nexport function helper() { b(); }\n');

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/root.ts"],
      maxDepth: 2,
      maxFiles: 5,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => node.path)).toEqual([
      "src/root.ts",
      "src/a.ts",
      "src/b.ts",
      "src/b-helper.ts",
      "src/a.test.ts",
    ]);
  });
});

describe("related path classification", () => {
  it("classifies common support file roles", () => {
    expect(classifyRelatedPath("src/service.ts")).toBe("source");
    expect(classifyRelatedPath("src/service.test.ts")).toBe("test");
    expect(classifyRelatedPath("src/__mocks__/service.ts")).toBe("mock");
    expect(classifyRelatedPath("fixtures/user.json")).toBe("fixture");
    expect(classifyRelatedPath("src/generated/client.ts")).toBe("generated");
    expect(classifyRelatedPath("docs/usage.md")).toBe("docs");
  });
});
