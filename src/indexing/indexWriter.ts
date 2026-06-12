import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { chunkText } from "./chunker.js";
import { resolveIndexingLimits } from "./dryRun.js";
import { sha256Hex } from "./hash.js";
import { scanProject } from "./scanner.js";
import type { IndexingLimits, ReindexDryRunOptions, SkippedFile } from "./types.js";
import { initializeStorageSchema, insertChunk, upsertFile } from "../storage/schema.js";

export interface PersistentReindexOptions extends ReindexDryRunOptions {
  indexDirName: string;
  vectorDimensions: number;
}

export interface PersistentReindexResult {
  projectPath: string;
  dryRun: false;
  status: "metadata_indexed";
  dbPath: string;
  limits: IndexingLimits;
  stats: {
    scannedFiles: number;
    indexedFiles: number;
    skippedFiles: number;
    chunks: number;
    bytes: number;
  };
  skipped: SkippedFile[];
}

export async function persistentReindexMetadata(options: PersistentReindexOptions): Promise<PersistentReindexResult> {
  const projectPath = path.resolve(options.projectPath);
  const limits = resolveIndexingLimits(options);
  const indexPath = path.join(projectPath, options.indexDirName);
  const dbPath = path.join(indexPath, "index.sqlite");
  await fs.mkdir(indexPath, { recursive: true });

  const scan = await scanProject(projectPath, limits);
  const db = new Database(dbPath);
  let chunkCount = 0;
  let byteCount = 0;

  try {
    initializeStorageSchema(db, { vectorDimensions: options.vectorDimensions });
    const writeFileChunks = db.transaction((input: { relativePath: string; size: number; mtimeMs: number; hash: string; chunks: Array<{ startLine: number; endLine: number; text: string; hash: string }> }) => {
      const existing = db
        .prepare("select id, hash from files where project_path = ? and path = ?")
        .get(projectPath, input.relativePath) as { id: number; hash: string } | undefined;
      const fileId = upsertFile(db, {
        projectPath,
        path: input.relativePath,
        mtimeMs: input.mtimeMs,
        size: input.size,
        hash: input.hash,
      });
      if (existing?.hash === input.hash) {
        return;
      }

      db.prepare("delete from chunks where file_id = ?").run(fileId);
      for (const chunk of input.chunks) {
        insertChunk(db, {
          fileId,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          text: chunk.text,
          hash: chunk.hash,
        });
      }
    });

    for (const file of scan.files) {
      const content = await fs.readFile(file.absolutePath, "utf8");
      const chunks = chunkText(file.relativePath, content, limits);
      writeFileChunks({
        relativePath: file.relativePath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: sha256Hex(content),
        chunks,
      });
      chunkCount += chunks.length;
      byteCount += file.size;
    }

    const activePaths = scan.files.map((file) => file.relativePath);
    if (activePaths.length === 0) {
      db.prepare("delete from files where project_path = ?").run(projectPath);
    } else {
      const placeholders = activePaths.map(() => "?").join(", ");
      db.prepare(`delete from files where project_path = ? and path not in (${placeholders})`).run(projectPath, ...activePaths);
    }
  } finally {
    db.close();
  }

  return {
    projectPath,
    dryRun: false,
    status: "metadata_indexed",
    dbPath,
    limits,
    stats: {
      scannedFiles: scan.files.length + scan.skipped.length,
      indexedFiles: scan.files.length,
      skippedFiles: scan.skipped.length,
      chunks: chunkCount,
      bytes: byteCount,
    },
    skipped: scan.skipped,
  };
}
