import type { OperationName } from "./core/operations.js";

export const PACKAGE_VERSION = "0.1.17";

export const CLI_OPERATIONS = {
  status: "repo_index_status",
  index: "repo_reindex",
  search: "repo_semantic_search",
  context: "repo_context_pack",
  related: "repo_related_files",
  doctor: "repo_doctor",
} as const satisfies Record<string, OperationName>;

export type CliOperation = keyof typeof CLI_OPERATIONS;
export type CliCommand =
  | { kind: "serve" }
  | { kind: "help"; command?: CliOperation }
  | { kind: "version" }
  | { kind: "error"; message: string }
  | { kind: "operation"; command: CliOperation; input: Record<string, unknown>; json: boolean; output?: string };

const commonOptions = { project: "project_path", format: "response_mode" };
const searchOptions = {
  mode: "mode", "max-results": "max_results", "max-context-chars": "max_context_chars",
  "max-snippet-chars": "max_snippet_chars",
};
const numberOptions = new Set([
  "max_results", "max_context_chars", "max_snippet_chars", "related_depth", "max_related_files",
  "max_related_context_chars", "max_file_bytes", "target_chunk_chars", "chunk_overlap_chars",
  "max_chunks_per_file", "embedding_batch_size", "max_embedding_chunks",
]);
const commandOptions: Record<CliOperation, Record<string, string>> = {
  status: {}, doctor: {}, related: { "max-results": "max_results" },
  search: searchOptions,
  context: {
    ...searchOptions, "related-depth": "related_depth", "max-related-files": "max_related_files",
    "max-related-context-chars": "max_related_context_chars",
  },
  index: {
    "max-file-bytes": "max_file_bytes", "target-chunk-chars": "target_chunk_chars",
    "chunk-overlap-chars": "chunk_overlap_chars", "max-chunks-per-file": "max_chunks_per_file",
    "embedding-batch-size": "embedding_batch_size", "max-embedding-chunks": "max_embedding_chunks",
  },
};

export function parseCliArgs(args: string[], defaultKind: "serve" | "help" = "serve"): CliCommand {
  if (args.length === 0) return { kind: defaultKind };
  const [first, ...rest] = args;
  if (first === "--help" || first === "-h") return { kind: "help" };
  if (first === "--version" || first === "-v") return { kind: "version" };
  if (first === "serve" && rest.length === 0) return { kind: "serve" };
  if (!Object.hasOwn(CLI_OPERATIONS, first)) return { kind: "error", message: `Unknown option: ${first}` };
  const command = first as CliOperation;
  const input: Record<string, unknown> = {};
  if (command === "search" || command === "context") {
    input.mode = "keyword";
    input.response_mode = "paths_only";
  }
  if (command === "index") input.dry_run = false;
  let json = false;
  let output: string | undefined;
  const positional: string[] = [];
  const options: Record<string, string> = { ...commonOptions, ...commandOptions[command] };
  try {
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i];
      if (token === "--") { positional.push(...rest.slice(i + 1)); break; }
      if (token === "--help" || token === "-h") return { kind: "help", command };
      if (!token.startsWith("-")) { positional.push(token); continue; }
      if (token === "--json") { json = true; continue; }
      if (command === "index" && token === "--dry-run") { input.dry_run = true; continue; }
      if (command === "index" && token === "--embeddings") { input.index_embeddings = true; continue; }
      if (command === "context" && token === "--related-snippets") { input.include_related_snippets = true; continue; }
      const equals = token.indexOf("=");
      const option = (equals < 0 ? token : token.slice(0, equals)).replace(/^--/, "");
      if (!Object.hasOwn(options, option) && option !== "output") throw new Error(`Unknown option for ${command}: ${token}`);
      const value = equals < 0 ? rest[++i] : token.slice(equals + 1);
      if (!value || (equals < 0 && value.startsWith("--"))) throw new Error(`--${option} requires a value`);
      if (option === "output") { output = value; continue; }
      const key = options[option];
      if (numberOptions.has(key)) {
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`--${option} requires an integer`);
        input[key] = Number(value);
      } else input[key] = key === "response_mode" && value === "paths" ? "paths_only" : value;
    }
    const requiresArgument = command === "search" || command === "context" || command === "related";
    if (positional.length !== (requiresArgument ? 1 : 0)) {
      throw new Error(requiresArgument ? `${command} requires exactly one ${command === "related" ? "file path" : "query"} (quote text containing spaces)` : `${command} does not accept positional arguments`);
    }
    if (requiresArgument) {
      if (!positional[0].trim()) throw new Error(`${command} requires a non-empty argument`);
      input[command === "related" ? "path" : "query"] = positional[0];
    }
    if (input.dry_run && input.index_embeddings) throw new Error("--embeddings cannot be combined with --dry-run");
    return { kind: "operation", command, input, json, ...(output ? { output } : {}) };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function renderHelp(command?: CliOperation): string {
  return `Scythe Context MCP ${PACKAGE_VERSION}

Local code context through CLI commands or an MCP stdio server.

Usage:
  scythe-context status                         Check index freshness
  scythe-context index [--dry-run] [--embeddings] Refresh the index
  scythe-context search "query"                  Find paths and line ranges
  scythe-context context "query"                 Include related files
  scythe-context related <file>                  Show symbols and imports
  scythe-context doctor                         Diagnose local setup
  scythe-context-mcp                             Start the MCP stdio server
  scythe-context-mcp --version

Options for all commands:
  --project <path>          Override the configured project (default: cwd)
  --format <mode>           paths, compact, snippets for search/context;
                            compact or full for status/index/related/doctor
  --json                   Print structured JSON instead of concise text
  --output <file>          Save the structured JSON to a file; print its path
  --help, -h               Show help
  --version, -v            Show package version

Search/context options:
  --mode <mode>            keyword (default), hybrid, semantic
  --max-results <n>        Limit returned matches
  --max-context-chars <n>  Primary snippet budget
  --max-snippet-chars <n>  Per-result snippet limit

Context options:
  --related-depth <n>      Import traversal depth (0-3)
  --max-related-files <n>  Limit related files
  --related-snippets       Include related code snippets
  --max-related-context-chars <n>  Related snippet budget

Index options:
  --dry-run                Preview without writing
  --embeddings             Send indexed chunks to the embedding endpoint
  --max-file-bytes <n>     Limit indexed file size
  --target-chunk-chars <n> Target chunk size
  --chunk-overlap-chars <n>  Chunk overlap
  --max-chunks-per-file <n>  Chunk limit per file
  --embedding-batch-size <n>  Provider batch size
  --max-embedding-chunks <n>  Embedding job limit

Related options:
  --max-results <n>        Limit symbols and imports (full format)

${command ? `Selected command: ${command}\n\n` : ""}CLI search/context default to local keyword lookup and paths-only output.
Hybrid/semantic queries and index --embeddings send text to the configured endpoint.
MCP retains its existing defaults. No arguments start MCP on scythe-context-mcp;
scythe-context with no arguments shows help. Use -- before a query starting with -.

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
  GEMINI_REQUEST_TIMEOUT_MS       Per-request deadline including response body, default 10000
  SCYTHE_CONTEXT_RERANK_MODE      auto or off, default auto
  SCYTHE_CONTEXT_STRUCTURE_EXTRACTOR  regex or tree-sitter, default regex
  SCYTHE_CONTEXT_TREE_SITTER_GRAMMAR_DIR  Optional directory containing grammar .wasm files
`;
}
