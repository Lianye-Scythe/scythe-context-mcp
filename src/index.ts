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
      "Repo Beacon is a local code-context MCP server. Use repo_index_status first, then repo_semantic_search for exploratory code lookup. Semantic search is currently scaffolded while indexing is being implemented.",
  },
);

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
