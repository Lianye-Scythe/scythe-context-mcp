export type ResponseMode = "paths_only" | "compact" | "snippets";

export interface ResponseStats {
  estimatedJsonChars: number;
  estimatedOutputTokens: number;
}

export function estimateTokensFromJson(value: unknown): ResponseStats {
  const estimatedJsonChars = JSON.stringify(value).length;
  return {
    estimatedJsonChars,
    estimatedOutputTokens: Math.ceil(estimatedJsonChars / 4),
  };
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n... [truncated]`,
    truncated: true,
  };
}

function compactSnippet(snippet: unknown, maxChars: number): { snippet: unknown; truncated: boolean } {
  if (typeof snippet !== "string") return { snippet, truncated: false };
  const result = truncateText(snippet, maxChars);
  return { snippet: result.text, truncated: result.truncated };
}

export function withResponseStats<T extends Record<string, unknown>>(payload: T): T & {
  responseStats: ResponseStats;
} {
  return {
    ...payload,
    responseStats: estimateTokensFromJson(payload),
  };
}

function compactSearchResult(result: Record<string, unknown>, mode: ResponseMode): Record<string, unknown> {
  const base = {
    path: result.path,
    startLine: result.startLine,
    endLine: result.endLine,
    matchTypes: result.matchTypes,
    matchReason: result.matchReason,
    grepKeywords: result.grepKeywords,
  };

  if (mode === "paths_only") return base;

  const compacted = compactSnippet(result.snippet, mode === "compact" ? 360 : 1200);
  return {
    ...base,
    score: result.score,
    distance: result.distance,
    keywordScore: result.keywordScore,
    snippet: compacted.snippet,
    snippetTruncated: Boolean(result.snippetTruncated) || compacted.truncated,
  };
}

function compactRelatedFile(file: Record<string, unknown>, mode: ResponseMode): Record<string, unknown> {
  const sourcePath = file.sourcePath;
  const role = file.role;
  const depth = file.depth;
  const via = file.via;
  if (mode === "paths_only") return { sourcePath, role, depth, via };

  const limit = mode === "compact" ? 3 : 12;
  const symbols = Array.isArray(file.symbols) ? file.symbols.slice(0, limit) : [];
  const imports = Array.isArray(file.imports) ? file.imports.slice(0, limit) : [];
  const importedBy = Array.isArray(file.importedBy) ? file.importedBy.slice(0, limit) : [];
  return {
    sourcePath,
    role,
    depth,
    via,
    symbols,
    imports,
    importedBy,
  };
}

export function shapeSemanticPayload(payload: Record<string, unknown>, mode: ResponseMode): Record<string, unknown> {
  const results = Array.isArray(payload.results)
    ? payload.results.map((result) => compactSearchResult(result as Record<string, unknown>, mode))
    : [];
  const shaped: Record<string, unknown> = {
    query: payload.query,
    projectPath: payload.projectPath,
    mode: payload.mode,
    effectiveMode: payload.effectiveMode,
    rerankMode: payload.rerankMode,
    rerankApplied: payload.rerankApplied,
    fallback: payload.fallback,
    resultCount: payload.resultCount,
    responseMode: mode,
    results,
    context: payload.context,
  };
  if (mode === "snippets") {
    shaped.dbPath = payload.dbPath;
    shaped.dimensions = payload.dimensions;
  }
  return withResponseStats(shaped);
}

export function shapeContextPackPayload(payload: Record<string, unknown>, mode: ResponseMode): Record<string, unknown> {
  const primaryResults = Array.isArray(payload.primaryResults)
    ? payload.primaryResults.map((result) => compactSearchResult(result as Record<string, unknown>, mode))
    : [];
  const relatedFiles = Array.isArray(payload.relatedFiles)
    ? payload.relatedFiles.map((file) => compactRelatedFile(file as Record<string, unknown>, mode))
    : [];
  const relatedSnippets =
    mode === "paths_only" || !Array.isArray(payload.relatedSnippets)
      ? []
      : payload.relatedSnippets.map((snippet) => {
          const record = snippet as Record<string, unknown>;
          const compacted = compactSnippet(record.snippet, mode === "compact" ? 240 : 1200);
          return {
            ...record,
            snippet: compacted.snippet,
            snippetTruncated: Boolean(record.snippetTruncated) || compacted.truncated,
          };
        });
  const shaped: Record<string, unknown> = {
    query: payload.query,
    projectPath: payload.projectPath,
    mode: payload.mode,
    effectiveMode: payload.effectiveMode,
    rerankMode: payload.rerankMode,
    rerankApplied: payload.rerankApplied,
    fallback: payload.fallback,
    relatedDepth: payload.relatedDepth,
    relatedSeedCount: payload.relatedSeedCount,
    includeRelatedSnippets: payload.includeRelatedSnippets,
    responseMode: mode,
    primaryResults,
    relatedFiles,
    relatedSnippets,
    suggestedPaths: payload.suggestedPaths,
    context: payload.context,
  };
  if (mode === "snippets") {
    shaped.dbPath = payload.dbPath;
    shaped.dimensions = payload.dimensions;
  }
  return withResponseStats(shaped);
}
