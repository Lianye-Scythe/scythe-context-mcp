import fs from "node:fs";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

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

export interface IndexRecommendationOptions {
  desiredDimensions: number;
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
