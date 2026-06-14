import path from "node:path";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { buildContextPack } from "../indexing/contextPack.js";
import { reindexDryRun } from "../indexing/dryRun.js";
import { indexMissingEmbeddings } from "../indexing/embeddingWriter.js";
import { searchHybrid, searchKeywordOnly } from "../indexing/hybridSearch.js";
import { readDetailedIndexStatus, readIndexFreshness, recommendedNextActions } from "../indexing/indexStatus.js";
import { persistentReindexMetadata } from "../indexing/indexWriter.js";
import { readRelatedFileGraph, readRelatedFiles } from "../indexing/relatedFiles.js";
import { readRelatedSnippets } from "../indexing/relatedSnippets.js";
import { formatSearchResults, type FormattableSearchResult } from "../indexing/resultFormat.js";
import { searchByVector } from "../indexing/semanticSearch.js";
import {
  findProviderCapability,
  providerCapabilityInput,
  updateProviderCapability,
  type ProviderCapabilityUpdate,
} from "../providers/capabilities.js";
import { buildGeminiEndpoint, GeminiEmbeddingError, GeminiEmbeddingProvider, normalizeGeminiBaseUrl } from "../providers/gemini.js";
import { runRepoDoctor } from "./doctor.js";

function asJsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

type SearchMode = "hybrid" | "semantic";
type EffectiveSearchMode = SearchMode | "keyword";

interface EmbeddingFailureDetails {
  type: string;
  message: string;
  httpStatus?: number;
  retryable: boolean;
  bodySnippet?: string;
}

function searchIndexedChunks(options: {
  dbPath: string;
  query: string;
  dimensions: number;
  queryVector: readonly number[];
  maxResults: number;
  maxSnippetChars: number;
  mode: SearchMode;
  rerankMode: AppConfig["search"]["rerankMode"];
}): FormattableSearchResult[] {
  return options.mode === "semantic"
    ? searchByVector({
        dbPath: options.dbPath,
        dimensions: options.dimensions,
        queryVector: options.queryVector,
        maxResults: options.maxResults,
        maxSnippetChars: options.maxSnippetChars,
      })
    : searchHybrid({
        dbPath: options.dbPath,
        query: options.query,
        dimensions: options.dimensions,
        queryVector: options.queryVector,
        maxResults: options.maxResults,
        maxSnippetChars: options.maxSnippetChars,
        rerankMode: options.rerankMode,
      });
}

function searchKeywordOnlyChunks(options: {
  dbPath: string;
  query: string;
  maxResults: number;
  maxSnippetChars: number;
  rerankMode: AppConfig["search"]["rerankMode"];
}): FormattableSearchResult[] {
  return searchKeywordOnly({
    dbPath: options.dbPath,
    query: options.query,
    maxResults: options.maxResults,
    maxSnippetChars: options.maxSnippetChars,
    rerankMode: options.rerankMode,
  });
}

function rerankApplied(mode: EffectiveSearchMode, rerankMode: AppConfig["search"]["rerankMode"]): boolean {
  return rerankMode !== "off" && mode !== "semantic";
}

function embeddingFailureDetails(error: unknown): EmbeddingFailureDetails {
  const geminiError = error instanceof GeminiEmbeddingError ? error : undefined;
  return {
    type: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    httpStatus: geminiError?.status,
    retryable: geminiError?.retryable ?? false,
    bodySnippet: geminiError?.bodySnippet,
  };
}

function embeddingFailureCapabilityUpdate(error: unknown, now = new Date().toISOString()): ProviderCapabilityUpdate {
  const details = embeddingFailureDetails(error);
  return {
    lastFailureAt: now,
    lastErrorType: details.type,
    lastHttpStatus: details.httpStatus,
    lastRetryable: details.retryable,
  };
}

function geminiCapabilityKey(config: AppConfig["gemini"], expectedDimensions: number) {
  return providerCapabilityInput({
    provider: "gemini",
    baseUrl: config.baseUrl,
    model: config.model,
    dimensions: expectedDimensions,
    authMode: config.authMode,
  });
}

function embeddingUnavailablePayload(error: unknown) {
  return {
    status: "embedding_unavailable",
    fallbackAvailable: "Use mode=hybrid to allow keyword-only fallback, or use rg/direct file reads for exact strings and known paths.",
    error: embeddingFailureDetails(error),
    recommendedNextActions: [
      "Run gemini_embedding_probe with a short test string.",
      "Verify GEMINI_API_KEY, GEMINI_BASE_URL, GEMINI_AUTH_MODE, and GEMINI_OUTPUT_DIMENSIONALITY.",
      "Use repo_context_pack with mode=hybrid for keyword-only degraded results while embeddings are unavailable.",
      "Use rg/direct file reads for exact strings, known paths, or small targeted checks.",
    ],
  };
}

function buildGeminiDiagnostics(config: AppConfig["gemini"], expectedDimensions: number) {
  const diagnostics: {
    baseUrl: string;
    normalizedBaseUrl?: string;
    endpoint?: string;
    model: string;
    expectedDimensions: number;
    authMode: AppConfig["gemini"]["authMode"];
    hasApiKey: boolean;
    configError?: string;
  } = {
    baseUrl: config.baseUrl,
    model: config.model,
    expectedDimensions,
    authMode: config.authMode,
    hasApiKey: Boolean(config.apiKey),
  };

  try {
    diagnostics.normalizedBaseUrl = normalizeGeminiBaseUrl(config.baseUrl);
    diagnostics.endpoint = buildGeminiEndpoint(config.baseUrl, config.model, "embedContent").toString();
  } catch (error) {
    diagnostics.configError = error instanceof Error ? error.message : String(error);
  }

  return diagnostics;
}

export function registerTools(server: McpServer, config: AppConfig): void {
  const embeddingProvider = new GeminiEmbeddingProvider(config.gemini);
  const expectedDimensions = config.gemini.outputDimensionality ?? 1536;

  server.registerTool(
    "repo_doctor",
    {
      title: "Repo Doctor",
      description: "Run local diagnostics for runtime, native modules, config, WSL interop, and index health without calling embedding APIs.",
      inputSchema: {
        project_path: z.string().optional(),
      },
    },
    async ({ project_path }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      return asJsonText(
        await runRepoDoctor({
          config,
          projectPath,
          expectedDimensions,
        }),
      );
    },
  );

  server.registerTool(
    "repo_index_status",
    {
      title: "Repo Index Status",
      description: "Show Scythe Context configuration and current index status.",
      inputSchema: {
        project_path: z.string().optional(),
      },
    },
    async ({ project_path }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const dbPath = path.join(projectPath, config.indexDirName, "index.sqlite");
      const index = readDetailedIndexStatus(dbPath);
      const freshness = await readIndexFreshness({
        projectPath,
        dbPath,
        limits: { maxFileBytes: config.indexing.maxFileBytes },
      });
      return asJsonText({
        projectPath,
        indexPath: path.join(projectPath, config.indexDirName),
        index,
        recommendedNextActions: recommendedNextActions(index, {
          desiredDimensions: expectedDimensions,
          freshness,
        }),
        freshness,
        status: "usable_mvp",
        implemented: [
          "mcp_server",
          "gemini_embedding_provider",
          "config",
          "file_scanner",
          "chunker",
          "reindex_dry_run",
          "sqlite_schema",
          "persistent_metadata_index",
          "embedding_index_writer",
          "semantic_vector_search",
          "symbol_graph",
          "related_files",
          "context_budgeting",
          "context_packer",
          "multi_hop_related_files",
          "related_snippet_packing",
          "local_code_aware_reranker",
          "provider_capability_cache",
          "repo_doctor",
        ],
        pending: ["tree_sitter_symbols"],
        indexing: config.indexing,
        search: config.search,
        gemini: {
          baseUrl: config.gemini.baseUrl,
          model: config.gemini.model,
          outputDimensionality: config.gemini.outputDimensionality,
          authMode: config.gemini.authMode,
          hasApiKey: Boolean(config.gemini.apiKey),
        },
      });
    },
  );

  server.registerTool(
    "gemini_embedding_probe",
    {
      title: "Gemini Embedding Probe",
      description: "Send one embedding request and return diagnostics for official Gemini or proxy compatibility.",
      inputSchema: {
        text: z.string().min(1),
        project_path: z.string().optional(),
      },
    },
    async ({ text, project_path }) => {
      const startedAt = Date.now();
      const diagnostics = buildGeminiDiagnostics(config.gemini, expectedDimensions);
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const indexPath = path.join(projectPath, config.indexDirName);
      const capabilityKey = geminiCapabilityKey(config.gemini, expectedDimensions);
      const now = new Date().toISOString();

      try {
        const result = await embeddingProvider.embed({ kind: "query", text });
        const dimensionsMatchExpected = result.dimensions === expectedDimensions;
        const capabilities = updateProviderCapability(indexPath, capabilityKey, {
          outputDimensionality: dimensionsMatchExpected ? "supported" : "unsupported",
          lastProbeAt: now,
          lastSuccessAt: now,
        });
        return asJsonText({
          status: "ok",
          latencyMs: Date.now() - startedAt,
          projectPath,
          indexPath,
          diagnostics,
          providerCapabilities: capabilities,
          model: result.model,
          dimensions: result.dimensions,
          dimensionsMatchExpected,
          sample: result.vector.slice(0, 8),
        });
      } catch (error) {
        const capabilities = updateProviderCapability(indexPath, capabilityKey, {
          lastProbeAt: now,
          ...embeddingFailureCapabilityUpdate(error, now),
        });
        const geminiError = error instanceof GeminiEmbeddingError ? error : undefined;
        return asJsonText({
          status: "embedding_probe_failed",
          latencyMs: Date.now() - startedAt,
          projectPath,
          indexPath,
          diagnostics,
          providerCapabilities: capabilities,
          error: {
            type: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
            httpStatus: geminiError?.status,
            retryable: geminiError?.retryable ?? false,
            bodySnippet: geminiError?.bodySnippet,
          },
          recommendedNextActions: [
            "Verify GEMINI_API_KEY is present in the environment Codex launches from.",
            "Verify GEMINI_BASE_URL points to the provider root and can include or omit /v1beta.",
            "Verify GEMINI_AUTH_MODE matches the proxy requirement: x-goog-api-key, bearer, or query.",
            "Verify the provider supports models/{model}:embedContent and the requested output dimensionality.",
          ],
        });
      }
    },
  );

  server.registerTool(
    "repo_reindex",
    {
      title: "Repo Reindex",
      description: "Scan a project, write metadata, and optionally index embeddings.",
      inputSchema: {
        project_path: z.string().optional(),
        dry_run: z.boolean().default(true),
        max_file_bytes: z.number().int().positive().optional(),
        target_chunk_chars: z.number().int().positive().optional(),
        chunk_overlap_chars: z.number().int().nonnegative().optional(),
        max_chunks_per_file: z.number().int().positive().optional(),
        index_embeddings: z.boolean().default(false),
        embedding_batch_size: z.number().int().positive().max(128).optional(),
        max_embedding_chunks: z.number().int().positive().max(10000).optional(),
      },
    },
    async ({
      project_path,
      dry_run,
      max_file_bytes,
      target_chunk_chars,
      chunk_overlap_chars,
      max_chunks_per_file,
      index_embeddings,
      embedding_batch_size,
      max_embedding_chunks,
    }) => {
      const commonOptions = {
        projectPath: path.resolve(project_path || config.defaultProjectPath),
        maxFileBytes: max_file_bytes ?? config.indexing.maxFileBytes,
        targetChunkChars: target_chunk_chars ?? config.indexing.targetChunkChars,
        chunkOverlapChars: chunk_overlap_chars ?? config.indexing.chunkOverlapChars,
        maxChunksPerFile: max_chunks_per_file ?? config.indexing.maxChunksPerFile,
      };

      if (dry_run) {
        return asJsonText(await reindexDryRun(commonOptions));
      }

      const metadataResult = await persistentReindexMetadata({
        ...commonOptions,
        indexDirName: config.indexDirName,
        vectorDimensions: expectedDimensions,
      });

      if (!index_embeddings) {
        return asJsonText(metadataResult);
      }

      const indexPath = path.join(commonOptions.projectPath, config.indexDirName);
      const capabilityKey = geminiCapabilityKey(config.gemini, expectedDimensions);
      const capabilities = findProviderCapability(indexPath, capabilityKey);
      let embeddingResult: Awaited<ReturnType<typeof indexMissingEmbeddings>>;
      let updatedCapabilities = capabilities;
      try {
        embeddingResult = await indexMissingEmbeddings({
          dbPath: metadataResult.dbPath,
          providerName: "gemini",
          providerBaseUrl: config.gemini.baseUrl,
          model: config.gemini.model,
          dimensions: expectedDimensions,
          batchSize: embedding_batch_size ?? config.indexing.embeddingBatchSize,
          maxChunks: max_embedding_chunks ?? config.indexing.maxEmbeddingChunks,
          provider: embeddingProvider,
          capabilities,
          onCapabilitiesUpdated: (update) => {
            updateProviderCapability(indexPath, capabilityKey, update);
          },
        });
        updatedCapabilities = updateProviderCapability(indexPath, capabilityKey, {
          outputDimensionality: "supported",
          lastSuccessAt: new Date().toISOString(),
        });
      } catch (error) {
        updateProviderCapability(indexPath, capabilityKey, embeddingFailureCapabilityUpdate(error));
        throw error;
      }

      return asJsonText({
        ...metadataResult,
        status: "metadata_and_embeddings_indexed",
        embeddings: embeddingResult,
        providerCapabilities: updatedCapabilities,
      });
    },
  );

  server.registerTool(
    "repo_semantic_search",
    {
      title: "Repo Semantic Search",
      description: "Search indexed code chunks by semantic similarity. Requires repo_reindex with index_embeddings=true first.",
      inputSchema: {
        query: z.string().min(1),
        project_path: z.string().optional(),
        max_results: z.number().int().positive().max(50).default(8),
        max_snippet_chars: z.number().int().positive().max(4000).default(1200),
        max_context_chars: z.number().int().positive().max(100000).default(12000),
        mode: z.enum(["hybrid", "semantic"]).default("hybrid"),
      },
    },
    async ({ query, project_path, max_results, max_snippet_chars, max_context_chars, mode }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const dbPath = path.join(projectPath, config.indexDirName, "index.sqlite");
      if (!fs.existsSync(dbPath)) {
        return asJsonText({
          query,
          projectPath,
          status: "index_missing",
          message: "Run repo_reindex with dry_run=false and index_embeddings=true before semantic search.",
        });
      }

      const dimensions = expectedDimensions;
      let effectiveMode: EffectiveSearchMode = mode;
      let fallback:
        | {
            reason: "embedding_unavailable";
            fromMode: SearchMode;
            toMode: "keyword";
            error: EmbeddingFailureDetails;
          }
        | undefined;
      let rawResults: FormattableSearchResult[];

      try {
        const queryEmbedding = await embeddingProvider.embed({ kind: "query", text: query });
        if (queryEmbedding.dimensions !== dimensions) {
          throw new Error(`Query embedding dimensions mismatch: expected ${dimensions}, got ${queryEmbedding.dimensions}`);
        }
        rawResults = searchIndexedChunks({
          dbPath,
          query,
          dimensions,
          queryVector: queryEmbedding.vector,
          maxResults: max_results,
          maxSnippetChars: max_snippet_chars,
          mode,
          rerankMode: config.search.rerankMode,
        });
      } catch (error) {
        if (mode === "semantic") {
          return asJsonText({
            query,
            projectPath,
            dbPath,
            dimensions,
            mode,
            ...embeddingUnavailablePayload(error),
          });
        }

        effectiveMode = "keyword";
        fallback = {
          reason: "embedding_unavailable",
          fromMode: mode,
          toMode: "keyword",
          error: embeddingFailureDetails(error),
        };
        rawResults = searchKeywordOnlyChunks({
          dbPath,
          query,
          maxResults: max_results,
          maxSnippetChars: max_snippet_chars,
          rerankMode: config.search.rerankMode,
        });
      }

      const formatted = formatSearchResults(query, rawResults, { maxContextChars: max_context_chars });

      return asJsonText({
        query,
        projectPath,
        dbPath,
        dimensions,
        mode,
        effectiveMode,
        rerankMode: config.search.rerankMode,
        rerankApplied: rerankApplied(effectiveMode, config.search.rerankMode),
        fallback,
        results: formatted.results,
        context: formatted.summary,
        resultCount: rawResults.length,
      });
    },
  );

  server.registerTool(
    "repo_related_files",
    {
      title: "Repo Related Files",
      description: "Show symbols, imports, and reverse imports for an indexed file.",
      inputSchema: {
        path: z.string().min(1),
        project_path: z.string().optional(),
        max_results: z.number().int().positive().max(100).default(24),
      },
    },
    async ({ path: filePath, project_path, max_results }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const dbPath = path.join(projectPath, config.indexDirName, "index.sqlite");
      if (!fs.existsSync(dbPath)) {
        return asJsonText({
          path: filePath,
          projectPath,
          status: "index_missing",
          message: "Run repo_reindex with dry_run=false before related file lookup.",
        });
      }

      return asJsonText({
        projectPath,
        dbPath,
        ...readRelatedFiles({
          dbPath,
          filePath,
          maxResults: max_results,
        }),
      });
    },
  );

  server.registerTool(
    "repo_context_pack",
    {
      title: "Repo Context Pack",
      description: "Search code and package primary snippets with symbols/imports/reverse imports for matched files.",
      inputSchema: {
        query: z.string().min(1),
        project_path: z.string().optional(),
        max_results: z.number().int().positive().max(30).default(6),
        max_snippet_chars: z.number().int().positive().max(4000).default(1200),
        max_context_chars: z.number().int().positive().max(100000).default(16000),
        max_seed_files: z.number().int().positive().max(10).default(3),
        max_related_files: z.number().int().nonnegative().max(30).default(10),
        max_related_items: z.number().int().positive().max(50).default(8),
        include_related_snippets: z.boolean().default(false),
        max_related_snippets_per_file: z.number().int().positive().max(5).default(1),
        max_related_snippet_chars: z.number().int().positive().max(2000).default(600),
        max_related_context_chars: z.number().int().nonnegative().max(50000).default(4000),
        related_depth: z.number().int().nonnegative().max(3).default(1),
        mode: z.enum(["hybrid", "semantic"]).default("hybrid"),
      },
    },
    async ({
      query,
      project_path,
      max_results,
      max_snippet_chars,
      max_context_chars,
      max_seed_files,
      max_related_files,
      max_related_items,
      include_related_snippets,
      max_related_snippets_per_file,
      max_related_snippet_chars,
      max_related_context_chars,
      related_depth,
      mode,
    }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const dbPath = path.join(projectPath, config.indexDirName, "index.sqlite");
      if (!fs.existsSync(dbPath)) {
        return asJsonText({
          query,
          projectPath,
          status: "index_missing",
          message: "Run repo_reindex with dry_run=false and index_embeddings=true before building a context pack.",
        });
      }

      const dimensions = expectedDimensions;
      let effectiveMode: EffectiveSearchMode = mode;
      let fallback:
        | {
            reason: "embedding_unavailable";
            fromMode: SearchMode;
            toMode: "keyword";
            error: EmbeddingFailureDetails;
          }
        | undefined;
      let rawResults: FormattableSearchResult[];

      try {
        const queryEmbedding = await embeddingProvider.embed({ kind: "query", text: query });
        if (queryEmbedding.dimensions !== dimensions) {
          throw new Error(`Query embedding dimensions mismatch: expected ${dimensions}, got ${queryEmbedding.dimensions}`);
        }
        rawResults = searchIndexedChunks({
          dbPath,
          query,
          dimensions,
          queryVector: queryEmbedding.vector,
          maxResults: max_results,
          maxSnippetChars: max_snippet_chars,
          mode,
          rerankMode: config.search.rerankMode,
        });
      } catch (error) {
        if (mode === "semantic") {
          return asJsonText({
            query,
            projectPath,
            dbPath,
            dimensions,
            mode,
            ...embeddingUnavailablePayload(error),
          });
        }

        effectiveMode = "keyword";
        fallback = {
          reason: "embedding_unavailable",
          fromMode: mode,
          toMode: "keyword",
          error: embeddingFailureDetails(error),
        };
        rawResults = searchKeywordOnlyChunks({
          dbPath,
          query,
          maxResults: max_results,
          maxSnippetChars: max_snippet_chars,
          rerankMode: config.search.rerankMode,
        });
      }
      const relatedPaths = Array.from(new Set(rawResults.map((result) => result.path))).slice(
        0,
        Math.min(max_seed_files, max_related_files),
      );
      const relatedFiles = readRelatedFileGraph({
        dbPath,
        seedPaths: relatedPaths,
        maxDepth: related_depth,
        maxFiles: max_related_files,
        maxResultsPerFile: max_related_items,
      });
      const primaryPathSet = new Set(rawResults.map((result) => result.path));
      const relatedSnippetPaths = relatedFiles
        .map((file) => file.path)
        .filter((filePath) => !primaryPathSet.has(filePath));
      const relatedSnippets =
        include_related_snippets && max_related_context_chars > 0
          ? readRelatedSnippets({
              dbPath,
              paths: relatedSnippetPaths,
              maxSnippetsPerFile: max_related_snippets_per_file,
              maxSnippetChars: max_related_snippet_chars,
              maxRelatedContextChars: max_related_context_chars,
            })
          : undefined;
      const pack = buildContextPack(query, rawResults, relatedFiles, {
        maxContextChars: max_context_chars,
        maxRelatedFiles: max_related_files,
        maxRelatedItems: max_related_items,
        relatedSnippets,
      });

      return asJsonText({
        query,
        projectPath,
        dbPath,
        dimensions,
        mode,
        effectiveMode,
        rerankMode: config.search.rerankMode,
        rerankApplied: rerankApplied(effectiveMode, config.search.rerankMode),
        fallback,
        relatedDepth: related_depth,
        relatedSeedCount: relatedPaths.length,
        includeRelatedSnippets: include_related_snippets,
        ...pack,
      });
    },
  );
}
