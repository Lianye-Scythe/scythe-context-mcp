export interface IndexingLimits {
  maxFileBytes: number;
  targetChunkChars: number;
  chunkOverlapChars: number;
  maxChunksPerFile: number;
}

export interface FileCandidate {
  relativePath: string;
  absolutePath: string;
  size: number;
  mtimeMs: number;
}

export type SkipReason =
  | "ignored"
  | "too_large"
  | "binary"
  | "read_error"
  | "not_file"
  | "outside_project";

export interface SkippedFile {
  relativePath: string;
  reason: SkipReason;
  detail?: string;
  size?: number;
}

export interface ScanResult {
  projectPath: string;
  files: FileCandidate[];
  skipped: SkippedFile[];
}

export interface TextChunk {
  relativePath: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

export interface ReindexDryRunOptions extends Partial<IndexingLimits> {
  projectPath: string;
}

export interface ReindexDryRunResult {
  projectPath: string;
  dryRun: true;
  limits: IndexingLimits;
  stats: {
    scannedFiles: number;
    indexedFiles: number;
    skippedFiles: number;
    chunks: number;
    bytes: number;
  };
  files: Array<{
    path: string;
    size: number;
    hash: string;
    chunks: number;
  }>;
  skipped: SkippedFile[];
}
