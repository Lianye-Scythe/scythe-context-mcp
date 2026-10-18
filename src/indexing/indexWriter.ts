import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { chunkText } from "./chunker.js";
import { resolveIndexingLimits } from "./dryRun.js";
import { sha256Hex } from "./hash.js";
import { scanProject } from "./scanner.js";
import { regexStructureExtractor } from "./structureExtractor.js";
import { createDependencyResolver } from "./dependencyResolver.js";
import type { CodeStructureExtractor } from "./structureExtractor.js";
import type { IndexingLimits, ReindexDryRunOptions, SkippedFile } from "./types.js";
import {
  deleteChunksForFile,
  initializeStorageSchema,
  insertChunk,
  replaceSymbolGraphForFile,
  upsertFile,
} from "../storage/schema.js";

export interface PersistentReindexOptions extends ReindexDryRunOptions {
  indexDirName: string;
  vectorDimensions: number;
  structureExtractor?: CodeStructureExtractor;
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
    symbols: number;
    dependencies: number;
    chunkedFiles: number;
    reusedChunkFiles: number;
    repairedFtsRows: number;
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
  const activePathSet = new Set(scan.files.map((file) => file.relativePath));
  const resolutionSources = new Map(await Promise.all(scan.files
    .filter((file) => /(?:^|\/)(?:go\.mod|lib\.rs|main\.rs)$/.test(file.relativePath))
    .map(async (file) => [file.relativePath, await fs.readFile(file.absolutePath, "utf8")] as const)));
  const resolveDependencies = createDependencyResolver(activePathSet, resolutionSources);
  const db = new Database(dbPath);
  const structureExtractor = options.structureExtractor ?? regexStructureExtractor;
  const structureChunker = structureExtractor.chunkText ?? chunkText;
  const chunkerKey = structureExtractor.chunkText ? structureExtractor.chunkCacheKey : regexStructureExtractor.chunkCacheKey;
  const cacheKey = chunkerKey ? JSON.stringify([chunkerKey, limits.targetChunkChars, limits.chunkOverlapChars, limits.maxChunksPerFile]) : null;
  let chunkedFiles = 0;
  let reusedChunkFiles = 0;
  let repairedFtsRows = 0;
  let chunkCount = 0;
  let byteCount = 0;
  let symbolCount = 0;
  let dependencyCount = 0;

  try {
    initializeStorageSchema(db, { vectorDimensions: options.vectorDimensions });
    const readExisting = db.prepare(`
      select files.id, files.hash, file_chunking.cache_key as cacheKey,
             (select count(*) from chunks where file_id = files.id) as chunkCount
      from files left join file_chunking on file_chunking.file_id = files.id
      where project_path = ? and path = ?
    `);
    const readChunks = db.prepare("select start_line as startLine, end_line as endLine, hash, text from chunks where file_id = ? order by start_line, end_line, id");
    const rememberChunking = db.prepare("insert into file_chunking(file_id, cache_key) values (?, ?) on conflict(file_id) do update set cache_key = excluded.cache_key");
    const forgetChunking = db.prepare("delete from file_chunking where file_id = ?");
    // Repair missing search rows without rewriting healthy FTS content on every reindex.
    const repairFts = db.prepare(`
      insert into chunk_fts(rowid, path, title, text)
      select chunks.id, ?, coalesce(chunks.title, ''), chunks.text from chunks
      where file_id = ? and not exists (select 1 from chunk_fts where rowid = chunks.id)
    `);
    const writeFileMetadata = db.transaction(
      (input: {
        relativePath: string;
        size: number;
        mtimeMs: number;
        hash: string;
        content: string;
      }) => {
        const existing = readExisting.get(projectPath, input.relativePath) as { id: number; hash: string; cacheKey: string | null; chunkCount: number } | undefined;
        const fileId = upsertFile(db, {
          projectPath,
          path: input.relativePath,
          mtimeMs: input.mtimeMs,
          size: input.size,
          hash: input.hash,
        });

        const graph = structureExtractor.extractFileGraph(input.relativePath, input.content);
        const dependencies = graph.dependencies.flatMap((dependency) => {
          const paths = resolveDependencies(input.relativePath, dependency);
          return (paths.length ? paths : [null]).map((resolvedPath) => ({
            fileId, specifier: dependency.specifier, line: dependency.line, resolvedPath,
          }));
        });
        replaceSymbolGraphForFile(
          db,
          fileId,
          graph.symbols.map((symbol) => ({ fileId, ...symbol })),
          dependencies,
        );

        const unchanged = existing?.hash === input.hash;
        let chunksForFile = existing?.chunkCount ?? 0;
        let reuse = unchanged && cacheKey !== null && existing?.cacheKey === cacheKey;
        if (!reuse) {
          const chunks = structureChunker(input.relativePath, input.content, limits);
          chunkedFiles++;
          chunksForFile = chunks.length;
          // Old indexes and custom chunkers have no reusable key. Compare layouts so a
          // migration or a settings change need not discard equivalent chunks/embeddings.
          if (unchanged) {
            const previous = readChunks.all(fileId) as Array<{ startLine: number; endLine: number; hash: string; text: string }>;
            reuse = previous.length === chunks.length && previous.every((chunk, index) => {
              const next = chunks[index];
              return chunk.startLine === next.startLine && chunk.endLine === next.endLine && chunk.hash === next.hash && chunk.text === next.text;
            });
          }
          if (!reuse) {
            deleteChunksForFile(db, fileId);
            for (const chunk of chunks) {
              insertChunk(db, { fileId, path: input.relativePath, startLine: chunk.startLine, endLine: chunk.endLine,
                title: input.relativePath, text: chunk.text, hash: chunk.hash });
            }
          }
        }
        if (reuse) {
          reusedChunkFiles++;
          repairedFtsRows += repairFts.run(input.relativePath, fileId).changes;
        }
        if (cacheKey !== null) rememberChunking.run(fileId, cacheKey); else forgetChunking.run(fileId);
        return { ...graph, chunks: chunksForFile, dependencyCount: dependencies.length };
      },
    );

    for (const file of scan.files) {
      const content = await fs.readFile(file.absolutePath, "utf8");
      const graph = writeFileMetadata({
        relativePath: file.relativePath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        hash: sha256Hex(content),
        content,
      });
      chunkCount += graph.chunks;
      byteCount += file.size;
      symbolCount += graph.symbols.length;
      dependencyCount += graph.dependencyCount;
    }

    const stale = (db.prepare("select id, path from files where project_path = ?").all(projectPath) as Array<{ id: number; path: string }>).filter((file) => !activePathSet.has(file.path));
    const deleteFile = db.prepare("delete from files where id = ?");
    db.transaction(() => {
      for (const file of stale) {
        deleteChunksForFile(db, file.id);
        deleteFile.run(file.id);
      }
    })();
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
      symbols: symbolCount,
      dependencies: dependencyCount,
      chunkedFiles,
      reusedChunkFiles,
      repairedFtsRows,
    },
    skipped: scan.skipped,
  };
}
