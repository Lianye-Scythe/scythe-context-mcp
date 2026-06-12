import fs from "node:fs";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

export interface RelatedSnippet {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  snippetTruncated?: boolean;
}

export interface RelatedSnippetPack {
  snippets: RelatedSnippet[];
  summary: {
    maxRelatedContextChars: number;
    usedRelatedContextChars: number;
    relatedSnippetCount: number;
    truncatedRelatedSnippets: number;
  };
}

export interface ReadRelatedSnippetsOptions {
  dbPath: string;
  paths: string[];
  maxSnippetsPerFile: number;
  maxSnippetChars: number;
  maxRelatedContextChars: number;
}

const truncationMarker = "... [truncated]";
const truncationMarkerWithBreak = `\n${truncationMarker}`;

function emptyRelatedSnippetPack(maxRelatedContextChars: number): RelatedSnippetPack {
  return {
    snippets: [],
    summary: {
      maxRelatedContextChars: Math.max(0, maxRelatedContextChars),
      usedRelatedContextChars: 0,
      relatedSnippetCount: 0,
      truncatedRelatedSnippets: 0,
    },
  };
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("select 1 as existsFlag from sqlite_master where type in ('table', 'virtual table') and name = ?")
    .get(name) as { existsFlag: number } | undefined;
  return Boolean(row);
}

function compactSnippet(text: string, maxChars: number): { snippet: string; truncated: boolean } {
  const normalized = text.replace(/\s+$/g, "");
  if (normalized.length <= maxChars) return { snippet: normalized, truncated: false };
  if (maxChars <= truncationMarker.length) return { snippet: truncationMarker.slice(0, maxChars), truncated: true };
  return {
    snippet: `${normalized.slice(0, Math.max(0, maxChars - truncationMarkerWithBreak.length)).trimEnd()}${truncationMarkerWithBreak}`,
    truncated: true,
  };
}

function fitBudget(snippet: string, remaining: number): { snippet: string; truncated: boolean } {
  if (snippet.length <= remaining) return { snippet, truncated: false };
  if (remaining <= 0) return { snippet: "", truncated: true };
  if (remaining <= truncationMarker.length) return { snippet: truncationMarker.slice(0, remaining), truncated: true };
  return {
    snippet: `${snippet.slice(0, remaining - truncationMarkerWithBreak.length).trimEnd()}${truncationMarkerWithBreak}`,
    truncated: true,
  };
}

export function readRelatedSnippets(options: ReadRelatedSnippetsOptions): RelatedSnippetPack {
  if (!fs.existsSync(options.dbPath) || options.maxRelatedContextChars <= 0 || options.maxSnippetsPerFile <= 0) {
    return emptyRelatedSnippetPack(options.maxRelatedContextChars);
  }

  const db = new Database(options.dbPath, { readonly: true });
  const snippets: RelatedSnippet[] = [];
  let usedRelatedContextChars = 0;
  let truncatedRelatedSnippets = 0;

  try {
    if (!tableExists(db, "files") || !tableExists(db, "chunks")) {
      return emptyRelatedSnippetPack(options.maxRelatedContextChars);
    }

    const selectChunks = db.prepare(`
      select files.path,
             chunks.start_line as startLine,
             chunks.end_line as endLine,
             chunks.text
      from chunks
      join files on files.id = chunks.file_id
      where files.path = ?
      order by chunks.start_line
      limit ?
    `);

    for (const path of options.paths) {
      if (usedRelatedContextChars >= options.maxRelatedContextChars) break;
      const rows = selectChunks.all(path, options.maxSnippetsPerFile) as Array<{
        path: string;
        startLine: number;
        endLine: number;
        text: string;
      }>;

      for (const row of rows) {
        if (usedRelatedContextChars >= options.maxRelatedContextChars) break;
        const compacted = compactSnippet(row.text, options.maxSnippetChars);
        const fitted = fitBudget(compacted.snippet, options.maxRelatedContextChars - usedRelatedContextChars);
        if (fitted.snippet.length === 0) break;
        const snippetTruncated = compacted.truncated || fitted.truncated;
        if (snippetTruncated) truncatedRelatedSnippets += 1;
        usedRelatedContextChars += fitted.snippet.length;
        snippets.push({
          path: row.path,
          startLine: row.startLine,
          endLine: row.endLine,
          snippet: fitted.snippet,
          ...(snippetTruncated ? { snippetTruncated } : {}),
        });
      }
    }

    return {
      snippets,
      summary: {
        maxRelatedContextChars: options.maxRelatedContextChars,
        usedRelatedContextChars,
        relatedSnippetCount: snippets.length,
        truncatedRelatedSnippets,
      },
    };
  } finally {
    db.close();
  }
}
