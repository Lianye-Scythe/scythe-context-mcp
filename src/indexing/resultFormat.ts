import { keywordTerms } from "./keywordSearch.js";

export interface FormattableSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  distance?: number;
  score?: number;
  keywordScore?: number;
  snippet?: string;
  matchTypes?: string[];
}

export interface FormatSearchResultsOptions {
  maxContextChars?: number;
}

export interface FormatSearchResultsSummary {
  maxContextChars: number | null;
  usedContextChars: number;
  truncatedResults: number;
}

export interface FormattedSearchResult {
  grepKeywords: string[];
  matchReason: string;
  snippetTruncated?: boolean;
}

const truncationMarker = "... [truncated]";
const truncationMarkerWithBreak = `\n${truncationMarker}`;

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
  if (matchTypes.includes("local")) {
    return "local code-aware related file";
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
  options: FormatSearchResultsOptions = {},
): { results: Array<T & FormattedSearchResult>; summary: FormatSearchResultsSummary } {
  const maxContextChars = options.maxContextChars ?? null;
  let usedContextChars = 0;
  let truncatedResults = 0;

  const formatted = results.map((result) => {
    let snippet = result.snippet;
    let snippetTruncated = false;

    if (typeof snippet === "string" && maxContextChars !== null) {
      const remaining = Math.max(0, maxContextChars - usedContextChars);
      if (snippet.length > remaining) {
        if (remaining >= truncationMarkerWithBreak.length) {
          snippet = `${snippet.slice(0, remaining - truncationMarkerWithBreak.length).trimEnd()}${truncationMarkerWithBreak}`;
        } else if (remaining >= truncationMarker.length) {
          snippet = truncationMarker;
        } else {
          snippet = "";
        }
        snippetTruncated = true;
        truncatedResults += 1;
      }
      usedContextChars += snippet.length;
    } else if (typeof snippet === "string") {
      usedContextChars += snippet.length;
    }

    return {
      ...result,
      snippet,
      grepKeywords: grepKeywords(query, result),
      matchReason: matchReason(result),
      ...(snippetTruncated ? { snippetTruncated } : {}),
    };
  });

  return {
    results: formatted,
    summary: {
      maxContextChars,
      usedContextChars,
      truncatedResults,
    },
  };
}
