import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "../config.js";
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
      return asJsonText({
        projectPath,
        indexPath: path.join(projectPath, config.indexDirName),
        status: "scaffolded",
        implemented: ["mcp_server", "gemini_embedding_provider", "config"],
        pending: ["file_scanner", "chunker", "vector_store", "hybrid_ranker"],
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
    "repo_semantic_search",
    {
      title: "Repo Semantic Search",
      description: "Planned semantic code search endpoint. Currently returns scaffold status.",
      inputSchema: {
        query: z.string().min(1),
        project_path: z.string().optional(),
        max_results: z.number().int().positive().max(50).default(8),
      },
    },
    async ({ query, project_path, max_results }) => {
      const projectPath = path.resolve(project_path || config.defaultProjectPath);
      return asJsonText({
        query,
        projectPath,
        maxResults: max_results,
        status: "not_implemented_yet",
        nextImplementationStep: "Build file scanner, chunker, and local vector store before returning code ranges.",
      });
    },
  );
}

