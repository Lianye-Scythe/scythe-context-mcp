export const PACKAGE_VERSION = "0.1.5";

export type CliCommand =
  | { kind: "serve" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "error"; message: string };

export function parseCliArgs(args: string[]): CliCommand {
  if (args.length === 0) return { kind: "serve" };

  const [first] = args;
  if (first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v") return { kind: "version" };

  return { kind: "error", message: `Unknown option: ${first}` };
}

export function renderHelp(): string {
  return `Scythe Context MCP ${PACKAGE_VERSION}

Local code-context MCP server for Codex App / CLI.

Usage:
  scythe-context-mcp          Start the MCP stdio server
  scythe-context-mcp --help   Show this help
  scythe-context-mcp --version

Common Codex MCP config:
  [mcp_servers.scythe_context]
  command = "npx"
  args = ["-y", "scythe-context-mcp"]
  env_vars = ["GEMINI_API_KEY"]

Environment:
  PWD                             Workspace path used when no explicit project is configured
  SCYTHE_CONTEXT_DEFAULT_PROJECT  Optional fixed default project override
  GEMINI_API_KEY                  Gemini or Gemini-compatible API key
  GEMINI_BASE_URL                 Gemini-compatible base URL, default https://generativelanguage.googleapis.com/v1beta
  GEMINI_OUTPUT_DIMENSIONALITY    Embedding dimensions, default 1536
`;
}
