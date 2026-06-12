import type { IndexingLimits } from "./types.js";

export const DEFAULT_INDEXING_LIMITS: IndexingLimits = {
  maxFileBytes: 512 * 1024,
  targetChunkChars: 4_000,
  chunkOverlapChars: 400,
  maxChunksPerFile: 80,
};

