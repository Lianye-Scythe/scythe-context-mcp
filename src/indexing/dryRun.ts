import fs from "node:fs/promises";
import path from "node:path";
import { chunkText } from "./chunker.js";
import { DEFAULT_INDEXING_LIMITS } from "./defaults.js";
import { sha256Hex } from "./hash.js";
import { scanProject } from "./scanner.js";
import type { IndexingLimits, ReindexDryRunOptions, ReindexDryRunResult } from "./types.js";

export function resolveIndexingLimits(options: Partial<IndexingLimits>): IndexingLimits {
  return {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_INDEXING_LIMITS.maxFileBytes,
    targetChunkChars: options.targetChunkChars ?? DEFAULT_INDEXING_LIMITS.targetChunkChars,
    chunkOverlapChars: options.chunkOverlapChars ?? DEFAULT_INDEXING_LIMITS.chunkOverlapChars,
    maxChunksPerFile: options.maxChunksPerFile ?? DEFAULT_INDEXING_LIMITS.maxChunksPerFile,
  };
}

export async function reindexDryRun(options: ReindexDryRunOptions): Promise<ReindexDryRunResult> {
  const projectPath = path.resolve(options.projectPath);
  const limits = resolveIndexingLimits(options);
  const scan = await scanProject(projectPath, limits);
  const files: ReindexDryRunResult["files"] = [];
  let chunkCount = 0;
  let byteCount = 0;

  for (const file of scan.files) {
    const content = await fs.readFile(file.absolutePath, "utf8");
    const chunks = chunkText(file.relativePath, content, limits);
    chunkCount += chunks.length;
    byteCount += file.size;
    files.push({
      path: file.relativePath,
      size: file.size,
      hash: sha256Hex(content),
      chunks: chunks.length,
    });
  }

  return {
    projectPath,
    dryRun: true,
    limits,
    stats: {
      scannedFiles: scan.files.length + scan.skipped.length,
      indexedFiles: scan.files.length,
      skippedFiles: scan.skipped.length,
      chunks: chunkCount,
      bytes: byteCount,
    },
    files,
    skipped: scan.skipped,
  };
}
