import Database from "better-sqlite3";

export interface KeywordSearchOptions {
  dbPath: string;
  query: string;
  maxResults: number;
  maxSnippetChars: number;
}

export interface KeywordSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  matchType: "keyword";
}

function compactSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+$/g, "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

export function keywordTerms(query: string): string[] {
  return Array.from(new Set(query.match(/[\p{L}\p{N}_.$/-]{2,}/gu) || []));
}

function ftsQuery(query: string): string | undefined {
  const terms = keywordTerms(query).filter((term) => term.length >= 3);
  if (terms.length === 0) return undefined;
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

export function searchByKeyword(options: KeywordSearchOptions): KeywordSearchResult[] {
  if (!Number.isInteger(options.maxResults) || options.maxResults <= 0) {
    throw new Error("maxResults must be a positive integer");
  }
  if (!Number.isInteger(options.maxSnippetChars) || options.maxSnippetChars <= 0) {
    throw new Error("maxSnippetChars must be a positive integer");
  }

  const db = new Database(options.dbPath, { readonly: true });
  try {
    const query = ftsQuery(options.query);
    const rows = query
      ? (db
          .prepare(`
            select files.path,
                   chunks.start_line as startLine,
                   chunks.end_line as endLine,
                   chunks.text,
                   bm25(chunk_fts) as score
            from chunk_fts
            join chunks on chunks.id = chunk_fts.rowid
            join files on files.id = chunks.file_id
            where chunk_fts match ?
            order by score
            limit ?
          `)
          .all(query, options.maxResults) as Array<{
          path: string;
          startLine: number;
          endLine: number;
          text: string;
          score: number;
        }>)
      : [];

    if (rows.length > 0) {
      return rows.map((row) => ({
        path: row.path,
        startLine: row.startLine,
        endLine: row.endLine,
        score: row.score,
        snippet: compactSnippet(row.text, options.maxSnippetChars),
        matchType: "keyword",
      }));
    }

    const fallbackTerm = keywordTerms(options.query)[0];
    if (!fallbackTerm) return [];
    const fallbackRows = db
      .prepare(`
        select files.path,
               chunks.start_line as startLine,
               chunks.end_line as endLine,
               chunks.text,
               case
                 when files.path like @pattern then -10.0
                 else -1.0
               end as score
        from chunks
        join files on files.id = chunks.file_id
        where files.path like @pattern or chunks.text like @pattern
        order by score, files.path, chunks.start_line
        limit @maxResults
      `)
      .all({ pattern: `%${fallbackTerm}%`, maxResults: options.maxResults }) as Array<{
      path: string;
      startLine: number;
      endLine: number;
      text: string;
      score: number;
    }>;

    return fallbackRows.map((row) => ({
      path: row.path,
      startLine: row.startLine,
      endLine: row.endLine,
      score: row.score,
      snippet: compactSnippet(row.text, options.maxSnippetChars),
      matchType: "keyword",
    }));
  } finally {
    db.close();
  }
}

