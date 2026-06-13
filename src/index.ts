#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools/registerTools.js";

const config = loadConfig();

const server = new McpServer(
  {
    name: "scythe-context-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "Scythe Context is a local code-context MCP server for Codex. Use repo_index_status first, repo_reindex(dry_run=false) when metadata is missing or stale, and repo_context_pack for task lookup. Only set index_embeddings=true when semantic vectors are needed because chunk text is sent to the configured embedding endpoint. Keep max_context_chars and max_related_context_chars bounded. Use repo_semantic_search for ranking/debugging and repo_related_files for a focused file graph.",
  },
);

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
