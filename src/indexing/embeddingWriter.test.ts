import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingIndexError, indexMissingEmbeddings } from "./embeddingWriter.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingRequest, type EmbeddingResult } from "../providers/types.js";
import { initializeStorageSchema, vectorTableName } from "../storage/schema.js";

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
      throw new EmbeddingProviderError("batch unsupported", { status: 405, batchUnsupported: true });
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-embeddings-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function createMetadataIndex() {
  await fs.writeFile(path.join(tempDir, "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(tempDir, "b.ts"), "export const b = 2;\n");
  return persistentReindexMetadata({
    projectPath: tempDir,
    indexDirName: ".scythe-context",
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
    const updates: Array<{ batchEmbedding: string }> = [];

    const result = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 3,
      provider,
      onCapabilitiesUpdated: (update) => updates.push(update),
    });

    expect(result.stats.batchFallbacks).toBeGreaterThan(0);
    expect(provider.batchCalls).toBeGreaterThan(0);
    expect(provider.singleCalls).toBe(result.stats.embeddedChunks);
    expect(updates).toContainEqual({ batchEmbedding: "unsupported", batchEmbeddingVerified: true });
  });

  it("skips batch calls when cached capabilities mark batch embedding unsupported", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);
    const updates: Array<{ batchEmbedding: string }> = [];

    const result = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 3,
      provider,
      capabilities: { batchEmbedding: "unsupported", batchEmbeddingVerified: true },
      onCapabilitiesUpdated: (update) => updates.push(update),
    });

    expect(result.stats.batchFallbacks).toBeGreaterThan(0);
    expect(provider.batchCalls).toBe(0);
    expect(provider.singleCalls).toBe(result.stats.embeddedChunks);
    expect(updates).toEqual([]);
  });

  it("does not fan out or poison batch capability after a transient failure", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);
    const failure = new EmbeddingProviderError("rate limited", { status: 429, retryable: true });
    vi.spyOn(provider, "embedBatch").mockRejectedValue(failure);
    const updates = vi.fn();
    await expect(indexMissingEmbeddings({
      dbPath: metadata.dbPath, providerName: "fake", providerBaseUrl: "memory://fake",
      model: "fake", dimensions: 1536, batchSize: 2, provider, onCapabilitiesUpdated: updates,
    })).rejects.toMatchObject({ providerError: failure, progress: { embeddedChunks: 0 } });
    expect(provider.singleCalls).toBe(0);
    expect(updates).not.toHaveBeenCalled();
  });

  it("rechecks legacy unsupported records and remembers a verified fallback within the same run", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536, true);
    await indexMissingEmbeddings({
      dbPath: metadata.dbPath, providerName: "fake", providerBaseUrl: "memory://fake",
      model: "fake", dimensions: 1536, batchSize: 1, provider,
      capabilities: { batchEmbedding: "unsupported" },
    });
    expect(provider.batchCalls).toBe(1);
    expect(provider.singleCalls).toBeGreaterThan(1);
  });

  it("recovers batch support from an unverified legacy unsupported observation", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);
    const updates = vi.fn();
    await indexMissingEmbeddings({
      dbPath: metadata.dbPath, providerName: "fake", providerBaseUrl: "memory://fake",
      model: "fake", dimensions: 1536, batchSize: 3, provider,
      capabilities: { batchEmbedding: "unsupported" }, onCapabilitiesUpdated: updates,
    });
    expect(provider.batchCalls).toBeGreaterThan(0);
    expect(provider.singleCalls).toBe(0);
    expect(updates).toHaveBeenCalledWith({ batchEmbedding: "supported", batchEmbeddingVerified: true });
  });

  it("saves successful single vectors before interruption and resumes without repeating them", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536, true);
    const embed = provider.embed.bind(provider);
    const single = vi.spyOn(provider, "embed").mockImplementationOnce(embed).mockRejectedValueOnce(new Error("interrupted"));
    const options = {
      dbPath: metadata.dbPath, providerName: "fake", providerBaseUrl: "memory://fake",
      model: "fake", dimensions: 1536, batchSize: 3, provider,
    };
    let failure: EmbeddingIndexError | undefined;
    try { await indexMissingEmbeddings(options); } catch (error) { failure = error as EmbeddingIndexError; }
    expect(failure).toBeInstanceOf(EmbeddingIndexError);
    expect(failure?.progress.embeddedChunks).toBe(1);
    single.mockImplementation(embed);
    const resumed = await indexMissingEmbeddings(options);
    expect(resumed.stats.embeddedChunks).toBe((failure?.progress.pendingChunks ?? 0) - 1);
  });

  it("does not declare batch unsupported when individual requests also fail", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536, true);
    vi.spyOn(provider, "embed").mockRejectedValue(new EmbeddingProviderError("model missing", { status: 404 }));
    const updates = vi.fn();
    await expect(indexMissingEmbeddings({
      dbPath: metadata.dbPath, providerName: "fake", providerBaseUrl: "memory://fake",
      model: "fake", dimensions: 1536, batchSize: 2, provider, onCapabilitiesUpdated: updates,
    })).rejects.toThrow("model missing");
    expect(updates).not.toHaveBeenCalled();
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

  it("overwrites a stale vector row when an embedding id is reused", async () => {
    const metadata = await createMetadataIndex();
    const provider = new FakeEmbeddingProvider(1536);

    const first = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 2,
      maxChunks: 1,
      provider,
    });

    const db = new Database(metadata.dbPath);
    try {
      initializeStorageSchema(db, { vectorDimensions: 1536 });
      const row = db.prepare("select id from embeddings order by id limit 1").get() as { id: number };
      db.prepare("delete from embeddings where id = ?").run(row.id);
      expect(
        (db.prepare(`select count(*) as count from ${vectorTableName(1536)} where rowid = ?`).get(row.id) as { count: number }).count,
      ).toBe(1);
    } finally {
      db.close();
    }

    const second = await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake-embedding",
      dimensions: 1536,
      batchSize: 2,
      maxChunks: 1,
      provider,
    });

    expect(first.stats.embeddedChunks).toBe(1);
    expect(second.stats.embeddedChunks).toBe(1);
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
