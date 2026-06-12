import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  getOrCreateEmbeddingSet,
  initializeStorageSchema,
  insertChunk,
  upsertFile,
  vectorTableName,
} from "./schema.js";
import { vectorToFloat32Buffer } from "./sqliteVec.js";

describe("storage schema", () => {
  it("initializes metadata tables and a dimension-specific sqlite-vec table", () => {
    const db = new Database(":memory:");
    try {
      initializeStorageSchema(db, { vectorDimensions: 1536 });

      const tables = db
        .prepare("select name from sqlite_master where type in ('table', 'virtual table') order by name")
        .all() as Array<{ name: string }>;

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          "chunks",
          "embedding_sets",
          "embeddings",
          "files",
          "schema_migrations",
          "vec_embeddings_1536",
        ]),
      );
    } finally {
      db.close();
    }
  });

  it("upserts files, inserts chunks, and separates embedding sets by dimensions", () => {
    const db = new Database(":memory:");
    try {
      initializeStorageSchema(db, { vectorDimensions: 1536 });
      const fileId = upsertFile(db, {
        projectPath: "/repo",
        path: "src/a.ts",
        mtimeMs: 1,
        size: 12,
        hash: "filehash",
      });
      const updatedFileId = upsertFile(db, {
        projectPath: "/repo",
        path: "src/a.ts",
        mtimeMs: 2,
        size: 13,
        hash: "filehash2",
      });
      const chunkId = insertChunk(db, {
        fileId,
        path: "src/a.ts",
        startLine: 1,
        endLine: 2,
        text: "hello",
        hash: "chunkhash",
      });
      const duplicateChunkId = insertChunk(db, {
        fileId,
        path: "src/a.ts",
        startLine: 1,
        endLine: 2,
        text: "hello",
        hash: "chunkhash",
      });
      const embeddingSet1536 = getOrCreateEmbeddingSet(db, {
        provider: "gemini",
        baseUrlHash: "abc",
        model: "gemini-embedding-2",
        dimensions: 1536,
      });
      const embeddingSet768 = getOrCreateEmbeddingSet(db, {
        provider: "gemini",
        baseUrlHash: "abc",
        model: "gemini-embedding-2",
        dimensions: 768,
      });

      expect(updatedFileId).toBe(fileId);
      expect(duplicateChunkId).toBe(chunkId);
      expect(embeddingSet768).not.toBe(embeddingSet1536);
    } finally {
      db.close();
    }
  });

  it("can link embedding metadata to sqlite-vec rows by embedding id", () => {
    const db = new Database(":memory:");
    try {
      initializeStorageSchema(db, { vectorDimensions: 1536 });
      const fileId = upsertFile(db, {
        projectPath: "/repo",
        path: "src/a.ts",
        mtimeMs: 1,
        size: 12,
        hash: "filehash",
      });
      const chunkId = insertChunk(db, {
        fileId,
        path: "src/a.ts",
        startLine: 1,
        endLine: 2,
        text: "hello",
        hash: "chunkhash",
      });
      const embeddingSetId = getOrCreateEmbeddingSet(db, {
        provider: "gemini",
        baseUrlHash: "abc",
        model: "gemini-embedding-2",
        dimensions: 1536,
      });

      const embeddingInfo = db
        .prepare("insert into embeddings(chunk_id, embedding_set_id) values (?, ?) returning id")
        .get(chunkId, embeddingSetId) as { id: number };
      db.prepare(`insert into ${vectorTableName(1536)}(rowid, embedding) values (?, ?)`).run(
        BigInt(embeddingInfo.id),
        vectorToFloat32Buffer(new Array(1536).fill(0.1), 1536),
      );

      const rows = db
        .prepare(`select rowid, distance from ${vectorTableName(1536)} where embedding match ? order by distance limit 1`)
        .all(vectorToFloat32Buffer(new Array(1536).fill(0.1), 1536)) as Array<{ rowid: number; distance: number }>;

      expect(rows).toHaveLength(1);
      expect(rows[0].rowid).toBe(embeddingInfo.id);
      expect(rows[0].distance).toBe(0);
    } finally {
      db.close();
    }
  });
});
