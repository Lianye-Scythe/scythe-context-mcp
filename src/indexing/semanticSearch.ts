import Database from "better-sqlite3";
import { vectorTableName } from "../storage/schema.js";
import { loadSqliteVec, vectorToFloat32Buffer } from "../storage/sqliteVec.js";

export interface VectorSearchOptions {
  dbPath: string;
  dimensions: number;
  queryVector: readonly number[];
  maxResults: number;
  maxSnippetChars: number;
}

export interface VectorSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  distance: number;
  snippet: string;
  matchType: "semantic";
}

function compactSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+$/g, "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function searchByVector(options: VectorSearchOptions): VectorSearchResult[] {
  if (!Number.isInteger(options.maxResults) || options.maxResults <= 0) {
    throw new Error("maxResults must be a positive integer");
  }
  if (!Number.isInteger(options.maxSnippetChars) || options.maxSnippetChars <= 0) {
    throw new Error("maxSnippetChars must be a positive integer");
  }

  const db = new Database(options.dbPath, { readonly: true });
  try {
    loadSqliteVec(db);
    const rows = db
      .prepare(`
        select files.path,
               chunks.start_line as startLine,
               chunks.end_line as endLine,
               chunks.text,
               vec.distance as distance
        from ${vectorTableName(options.dimensions)} vec
        join embeddings on embeddings.id = vec.rowid
        join chunks on chunks.id = embeddings.chunk_id
        join files on files.id = chunks.file_id
        where vec.embedding match ?
          and vec.k = ?
        order by vec.distance
      `)
      .all(vectorToFloat32Buffer(options.queryVector, options.dimensions), options.maxResults) as Array<{
        path: string;
        startLine: number;
        endLine: number;
        text: string;
        distance: number;
      }>;

    return rows.map((row) => ({
      path: row.path,
      startLine: row.startLine,
      endLine: row.endLine,
      distance: row.distance,
      snippet: compactSnippet(row.text, options.maxSnippetChars),
      matchType: "semantic",
    }));
  } finally {
    db.close();
  }
}
