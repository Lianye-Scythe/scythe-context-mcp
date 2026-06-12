import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexMissingEmbeddings } from "./embeddingWriter.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "../providers/types.js";

class FakeEmbeddingProvider implements EmbeddingProvider {
  batchCalls = 0;
  singleCalls = 0;

  constructor(
    private readonly dimensions: number,
    private readonly failBatch = false,
  ) {}

  async embed(input: EmbeddingRequest): Promise<EmbeddingResult> {
    this.singleCalls += 1;
    return this.result(input.text);
  }

  async embedBatch(inputs: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    this.batchCalls += 1;
    if (this.failBatch) {
      throw new Error("batch unsupported");
    }
    return inputs.map((input) => this.result(input.text));
  }

  private result(seed: string): EmbeddingResult {
    const value = (seed.length % 10) / 10;
    return {
      model: "fake",
      dimensions: this.dimensions,
      vector: new Array(this.dimensions).fill(value),
    };
  }
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-embeddings-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createMetadataIndex() {
  await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(tempDir, "b.ts"), "export const b = 2;\n");
  return persistentReindexMetadata({
    projectPath: tempDir,
    indexDirName: ".repo-beacon",
    vectorDimensions: 1536,
    maxFileBytes: 1024,
    targetChunkChars: 10,
    chunkOverlapChars: 0,
    maxChunksPerFile: 10,
  });
}

describe("indexMissingEmbeddings", () => {
  it("embeds pending chunks and skips them on the next run", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);

    const first = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 2,
      provider,
    });
    const second = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 2,
      provider,
    });

    expect(first.stats.pendingChunks).toBeGreaterThan(0);
    expect(first.stats.embeddedChunks).toBe(first.stats.pendingChunks);
    expect(second.stats.pendingChunks).toBe(0);
    expect(second.stats.embeddedChunks).toBe(0);

    const db = new Database(metadata.dbPath);
    try {
      const counts = Object.fromEntries(
        ["embedding_sets", "embeddings"].map((table) => [
          table,
          (db.prepare(`select count(*) as count from ${table}`).get() as { count: number }).count,
        ]),
      );
      expect(counts.embedding_sets).toBe(1);
      expect(counts.embeddings).toBe(first.stats.embeddedChunks);
    } finally {
      db.close();
    }
  });

  it("falls back to single embedding calls when batch fails", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536, true);

    const result = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 3,
      provider,
    });

    expect(result.stats.batchFallbacks).toBeGreaterThan(0);
    expect(provider.batchCalls).toBeGreaterThan(0);
    expect(provider.singleCalls).toBe(result.stats.embeddedChunks);
  });

  it("limits embedding work when maxChunks is set", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);

    const result = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 10,
      maxChunks: 1,
      provider,
    });

    expect(result.stats.pendingChunks).toBe(1);
    expect(result.stats.embeddedChunks).toBe(1);
  });

  it("fails fast when provider dimensions do not match the embedding set", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(768);

    await expect(
      indexMissingEmbeddings({
        dbPath: metadata.dbPath,
        providerName: "fake",
        providerBaseUrl: "memory://fake",
        model: "fake-embedding",
        dimensions: 1536,
        batchSize: 2,
        provider,
      }),
    ).rejects.toThrow(/dimensions mismatch/);
  });
});
