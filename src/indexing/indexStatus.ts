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
