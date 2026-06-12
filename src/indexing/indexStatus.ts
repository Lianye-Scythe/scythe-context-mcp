import fs from "node:fs";
import Database from "better-sqlite3";

export interface DetailedIndexStatus {
  exists: boolean;
  dbPath: string;
  files: number;
  chunks: number;
  ftsRows: number;
  embeddingSets: Array<{
    id: number;
    provider: string;
    model: string;
    dimensions: number;
    embeddings: number;
  }>;
}

export function readDetailedIndexStatus(dbPath: string): DetailedIndexStatus {
  if (!fs.existsSync(dbPath)) {
    return {
      exists: false,
      dbPath,
      files: 0,
      chunks: 0,
      ftsRows: 0,
      embeddingSets: [],
    };
  }

  const db = new Database(dbPath, { readonly: true });
  try {
    const files = (db.prepare("select count(*) as count from files").get() as { count: number }).count;
    const chunks = (db.prepare("select count(*) as count from chunks").get() as { count: number }).count;
    const ftsRows = (db.prepare("select count(*) as count from chunk_fts").get() as { count: number }).count;
    const embeddingSets = db
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
      .all() as DetailedIndexStatus["embeddingSets"];

    return { exists: true, dbPath, files, chunks, ftsRows, embeddingSets };
  } finally {
    db.close();
  }
}

