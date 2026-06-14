import { searchByKeyword, type KeywordSearchResult } from "./keywordSearch.js";
import { rerankCodeAware } from "./codeAwareReranker.js";
import { searchByVector, type VectorSearchResult } from "./semanticSearch.js";

export type RerankMode = "auto" | "off";

export interface HybridSearchOptions {
  dbPath: string;
  query: string;
  dimensions: number;
  queryVector: readonly number[];
  maxResults: number;
  maxSnippetChars: number;
  rerankMode?: RerankMode;
}

export interface HybridSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  distance?: number;
  keywordScore?: number;
  snippet: string;
  matchTypes: Array<"semantic" | "keyword" | "local">;
}

function keyOf(result: Pick<HybridSearchResult, "path" | "startLine" | "endLine">): string {
  return `${result.path}:${result.startLine}:${result.endLine}`;
}

function semanticScore(result: VectorSearchResult, index: number): number {
  return 1 / (1 + Math.max(0, result.distance)) + Math.max(0, 0.2 - index * 0.01);
}

function keywordScore(result: KeywordSearchResult, index: number): number {
  return 1.2 + Math.max(0, 0.3 - index * 0.02) + Math.min(0.5, Math.abs(result.score) / 10);
}

export function mergeHybridResults(
  semanticResults: VectorSearchResult[],
  keywordResults: KeywordSearchResult[],
  maxResults: number,
): HybridSearchResult[] {
  const merged = new Map<string, HybridSearchResult>();

  semanticResults.forEach((result, index) => {
    merged.set(keyOf(result), {
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      score: semanticScore(result, index),
      distance: result.distance,
      snippet: result.snippet,
      matchTypes: ["semantic"],
    });
  });

  keywordResults.forEach((result, index) => {
    const key = keyOf(result);
    const score = keywordScore(result, index);
    const existing = merged.get(key);
    if (existing) {
      existing.score += score;
      existing.keywordScore = result.score;
      if (!existing.matchTypes.includes("keyword")) existing.matchTypes.push("keyword");
      if (result.snippet.length > existing.snippet.length) existing.snippet = result.snippet;
      return;
    }

    merged.set(key, {
      path: result.path,
      startLine: result.startLine,
      endLine: result.endLine,
      score,
      keywordScore: result.score,
      snippet: result.snippet,
      matchTypes: ["keyword"],
    });
  });

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, maxResults);
}

export function searchHybrid(options: HybridSearchOptions): HybridSearchResult[] {
  const semanticResults = searchByVector({
    dbPath: options.dbPath,
    dimensions: options.dimensions,
    queryVector: options.queryVector,
    maxResults: Math.max(options.maxResults * 2, options.maxResults),
    maxSnippetChars: options.maxSnippetChars,
  });
  const keywordResults = searchByKeyword({
    dbPath: options.dbPath,
    query: options.query,
    maxResults: Math.max(options.maxResults * 2, options.maxResults),
    maxSnippetChars: options.maxSnippetChars,
  });

  const mergedResults = mergeHybridResults(semanticResults, keywordResults, Math.max(options.maxResults * 3, options.maxResults));
  if ((options.rerankMode ?? "auto") === "off") {
    return mergedResults.slice(0, options.maxResults);
  }

  return rerankCodeAware({
    dbPath: options.dbPath,
    query: options.query,
    results: mergedResults,
    maxResults: options.maxResults,
    maxSnippetChars: options.maxSnippetChars,
  });
}

export function searchKeywordOnly(options: Omit<HybridSearchOptions, "dimensions" | "queryVector">): HybridSearchResult[] {
  const keywordResults = searchByKeyword({
    dbPath: options.dbPath,
    query: options.query,
    maxResults: Math.max(options.maxResults * 2, options.maxResults),
    maxSnippetChars: options.maxSnippetChars,
  });

  const mergedResults = mergeHybridResults([], keywordResults, Math.max(options.maxResults * 3, options.maxResults));
  if ((options.rerankMode ?? "auto") === "off") {
    return mergedResults.slice(0, options.maxResults);
  }

  return rerankCodeAware({
    dbPath: options.dbPath,
    query: options.query,
    results: mergedResults,
    maxResults: options.maxResults,
    maxSnippetChars: options.maxSnippetChars,
  });
}
