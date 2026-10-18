import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexMissingEmbeddings } from "./embeddingWriter.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import { searchByVector } from "./semanticSearch.js";
import { sha256Hex } from "./hash.js";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "../providers/types.js";

class ContentAwareProvider implements EmbeddingProvider {
  async embed(input: EmbeddingRequest): Promise<EmbeddingResult> {
    return this.result(input.text);
  }

  async embedBatch(inputs: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    return inputs.map((input) => this.result(input.text));
  }

  private result(text: string): EmbeddingResult {
    const first = text.includes("payment") ? 1 : 0;
    const second = text.includes("user") ? 1 : 0;
    return {
      model: "fake",
      dimensions: 4,
      vector: [first, second, 0, 0],
    };
  }
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-search-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("searchByVector", () => {
  it.each(["model", "endpoint"])("isolates %s changes before selecting the nearest candidates", async (change) => {
    await fs.writeFile(path.join(tempDir, "a.ts"), "export const payment = true;\n");
    await fs.writeFile(path.join(tempDir, "b.ts"), "export const user = true;\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 4,
      maxFileBytes: 1024, targetChunkChars: 100, chunkOverlapChars: 0, maxChunksPerFile: 10,
    });
    const common = { dbPath: metadata.dbPath, providerName: "fake", dimensions: 4, batchSize: 10 };
    await indexMissingEmbeddings({ ...common, providerBaseUrl: "memory://old", model: "old", provider: new ContentAwareProvider() });
    const baseUrl = change === "endpoint" ? "memory://new" : "memory://old";
    const model = change === "model" ? "new" : "old";
    const provider: EmbeddingProvider = {
      embed: async () => ({ model, dimensions: 4, vector: [0, 0, 1, 0] }),
      embedBatch: async (inputs) => inputs.map(() => ({ model, dimensions: 4, vector: [0, 0, 1, 0] })),
    };
    await indexMissingEmbeddings({ ...common, providerBaseUrl: baseUrl, model, provider, maxChunks: 1 });
    const results = searchByVector({
      dbPath: metadata.dbPath, dimensions: 4, queryVector: [0, 1, 0, 0], maxResults: 1, maxSnippetChars: 100,
      embeddingSet: { provider: "fake", baseUrlHash: sha256Hex(baseUrl), model, dimensions: 4 },
    });
    expect(results.map((result) => result.path)).toEqual(["a.ts"]);
  });

  it("returns nearest chunks with file ranges and snippets", async () => {
    await fs.writeFile(path.join(tempDir, "payment.ts"), "export function paymentFlow() { return 'payment'; }\n");
    await fs.writeFile(path.join(tempDir, "user.ts"), "export function userFlow() { return 'user'; }\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 4,
      maxFileBytes: 1024,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });
    await indexMissingEmbeddings({
      dbPath: metadata.dbPath,
      providerName: "fake",
      providerBaseUrl: "memory://fake",
      model: "fake",
      dimensions: 4,
      batchSize: 10,
      provider: new ContentAwareProvider(),
    });

    const results = searchByVector({
      dbPath: metadata.dbPath,
      dimensions: 4,
      queryVector: [1, 0, 0, 0],
      maxResults: 2,
      maxSnippetChars: 24,
      embeddingSet: { provider: "fake", baseUrlHash: sha256Hex("memory://fake"), model: "fake", dimensions: 4 },
    });

    expect(results[0]).toEqual(
      expect.objectContaining({
        path: "payment.ts",
        startLine: 1,
        endLine: 1,
        matchType: "semantic",
      }),
    );
    expect(results[0].snippet.length).toBeLessThanOrEqual(24);
    expect(results[0].distance).toBeLessThanOrEqual(results[1].distance);
  });
});
