import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PACKAGE_VERSION } from "./cli.js";
import type { AppConfig } from "./config.js";
import { registerTools } from "./tools/registerTools.js";

export async function startMcpServer(config: AppConfig): Promise<void> {
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
}
