#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_VERSION, parseCliArgs, renderHelp } from "./cli.js";
import { loadConfig } from "./config.js";
import { registerTools } from "./tools/registerTools.js";

const cliCommand = parseCliArgs(process.argv.slice(2));
if (cliCommand.kind === "help") {
  console.log(renderHelp());
  process.exit(0);
}
if (cliCommand.kind === "version") {
  console.log(PACKAGE_VERSION);
  process.exit(0);
}
if (cliCommand.kind === "error") {
  console.error(cliCommand.message);
  console.error("Run `scythe-context-mcp --help` for usage.");
  process.exit(1);
}

const config = loadConfig();

const server = new McpServer(
  {
    name: "scythe-context-mcp",
    version: PACKAGE_VERSION,
  },
  {
    instructions:
      "Scythe Context is a token-efficient code-context MCP server for Codex. Start with repo_index_status. For unknown files or code-intent lookup, use repo_context_pack(response_mode=paths_only) first, then read exact files/ranges; use compact when short snippets help and snippets only for ranking/debug detail. Use rg/direct reads for exact strings, known paths, or small checks. Run repo_reindex(dry_run=false) only if metadata is missing/stale. Set index_embeddings=true only when semantic vectors are needed; chunk text goes to the configured endpoint.",
  },
);

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
