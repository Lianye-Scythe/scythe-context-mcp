import fs from "node:fs";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";

export interface RelatedFilesOptions {
  dbPath: string;
  filePath: string;
  maxResults: number;
}

export interface RelatedFileGraphOptions {
  dbPath: string;
  seedPaths: string[];
  maxDepth: number;
  maxFiles: number;
  maxResultsPerFile: number;
}

export interface RelatedFilesResult {
  path: string;
  symbols: Array<{
    name: string;
    kind: string;
    line: number;
    signature: string;
    exported: boolean;
  }>;
  imports: Array<{
    specifier: string;
    resolvedPath: string | null;
    line: number;
  }>;
  importedBy: Array<{
    path: string;
    specifier: string;
    line: number;
  }>;
}

export interface RelatedFileGraphNode extends RelatedFilesResult {
  depth: number;
  via: string | null;
}

type RelatedPathRole = "source" | "test" | "mock" | "fixture" | "generated" | "docs";
interface RelatedQueueItem {
  path: string;
  depth: number;
  via: string | null;
  order: number;
}

function tableExists(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("select 1 as existsFlag from sqlite_master where type in ('table', 'virtual table') and name = ?")
    .get(name) as { existsFlag: number } | undefined;
  return Boolean(row);
}

export function classifyRelatedPath(path: string): RelatedPathRole {
  const normalized = path.toLowerCase();
  if (/(^|\/)(test|tests|__tests__|spec|specs)(\/|$)|\.(test|spec)\.[^.]+$/.test(normalized)) return "test";
  if (/(^|\/)(__mocks__|mocks?)(\/|$)|\bmock\b/.test(normalized)) return "mock";
  if (/(^|\/)(fixtures?|samples?)(\/|$)/.test(normalized)) return "fixture";
  if (/(\.generated\.|\.gen\.|\/generated\/|\/dist\/|\/build\/)/.test(normalized)) return "generated";
  if (/\.(md|mdx|rst|txt)$|(^|\/)docs?\//.test(normalized)) return "docs";
  return "source";
}

function relatedPathScore(path: string): number {
  switch (classifyRelatedPath(path)) {
    case "source":
      return 0;
    case "docs":
      return 1;
    case "test":
      return 2;
    case "mock":
      return 3;
    case "fixture":
      return 4;
    case "generated":
      return 5;
  }
}

function sortRelatedPaths(paths: string[]): string[] {
  return paths
    .map((path, index) => ({ path, index }))
    .sort((a, b) => relatedPathScore(a.path) - relatedPathScore(b.path) || a.index - b.index || a.path.localeCompare(b.path))
    .map((item) => item.path);
}

function sortQueue(queue: RelatedQueueItem[]): void {
  queue.sort(
    (a, b) =>
      a.depth - b.depth ||
      relatedPathScore(a.path) - relatedPathScore(b.path) ||
      a.order - b.order ||
      a.path.localeCompare(b.path),
  );
}

export function readRelatedFiles(options: RelatedFilesOptions): RelatedFilesResult {
  if (!fs.existsSync(options.dbPath)) {
    throw new Error(`Index database not found: ${options.dbPath}`);
  }

  const db = new Database(options.dbPath, { readonly: true });
  try {
    if (!tableExists(db, "files") || !tableExists(db, "file_symbols") || !tableExists(db, "file_dependencies")) {
      return { path: options.filePath, symbols: [], imports: [], importedBy: [] };
    }

    const file = db.prepare("select id, path from files where path = ?").get(options.filePath) as
      | { id: number; path: string }
      | undefined;
    if (!file) {
      return { path: options.filePath, symbols: [], imports: [], importedBy: [] };
    }

    const symbols = db
      .prepare(
        `
        select name, kind, line, signature, exported
        from file_symbols
        where file_id = ?
        order by line, name
        limit ?
      `,
      )
      .all(file.id, options.maxResults) as RelatedFilesResult["symbols"];

    const imports = db
      .prepare(
        `
        select specifier, resolved_path as resolvedPath, line
        from file_dependencies
        where file_id = ?
        order by line, specifier
        limit ?
      `,
      )
      .all(file.id, options.maxResults) as RelatedFilesResult["imports"];

    const importedBy = db
      .prepare(
        `
        select files.path, file_dependencies.specifier, file_dependencies.line
        from file_dependencies
        join files on files.id = file_dependencies.file_id
        where file_dependencies.resolved_path = ?
        order by files.path, file_dependencies.line
        limit ?
      `,
      )
      .all(file.path, options.maxResults) as RelatedFilesResult["importedBy"];

    return {
      path: file.path,
      symbols: symbols.map((symbol) => ({ ...symbol, exported: Boolean(symbol.exported) })),
      imports,
      importedBy,
    };
  } finally {
    db.close();
  }
}

export function readRelatedFileGraph(options: RelatedFileGraphOptions): RelatedFileGraphNode[] {
  const maxDepth = Math.max(0, options.maxDepth);
  const maxFiles = Math.max(0, options.maxFiles);
  if (maxFiles === 0) return [];

  let order = 0;
  const queue: RelatedQueueItem[] = options.seedPaths.map((path) => ({ path, depth: 0, via: null, order: order++ }));
  const visited = new Set<string>();
  const nodes: RelatedFileGraphNode[] = [];

  while (queue.length > 0 && nodes.length < maxFiles) {
    sortQueue(queue);
    const next = queue.shift();
    if (!next || visited.has(next.path)) continue;
    visited.add(next.path);

    const related = readRelatedFiles({
      dbPath: options.dbPath,
      filePath: next.path,
      maxResults: options.maxResultsPerFile,
    });
    nodes.push({ ...related, depth: next.depth, via: next.via });

    if (next.depth >= maxDepth) continue;
    const neighbors = sortRelatedPaths([
      ...related.imports.map((item) => item.resolvedPath).filter((path): path is string => Boolean(path)),
      ...related.importedBy.map((item) => item.path),
    ]);
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor) && !queue.some((queued) => queued.path === neighbor)) {
        queue.push({ path: neighbor, depth: next.depth + 1, via: next.path, order: order++ });
      }
    }
  }

  return nodes;
}
