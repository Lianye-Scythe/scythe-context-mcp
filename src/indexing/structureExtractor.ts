import { chunkText } from "./chunker.js";
import { extractFileGraph } from "./symbolGraph.js";
import type { ExtractedFileGraph } from "./symbolGraph.js";
import type { IndexingLimits, TextChunk } from "./types.js";

export interface CodeStructureExtractor {
  name: string;
  extractFileGraph(relativePath: string, content: string): ExtractedFileGraph;
  chunkText?(
    relativePath: string,
    content: string,
    limits: Pick<IndexingLimits, "targetChunkChars" | "chunkOverlapChars" | "maxChunksPerFile">,
  ): TextChunk[];
}

export const regexStructureExtractor: CodeStructureExtractor = {
  name: "regex",
  extractFileGraph,
  chunkText,
};

