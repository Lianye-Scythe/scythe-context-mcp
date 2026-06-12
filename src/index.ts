#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools/registerTools.js";

const config = loadConfig();

const server = new McpServer(
  {
    name: "repo-beacon-mcp",
    version: "0.1.0",
  },
  {
    instructions:
      "Repo Beacon is a local code-context MCP server. Use repo_index_status first. If the index is missing or stale, run repo_reindex with dry_run=false; add index_embeddings=true only when semantic vectors are needed. Prefer repo_context_pack for task-oriented lookup because it combines hybrid search with symbols, imports, reverse imports, suggested paths, and max_context_chars budgeting. Use repo_semantic_search for raw search debugging and repo_related_files to inspect a specific matched file.",
  },
);

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
