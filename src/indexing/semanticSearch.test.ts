import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexMissingEmbeddings } from "./embeddingWriter.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import { searchByVector } from "./semanticSearch.js";
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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "repo-beacon-search-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("searchByVector", () => {
  it("returns nearest chunks with file ranges and snippets", async () => {
    await fs.writeFile(path.join(tempDir, "payment.ts"), "export function paymentFlow() { return 'payment'; }\n");
    await fs.writeFile(path.join(tempDir, "user.ts"), "export function userFlow() { return 'user'; }\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".repo-beacon",
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
