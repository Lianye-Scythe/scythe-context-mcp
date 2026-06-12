import { keywordTerms } from "./keywordSearch.js";

export interface FormattableSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  distance?: number;
  score?: number;
  keywordScore?: number;
  matchTypes?: string[];
}

export function grepKeywords(query: string, result: Pick<FormattableSearchResult, "path">): string[] {
  const pathParts = result.path
    .split(/[\/._-]+/g)
    .filter((part) => part.length >= 3);
  return Array.from(new Set([...keywordTerms(query), ...pathParts])).slice(0, 8);
}

export function matchReason(result: FormattableSearchResult): string {
  const matchTypes = result.matchTypes || [];
  if (matchTypes.includes("semantic") && matchTypes.includes("keyword")) {
    return "semantic similarity plus keyword/path match";
  }
  if (matchTypes.includes("keyword")) {
    return "keyword/path match";
  }
  if (typeof result.distance === "number") {
    return `semantic similarity distance ${result.distance.toFixed(4)}`;
  }
  if (typeof result.score === "number") {
    return `ranked score ${result.score.toFixed(4)}`;
  }
  return "ranked match";
}

export function formatSearchResults<T extends FormattableSearchResult>(
  query: string,
  results: readonly T[],
): Array<T & { grepKeywords: string[]; matchReason: string }> {
  return results.map((result) => ({
    ...result,
    grepKeywords: grepKeywords(query, result),
    matchReason: matchReason(result),
  }));
}
