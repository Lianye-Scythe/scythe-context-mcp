import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "../config.js";
import { createOperations } from "../core/operations.js";

export function registerTools(server: McpServer, config: AppConfig): void {
  for (const [name, operation] of Object.entries(createOperations(config))) {
    server.registerTool(name, {
      title: operation.title,
      description: operation.description,
      inputSchema: operation.inputSchema,
    }, async (input) => {
      const payload = await operation.run(input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        ...(name === "repo_reindex" && payload.status === "embedding_unavailable" ? { isError: true } : {}),
      };
    });
  }
}
