import { describe, expect, it } from "vitest";
import { chunkText } from "./chunker.js";

describe("chunkText", () => {
  it("keeps hashes stable for identical input", () => {
    const limits = { targetChunkChars: 20, chunkOverlapChars: 5, maxChunksPerFile: 10 };
    const first = chunkText("src/a.ts", "one\ntwo\nthree\nfour\n", limits);
    const second = chunkText("src/a.ts", "one\ntwo\nthree\nfour\n", limits);

    expect(first.map((chunk) => chunk.hash)).toEqual(second.map((chunk) => chunk.hash));
  });

  it("splits long single-line text without creating an oversized chunk", () => {
    const chunks = chunkText("large.html", "a".repeat(10_000), {
      targetChunkChars: 1_000,
      chunkOverlapChars: 100,
      maxChunksPerFile: 20,
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.text.length))).toBeLessThanOrEqual(1_000);
  });

  it("honors maxChunksPerFile", () => {
    const chunks = chunkText("large.ts", "line\n".repeat(10_000), {
      targetChunkChars: 200,
      chunkOverlapChars: 20,
      maxChunksPerFile: 3,
    });

    expect(chunks).toHaveLength(3);
  });
});

