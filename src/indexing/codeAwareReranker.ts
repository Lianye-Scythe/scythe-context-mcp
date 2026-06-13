import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { keywordTerms } from "./keywordSearch.js";
import { classifyRelatedPath } from "./relatedFiles.js";
import type { HybridSearchResult } from "./hybridSearch.js";

export interface CodeAwareRerankOptions {
  dbPath: string;
  query: string;
  results: HybridSearchResult[];
  maxResults: number;
  maxSnippetChars: number;
}

interface CandidateDetails {
  symbols: string[];
  imports: number;
  importedBy: number;
}

const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function compactSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+$/g, "");
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeTerm(value: string): string {
  return value.toLowerCase();
}

function splitIdentifier(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9_]+|_/g)
    .map((part) => part.toLowerCase())
    .filter((part) => part.length >= 2);
}

function queryTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const term of keywordTerms(query)) {
    terms.add(normalizeTerm(term));
    for (const part of splitIdentifier(term)) terms.add(part);
  }
  return Array.from(terms).filter((term) => term.length >= 2);
}

function isCodeIntent(terms: readonly string[]): boolean {
  return terms.some((term) =>
    [
      "function",
      "class",
      "type",
      "interface",
      "handler",
      "provider",
      "schema",
      "index",
      "chunk",
      "row",
      "cache",
      "fallback",
      "rerank",
      "search",
      "embedding",
      "sqlite",
      "storage",
      "scanner",
      "binary",
    ].includes(term),
  );
}

function isDocsIntent(terms: readonly string[]): boolean {
  return terms.some((term) =>
    ["readme", "docs", "documentation", "codex", "wsl", "windows", "setup", "config", "npm", "publish"].includes(term),
  );
}

function isTestIntent(terms: readonly string[]): boolean {
  return terms.some((term) => ["test", "tests", "spec", "regression", "fixture"].includes(term));
}

function sourceCounterparts(testPath: string, activePaths: ReadonlySet<string>): string[] {
  const counterparts: string[] = [];
  for (const extension of sourceExtensions) {
    const suffixes = [`.test${extension}`, `.spec${extension}`];
    for (const suffix of suffixes) {
      if (!testPath.endsWith(suffix)) continue;
      const base = testPath.slice(0, -suffix.length);
      for (const sourceExtension of sourceExtensions) {
        const candidate = `${base}${sourceExtension}`;
        if (activePaths.has(candidate)) counterparts.push(candidate);
      }
    }
  }
  return counterparts;
}

function readActivePaths(db: SqliteDatabase): Set<string> {
  const rows = db.prepare("select path from files").all() as Array<{ path: string }>;
  return new Set(rows.map((row) => row.path));
}

function readCandidateDetails(db: SqliteDatabase, path: string): CandidateDetails {
  const file = db.prepare("select id from files where path = ?").get(path) as { id: number } | undefined;
  if (!file) return { symbols: [], imports: 0, importedBy: 0 };

  const symbols = db.prepare("select name from file_symbols where file_id = ? limit 80").all(file.id) as Array<{ name: string }>;
  const imports = (db.prepare("select count(*) as count from file_dependencies where file_id = ?").get(file.id) as { count: number }).count;
  const importedBy = (
    db
      .prepare(
        `
        select count(*) as count
        from file_dependencies
        join files on files.path = file_dependencies.resolved_path
        where files.id = ?
      `,
      )
      .get(file.id) as { count: number }
  ).count;

  return {
    symbols: symbols.flatMap((symbol) => [symbol.name, ...splitIdentifier(symbol.name)]),
    imports,
    importedBy,
  };
}

function readFirstChunk(db: SqliteDatabase, path: string, maxSnippetChars: number): HybridSearchResult | undefined {
  const row = db
    .prepare(
      `
      select files.path,
             chunks.start_line as startLine,
             chunks.end_line as endLine,
             chunks.text
      from chunks
      join files on files.id = chunks.file_id
      where files.path = ?
      order by chunks.start_line
      limit 1
    `,
    )
    .get(path) as { path: string; startLine: number; endLine: number; text: string } | undefined;
  if (!row) return undefined;

  return {
    path: row.path,
    startLine: row.startLine,
    endLine: row.endLine,
    score: 0,
    snippet: compactSnippet(row.text, maxSnippetChars),
    matchTypes: ["local"],
  };
}

function pathScore(path: string, terms: readonly string[]): number {
  const normalizedPath = path.toLowerCase();
  const basename = normalizedPath.split("/").at(-1) ?? normalizedPath;
  let score = 0;
  for (const term of terms) {
    if (normalizedPath.includes(term)) score += 0.25;
    if (basename.includes(term)) score += 0.2;
  }
  return Math.min(score, 2.5);
}

function snippetScore(snippet: string | undefined, terms: readonly string[]): number {
  if (!snippet) return 0;
  const text = snippet.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 0.08;
  }
  return Math.min(score, 0.8);
}

function symbolScore(details: CandidateDetails, terms: readonly string[]): number {
  if (details.symbols.length === 0) return 0;
  const symbols = details.symbols.map((symbol) => symbol.toLowerCase());
  let score = 0;
  for (const term of terms) {
    if (symbols.some((symbol) => symbol === term)) score += 0.7;
    else if (symbols.some((symbol) => symbol.includes(term))) score += 0.25;
  }
  return Math.min(score, 2.2);
}

function roleScore(path: string, terms: readonly string[]): number {
  const role = classifyRelatedPath(path);
  const codeIntent = isCodeIntent(terms);
  const docsIntent = isDocsIntent(terms);
  const testIntent = isTestIntent(terms);

  if (role === "generated") return -2;
  if (role === "test") return testIntent ? 0.4 : codeIntent ? -0.85 : -0.25;
  if (role === "docs") return docsIntent ? 0.45 : codeIntent ? -0.8 : -0.15;
  if (role === "source") return codeIntent ? 0.65 : 0.15;
  return -0.25;
}

function graphScore(details: CandidateDetails): number {
  return Math.min(0.5, details.imports * 0.04 + details.importedBy * 0.08);
}

function baseScore(result: HybridSearchResult): number {
  return result.score ?? 0;
}

function addCandidate(candidates: Map<string, HybridSearchResult>, candidate: HybridSearchResult): void {
  const key = `${candidate.path}:${candidate.startLine}:${candidate.endLine}`;
  const existing = candidates.get(key);
  if (!existing || baseScore(candidate) > baseScore(existing)) {
    candidates.set(key, candidate);
  }
}

export function rerankCodeAware(options: CodeAwareRerankOptions): HybridSearchResult[] {
  if (!Number.isInteger(options.maxResults) || options.maxResults <= 0) {
    throw new Error("maxResults must be a positive integer");
  }

  const terms = queryTerms(options.query);
  if (terms.length === 0 || options.results.length === 0) {
    return options.results.slice(0, options.maxResults);
  }

  const db = new Database(options.dbPath, { readonly: true });
  try {
    const activePaths = readActivePaths(db);
    const candidates = new Map<string, HybridSearchResult>();

    for (const result of options.results) {
      addCandidate(candidates, result);
      for (const counterpart of sourceCounterparts(result.path, activePaths)) {
        const counterpartResult = readFirstChunk(db, counterpart, options.maxSnippetChars);
        if (counterpartResult) {
          counterpartResult.score = Math.max(0, baseScore(result) * 0.85);
          addCandidate(candidates, counterpartResult);
        }
      }
    }

    const detailCache = new Map<string, CandidateDetails>();
    const detailsFor = (candidatePath: string) => {
      const existing = detailCache.get(candidatePath);
      if (existing) return existing;
      const details = readCandidateDetails(db, candidatePath);
      detailCache.set(candidatePath, details);
      return details;
    };

    return Array.from(candidates.values())
      .map((candidate) => {
        const details = detailsFor(candidate.path);
        const rerankScore =
          baseScore(candidate) +
          pathScore(candidate.path, terms) +
          snippetScore(candidate.snippet, terms) +
          symbolScore(details, terms) +
          roleScore(candidate.path, terms) +
          graphScore(details);

        return {
          ...candidate,
          score: rerankScore,
        };
      })
      .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
      .slice(0, options.maxResults);
  } finally {
    db.close();
  }
}
