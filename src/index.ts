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
      "Scythe Context finds code and related files. Check repo_index_status; reindex metadata only if missing/stale. For unknown locations use repo_context_pack (defaults to paths_only), then read exact ranges. Use mode=keyword for local search without embedding requests; hybrid/semantic send queries to the endpoint. Set index_embeddings=true only when vectors are needed; this sends chunk text. Use compact for short snippets, snippets for ranking/debug, and rg/direct reads for exact strings or known paths.",
  },
);

registerTools(server, config);

const transport = new StdioServerTransport();
await server.connect(transport);
