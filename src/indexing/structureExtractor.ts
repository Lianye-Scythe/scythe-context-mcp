import { chunkText } from "./chunker.js";
import { extractFileGraph } from "./symbolGraph.js";
import type { ExtractedFileGraph } from "./symbolGraph.js";
import type { IndexingLimits, TextChunk } from "./types.js";

export interface CodeStructureExtractor {
  name: string;
  /** Stable identity/version of a deterministic chunker. Omit to recompute on every reindex. */
  chunkCacheKey?: string;
  extractFileGraph(relativePath: string, content: string): ExtractedFileGraph;
  chunkText?(
    relativePath: string,
    content: string,
    limits: Pick<IndexingLimits, "targetChunkChars" | "chunkOverlapChars" | "maxChunksPerFile">,
  ): TextChunk[];
}

export const regexStructureExtractor: CodeStructureExtractor = {
  name: "regex",
  chunkCacheKey: "text-v1",
  extractFileGraph,
  chunkText,
};

