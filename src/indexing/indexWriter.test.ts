import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkText } from "./chunker.js";
import { regexStructureExtractor } from "./structureExtractor.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import { classifyRelatedPath, readRelatedFileGraph, readRelatedFiles } from "./relatedFiles.js";
import { readRelatedSnippets } from "./relatedSnippets.js";
import { vectorTableName } from "../storage/schema.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-writer-"));
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 8,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    await fs.writeFile(filePath, "changed\n");
    const second = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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
      indexDirName: ".scythe-context",
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

describe("incremental chunk reuse", () => {
  const options = () => ({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3 });
  const rows = (dbPath: string, sql: string) => {
    const db = new Database(dbPath);
    try { return db.prepare(sql).all(); } finally { db.close(); }
  };

  it("skips unchanged chunking while still refreshing structure and newly resolvable imports", async () => {
    await fs.writeFile(path.join(tempDir, "main.ts"), 'import { optional } from "./optional";\nexport const main = 1;\n');
    let chunkCalls = 0;
    let parserCalls = 0;
    const extractor = { ...regexStructureExtractor, chunkCacheKey: "test-v1",
      chunkText: (...args: Parameters<typeof chunkText>) => { chunkCalls++; return chunkText(...args); },
      extractFileGraph: (...args: Parameters<typeof regexStructureExtractor.extractFileGraph>) => { parserCalls++; return regexStructureExtractor.extractFileGraph(...args); },
    };
    const first = await persistentReindexMetadata({ ...options(), structureExtractor: extractor });
    const original = rows(first.dbPath, "select id, hash from chunks");
    const second = await persistentReindexMetadata({ ...options(), structureExtractor: extractor });
    expect(second.stats).toMatchObject({ chunkedFiles: 0, reusedChunkFiles: 1, repairedFtsRows: 0 });
    expect(chunkCalls).toBe(1);
    expect(parserCalls).toBe(2);
    expect(second.stats.chunks).toBe(first.stats.chunks);
    expect(rows(first.dbPath, "select id, hash from chunks")).toEqual(original);
    await fs.writeFile(path.join(tempDir, "optional.ts"), "export const optional = true;\n");
    const third = await persistentReindexMetadata({ ...options(), structureExtractor: extractor });
    expect(third.stats).toMatchObject({ chunkedFiles: 1, reusedChunkFiles: 1 });
    expect(readRelatedFiles({ dbPath: first.dbPath, filePath: "main.ts", maxResults: 10 }).imports[0].resolvedPath).toBe("optional.ts");
  });

  it("repairs only missing FTS rows while preserving unchanged chunks and embedding records", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "one\ntwo\nthree\nfour\n");
    const config = { ...options(), targetChunkChars: 5, chunkOverlapChars: 0 };
    const first = await persistentReindexMetadata(config);
    const original = rows(first.dbPath, "select id, hash from chunks order by id");
    expect(original.length).toBeGreaterThan(1);
    const db = new Database(first.dbPath);
    try {
      db.prepare("delete from chunk_fts where rowid = (select min(id) from chunks)").run();
      db.exec("insert into embedding_sets(provider, base_url_hash, model, dimensions) values ('test', 'local', 'test', 3)");
      db.exec("insert into embeddings(chunk_id, embedding_set_id) select min(id), 1 from chunks");
    } finally { db.close(); }
    const second = await persistentReindexMetadata(config);
    expect(second.stats).toMatchObject({ chunkedFiles: 0, reusedChunkFiles: 1, repairedFtsRows: 1 });
    expect(rows(first.dbPath, "select id, hash from chunks order by id")).toEqual(original);
    expect(rows(first.dbPath, "select count(*) as count from embeddings")).toEqual([{ count: 1 }]);
    expect(rows(first.dbPath, "select count(*) as count from chunk_fts")).toEqual([{ count: original.length }]);
  });

  it("rechunks unchanged text when settings change", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "one\ntwo\nthree\nfour\nfive\n");
    await persistentReindexMetadata({ ...options(), targetChunkChars: 100, chunkOverlapChars: 0 });
    const second = await persistentReindexMetadata({ ...options(), targetChunkChars: 5, chunkOverlapChars: 0 });
    expect(second.stats.chunkedFiles).toBe(1);
    expect(second.stats.chunks).toBeGreaterThan(1);
    expect(rows(second.dbPath, "select text from chunks order by start_line")).toEqual(chunkText("a.ts", "one\ntwo\nthree\nfour\nfive\n", { targetChunkChars: 5, chunkOverlapChars: 0, maxChunksPerFile: 80 }).map(({ text }) => ({ text })));
    const third = await persistentReindexMetadata({ ...options(), targetChunkChars: 5, chunkOverlapChars: 0, maxChunksPerFile: 1 });
    expect(third.stats.chunks).toBe(1);
    expect(third.stats.chunkedFiles).toBe(1);
  });

  it("detects changed content even when size and mtime are preserved", async () => {
    const file = path.join(tempDir, "a.ts");
    await fs.writeFile(file, "before\n");
    const first = await persistentReindexMetadata(options());
    const stat = await fs.stat(file);
    await fs.writeFile(file, "after!\n");
    await fs.utimes(file, stat.atime, stat.mtime);
    const second = await persistentReindexMetadata(options());
    expect(second.stats.chunkedFiles).toBe(1);
    expect(rows(first.dbPath, "select text from chunks")).toEqual([{ text: "after!\n" }]);
  });

  it("recovers per-file settings after an interrupted reindex", async () => {
    const content = "one\ntwo\nthree\nfour\n";
    await fs.writeFile(path.join(tempDir, "a.ts"), content);
    await fs.writeFile(path.join(tempDir, "b.ts"), content);
    await persistentReindexMetadata({ ...options(), targetChunkChars: 100, chunkOverlapChars: 0 });
    const broken = { ...regexStructureExtractor,
      chunkText: (file: string, text: string, limits: Parameters<typeof chunkText>[2]) => {
        if (file === "b.ts") throw new Error("interrupted");
        return chunkText(file, text, limits);
      },
    };
    await expect(persistentReindexMetadata({ ...options(), targetChunkChars: 5, chunkOverlapChars: 0, structureExtractor: broken })).rejects.toThrow("interrupted");
    const recovered = await persistentReindexMetadata({ ...options(), targetChunkChars: 5, chunkOverlapChars: 0 });
    expect(recovered.stats).toMatchObject({ chunkedFiles: 1, reusedChunkFiles: 1 });
    expect(recovered.stats.chunks).toBe(chunkText("a.ts", content, { targetChunkChars: 5, chunkOverlapChars: 0, maxChunksPerFile: 80 }).length * 2);
  });

  it("warms legacy caches without discarding equivalent chunks", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const stable = 1;\n");
    const first = await persistentReindexMetadata(options());
    const original = rows(first.dbPath, "select id, hash from chunks");
    const db = new Database(first.dbPath);
    try { db.exec("drop table file_chunking; delete from schema_migrations where version = 3"); } finally { db.close(); }
    const second = await persistentReindexMetadata(options());
    expect(second.stats).toMatchObject({ chunkedFiles: 1, reusedChunkFiles: 1 });
    expect(rows(first.dbPath, "select id, hash from chunks")).toEqual(original);
    expect((await persistentReindexMetadata(options())).stats.chunkedFiles).toBe(0);
  });

  it("recomputes unkeyed custom chunkers and invalidates the previous chunker identity", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "original\n");
    await persistentReindexMetadata(options());
    let suffix = "first";
    const custom = { ...regexStructureExtractor, chunkCacheKey: undefined,
      chunkText: (file: string, content: string, limits: Parameters<typeof chunkText>[2]) => chunkText(file, content + suffix, limits),
    };
    await persistentReindexMetadata({ ...options(), structureExtractor: custom });
    suffix = "second";
    const changed = await persistentReindexMetadata({ ...options(), structureExtractor: custom });
    expect(changed.stats.chunkedFiles).toBe(1);
    expect(rows(changed.dbPath, "select text from chunks")).toEqual([{ text: "original\nsecond" }]);
    const restored = await persistentReindexMetadata(options());
    expect(restored.stats.chunkedFiles).toBe(1);
    expect(rows(changed.dbPath, "select text from chunks")).toEqual([{ text: "original\n" }]);
  });

  it("removes deleted files from FTS and the per-file chunking cache", async () => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "keep\n");
    await fs.writeFile(path.join(tempDir, "b.ts"), "remove\n");
    const first = await persistentReindexMetadata(options());
    await fs.rm(path.join(tempDir, "b.ts"));
    const second = await persistentReindexMetadata(options());
    expect(rows(first.dbPath, "select count(*) as count from chunk_fts")).toEqual([{ count: second.stats.chunks }]);
    expect(rows(first.dbPath, "select count(*) as count from file_chunking")).toEqual([{ count: 1 }]);
  });
});

describe("related path classification", () => {
  it.each(["src/token_test.go", "src/test_token.py", "src/token_test.py"])("classifies language test files: %s", (file) => {
    expect(classifyRelatedPath(file)).toBe("test");
  });

  it("classifies common support file roles", () => {
    expect(classifyRelatedPath("src/service.ts")).toBe("source");
    expect(classifyRelatedPath("src/service.test.ts")).toBe("test");
    expect(classifyRelatedPath("src/__mocks__/service.ts")).toBe("mock");
    expect(classifyRelatedPath("fixtures/user.json")).toBe("fixture");
    expect(classifyRelatedPath("src/generated/client.ts")).toBe("generated");
    expect(classifyRelatedPath("docs/usage.md")).toBe("docs");
  });
});
