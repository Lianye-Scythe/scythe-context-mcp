import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { scanProject } from "./scanner.js";
import { sha256Hex } from "./hash.js";
import type { IndexingLimits } from "./types.js";

export interface DetailedIndexStatus {
  exists: boolean;
  dbPath: string;
  files: number;
  chunks: number;
  ftsRows: number;
  symbols: number;
  dependencies: number;
  embeddingSets: Array<{
    id: number;
    provider: string;
    model: string;
    dimensions: number;
    embeddings: number;
  }>;
}

export type FreshnessReason = "new" | "modified" | "metadata_changed" | "missing";

export interface IndexFreshness {
  checked: boolean;
  status: "index_missing" | "fresh" | "stale";
  checkedAt: string;
  indexedFiles: number;
  indexedProjectPaths: string[];
  scannedFiles: number;
  staleFiles: number;
  newFiles: number;
  modifiedFiles: number;
  metadataChangedFiles: number;
  missingFiles: number;
  skippedFiles: number;
  samples: Array<{
    path: string;
    reason: FreshnessReason;
    detail?: string;
  }>;
}

export interface IndexRecommendationOptions {
  desiredDimensions: number;
  freshness?: IndexFreshness;
}

export function recommendedNextActions(
  status: DetailedIndexStatus,
  options: IndexRecommendationOptions,
): string[] {
  if (!status.exists) {
    return [
      "Run repo_reindex with dry_run=false to create the metadata index.",
      "Then run repo_reindex with dry_run=false and index_embeddings=true when semantic search or context packs need vectors.",
    ];
  }

  const actions: string[] = [];
  if (options.freshness?.status === "stale") {
    actions.push("Run repo_reindex with dry_run=false to refresh stale, new, missing, or metadata-changed files.");
  }
  if (status.files === 0 || status.chunks === 0) {
    actions.push("Run repo_reindex with dry_run=false to index files and chunks.");
  }
  if (status.ftsRows < status.chunks) {
    actions.push("Run repo_reindex with dry_run=false to repair missing keyword-search rows.");
  }
  if (status.symbols === 0 && status.files > 0) {
    actions.push("Run repo_reindex with dry_run=false to populate symbol metadata.");
  }
  if (status.dependencies === 0 && status.files > 1) {
    actions.push("Run repo_reindex with dry_run=false to populate dependency metadata.");
  }

  const matchingEmbeddingSet = status.embeddingSets.find((set) => set.dimensions === options.desiredDimensions);
  if (!matchingEmbeddingSet || matchingEmbeddingSet.embeddings === 0) {
    actions.push(
      `Run repo_reindex with dry_run=false and index_embeddings=true to create ${options.desiredDimensions}-dimension embeddings for semantic search.`,
    );
  } else if (matchingEmbeddingSet.embeddings < status.chunks) {
    actions.push(
      "Run repo_reindex with dry_run=false and index_embeddings=true to fill missing embeddings for newly indexed chunks.",
    );
  }

  if (actions.length === 0) {
    actions.push("Index is ready. Prefer repo_context_pack for task-oriented lookup.");
  }

  return actions;
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("select 1 as existsFlag from sqlite_master where type in ('table', 'virtual table') and name = ?")
    .get(name) as { existsFlag: number } | undefined;
  return Boolean(row);
}

function countTableRows(db: SqliteDatabase, name: string): number {
  if (!tableExists(db, name)) return 0;
  return (db.prepare(`select count(*) as count from ${name}`).get() as { count: number }).count;
}

export function readDetailedIndexStatus(dbPath: string): DetailedIndexStatus {
  if (!fs.existsSync(dbPath)) {
    return {
      exists: false,
      dbPath,
      files: 0,
      chunks: 0,
      ftsRows: 0,
      symbols: 0,
      dependencies: 0,
      embeddingSets: [],
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const files = countTableRows(db, "files");
    const chunks = countTableRows(db, "chunks");
    const ftsRows = countTableRows(db, "chunk_fts");
    const symbols = countTableRows(db, "file_symbols");
    const dependencies = countTableRows(db, "file_dependencies");
    const embeddingSets = tableExists(db, "embedding_sets")
      ? (db
          .prepare(`
        select embedding_sets.id,
               embedding_sets.provider,
               embedding_sets.model,
               embedding_sets.dimensions,
               count(embeddings.id) as embeddings
        from embedding_sets
        left join embeddings on embeddings.embedding_set_id = embedding_sets.id
        group by embedding_sets.id
        order by embedding_sets.id
      `)
          .all() as DetailedIndexStatus["embeddingSets"])
      : [];

    return { exists: true, dbPath, files, chunks, ftsRows, symbols, dependencies, embeddingSets };
  } finally {
    db.close();
  }
}

interface IndexedFileRow {
  projectPath: string;
  path: string;
  size: number;
  mtimeMs: number;
  hash: string;
}

function readIndexedProjectPaths(db: SqliteDatabase): string[] {
  if (!tableExists(db, "files")) return [];
  return (db.prepare("select distinct project_path as projectPath from files order by project_path").all() as Array<{
    projectPath: string;
  }>).map((row) => row.projectPath);
}

function safeRealpath(value: string): string | undefined {
  try {
    return fs.realpathSync(value);
  } catch {
    return undefined;
  }
}

function projectPathAliases(db: SqliteDatabase, projectPath: string): string[] {
  const aliases = new Set([projectPath]);
  const projectRealpath = safeRealpath(projectPath);
  const indexedProjectPaths = readIndexedProjectPaths(db);

  for (const indexedProjectPath of indexedProjectPaths) {
    if (projectRealpath && safeRealpath(indexedProjectPath) === projectRealpath) {
      aliases.add(indexedProjectPath);
    }
  }

  if (aliases.size === 1 && indexedProjectPaths.length === 1) {
    aliases.add(indexedProjectPaths[0]);
  }

  return Array.from(aliases);
}

function readIndexedFileRows(db: SqliteDatabase, projectPaths: string[]): IndexedFileRow[] {
  if (!tableExists(db, "files")) return [];
  if (projectPaths.length === 0) return [];
  const placeholders = projectPaths.map(() => "?").join(", ");
  return db
    .prepare(`
      select project_path as projectPath, path, size, mtime_ms as mtimeMs, hash
      from files
      where project_path in (${placeholders})
      order by path
    `)
    .all(...projectPaths) as IndexedFileRow[];
}

function pushSample(
  samples: IndexFreshness["samples"],
  sample: IndexFreshness["samples"][number],
  maxSamples: number,
): void {
  if (samples.length < maxSamples) {
    samples.push(sample);
  }
}

export async function readIndexFreshness(options: {
  projectPath: string;
  dbPath: string;
  limits: Pick<IndexingLimits, "maxFileBytes">;
  maxSamples?: number;
}): Promise<IndexFreshness> {
  const checkedAt = new Date().toISOString();
  const projectPath = path.resolve(options.projectPath);
  const maxSamples = options.maxSamples ?? 20;
  if (!fs.existsSync(options.dbPath)) {
    return {
      checked: false,
      status: "index_missing",
      checkedAt,
      indexedFiles: 0,
      indexedProjectPaths: [],
      scannedFiles: 0,
      staleFiles: 0,
      newFiles: 0,
      modifiedFiles: 0,
      metadataChangedFiles: 0,
      missingFiles: 0,
      skippedFiles: 0,
      samples: [],
    };
  }

  const db = new Database(options.dbPath, { readonly: true });
  let indexedRows: IndexedFileRow[];
  let indexedProjectPaths: string[];
  try {
    indexedProjectPaths = projectPathAliases(db, projectPath);
    indexedRows = readIndexedFileRows(db, indexedProjectPaths);
  } finally {
    db.close();
  }

  const scan = await scanProject(projectPath, options.limits);
  const indexedByPath = new Map(indexedRows.map((row) => [row.path, row]));
  const scannedByPath = new Map(scan.files.map((file) => [file.relativePath, file]));
  const samples: IndexFreshness["samples"] = [];
  let newFiles = 0;
  let modifiedFiles = 0;
  let metadataChangedFiles = 0;
  let missingFiles = 0;

  for (const file of scan.files) {
    if (!indexedByPath.has(file.relativePath)) {
      newFiles += 1;
      pushSample(samples, { path: file.relativePath, reason: "new" }, maxSamples);
    }
  }

  for (const indexed of indexedRows) {
    const file = scannedByPath.get(indexed.path);
    if (!file) {
      missingFiles += 1;
      pushSample(samples, { path: indexed.path, reason: "missing" }, maxSamples);
      continue;
    }

    const sizeChanged = indexed.size !== file.size;
    const mtimeChanged = Math.abs(indexed.mtimeMs - file.mtimeMs) > 1;
    if (!sizeChanged && !mtimeChanged) {
      continue;
    }

    const content = fs.readFileSync(file.absolutePath);
    const currentHash = sha256Hex(content);
    if (currentHash !== indexed.hash) {
      modifiedFiles += 1;
      pushSample(samples, { path: indexed.path, reason: "modified" }, maxSamples);
    } else {
      metadataChangedFiles += 1;
      pushSample(samples, { path: indexed.path, reason: "metadata_changed" }, maxSamples);
    }
  }

  const staleFiles = newFiles + modifiedFiles + metadataChangedFiles + missingFiles;
  return {
    checked: true,
    status: staleFiles === 0 ? "fresh" : "stale",
    checkedAt,
    indexedFiles: indexedRows.length,
    indexedProjectPaths,
    scannedFiles: scan.files.length,
    staleFiles,
    newFiles,
    modifiedFiles,
    metadataChangedFiles,
    missingFiles,
    skippedFiles: scan.skipped.length,
    samples,
  };
}
