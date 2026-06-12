import path from "node:path";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { reindexDryRun } from "../indexing/dryRun.js";
import { indexMissingEmbeddings } from "../indexing/embeddingWriter.js";
import { searchHybrid } from "../indexing/hybridSearch.js";
import { readDetailedIndexStatus } from "../indexing/indexStatus.js";
import { persistentReindexMetadata } from "../indexing/indexWriter.js";
import { readRelatedFiles } from "../indexing/relatedFiles.js";
import { formatSearchResults, type FormattableSearchResult } from "../indexing/resultFormat.js";
import { searchByVector } from "../indexing/semanticSearch.js";
import { GeminiEmbeddingProvider } from "../providers/gemini.js";

function asJsonText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

export function registerTools(server: McpServer, config: AppConfig): void {
  const embeddingProvider = new GeminiEmbeddingProvider(config.gemini);

  server.registerTool(
    "repo_index_status",
    {
      title: "Repo Index Status",
      description: "Show Repo Beacon configuration and current index status.",
      inputSchema: {
        project_path: z.string().optional(),
      },
    },
    async ({ project_path }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      const dbPath = path.join(projectPath, config.indexDirName, "index.sqlite");
      return asJsonText({
        projectPath,
        indexPath: path.join(projectPath, config.indexDirName),
        index: readDetailedIndexStatus(dbPath),
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
        ],
        pending: ["context_packer", "multi_hop_related_files", "tree_sitter_symbols"],
        indexing: config.indexing,
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
      description: "Send one embedding request to verify official Gemini or proxy compatibility.",
      inputSchema: {
        text: z.string().min(1),
      },
    },
    async ({ text }) => {
      const result = await embeddingProvider.embed({ kind: "query", text });
      return asJsonText({
        model: result.model,
        dimensions: result.dimensions,
        sample: result.vector.slice(0, 8),
      });
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
        vectorDimensions: config.gemini.outputDimensionality ?? 1536,
      });

      if (!index_embeddings) {
        return asJsonText(metadataResult);
      }

      const embeddingResult = await indexMissingEmbeddings({
        dbPath: metadataResult.dbPath,
        providerName: "gemini",
        providerBaseUrl: config.gemini.baseUrl,
        model: config.gemini.model,
        dimensions: config.gemini.outputDimensionality ?? 1536,
        batchSize: embedding_batch_size ?? config.indexing.embeddingBatchSize,
        maxChunks: max_embedding_chunks ?? config.indexing.maxEmbeddingChunks,
        provider: embeddingProvider,
      });

      return asJsonText({
        ...metadataResult,
        status: "metadata_and_embeddings_indexed",
        embeddings: embeddingResult,
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

      const queryEmbedding = await embeddingProvider.embed({ kind: "query", text: query });
      const dimensions = config.gemini.outputDimensionality ?? 1536;
      if (queryEmbedding.dimensions !== dimensions) {
        throw new Error(`Query embedding dimensions mismatch: expected ${dimensions}, got ${queryEmbedding.dimensions}`);
      }

      const rawResults: FormattableSearchResult[] =
        mode === "semantic"
          ? searchByVector({
              dbPath,
              dimensions,
              queryVector: queryEmbedding.vector,
              maxResults: max_results,
              maxSnippetChars: max_snippet_chars,
            })
          : searchHybrid({
              dbPath,
              query,
              dimensions,
              queryVector: queryEmbedding.vector,
              maxResults: max_results,
              maxSnippetChars: max_snippet_chars,
            });

      const formatted = formatSearchResults(query, rawResults, { maxContextChars: max_context_chars });

      return asJsonText({
        query,
        projectPath,
        dbPath,
        dimensions,
        mode,
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
}
