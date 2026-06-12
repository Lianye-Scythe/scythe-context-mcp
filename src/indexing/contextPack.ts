import { classifyRelatedPath, type RelatedFileGraphNode, type RelatedFilesResult } from "./relatedFiles.js";
import {
  formatSearchResults,
  type FormattableSearchResult,
  type FormattedSearchResult,
  type FormatSearchResultsSummary,
} from "./resultFormat.js";

export interface ContextPackOptions {
  maxContextChars: number;
  maxRelatedFiles: number;
  maxRelatedItems: number;
}

export interface ContextPackRelatedFile {
  sourcePath: string;
  role: ReturnType<typeof classifyRelatedPath>;
  depth?: number;
  via?: string | null;
  symbols: RelatedFilesResult["symbols"];
  imports: RelatedFilesResult["imports"];
  importedBy: RelatedFilesResult["importedBy"];
}

export interface ContextPack<T extends FormattableSearchResult> {
  primaryResults: Array<T & FormattedSearchResult>;
  relatedFiles: ContextPackRelatedFile[];
  suggestedPaths: string[];
  context: FormatSearchResultsSummary & {
    primaryResultCount: number;
    relatedFileCount: number;
  };
}

function addUnique(values: string[], value: string | null | undefined): void {
  if (value && !values.includes(value)) values.push(value);
}

function compactRelatedFile(related: RelatedFilesResult | RelatedFileGraphNode, maxRelatedItems: number): ContextPackRelatedFile {
  return {
    sourcePath: related.path,
    role: classifyRelatedPath(related.path),
    ...("depth" in related ? { depth: related.depth, via: related.via } : {}),
    symbols: related.symbols.slice(0, maxRelatedItems),
    imports: related.imports.slice(0, maxRelatedItems),
    importedBy: related.importedBy.slice(0, maxRelatedItems),
  };
}

export function buildContextPack<T extends FormattableSearchResult>(
  query: string,
  searchResults: readonly T[],
  relatedFiles: readonly RelatedFilesResult[],
  options: ContextPackOptions,
): ContextPack<T> {
  const formatted = formatSearchResults(query, searchResults, { maxContextChars: options.maxContextChars });
  const primaryPaths = formatted.results.map((result) => result.path);
  const related = relatedFiles
    .slice(0, options.maxRelatedFiles)
    .map((item) => compactRelatedFile(item, options.maxRelatedItems));

  const suggestedPaths: string[] = [];
  for (const path of primaryPaths) addUnique(suggestedPaths, path);
  for (const item of related) {
    for (const dependency of item.imports) addUnique(suggestedPaths, dependency.resolvedPath);
    for (const reverseDependency of item.importedBy) addUnique(suggestedPaths, reverseDependency.path);
  }

  return {
    primaryResults: formatted.results,
    relatedFiles: related,
    suggestedPaths,
    context: {
      ...formatted.summary,
      primaryResultCount: formatted.results.length,
      relatedFileCount: related.length,
    },
  };
}
