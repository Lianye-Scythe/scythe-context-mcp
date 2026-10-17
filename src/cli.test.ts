import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION, parseCliArgs, renderHelp } from "./cli.js";
import packageJson from "../package.json" with { type: "json" };

describe("CLI helpers", () => {
  it("starts the MCP server when no CLI flags are provided", () => {
    expect(parseCliArgs([])).toEqual({ kind: "serve" });
  });

  it("recognizes help and version flags", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("matches package.json version", () => {
    expect(PACKAGE_VERSION).toBe(packageJson.version);
  });

  it("rejects unknown flags before starting stdio", () => {
    expect(parseCliArgs(["--bad"])).toEqual({ kind: "error", message: "Unknown option: --bad" });
  });

  it("uses a help default for the CLI alias and accepts explicit MCP startup", () => {
    expect(parseCliArgs([], "help")).toEqual({ kind: "help" });
    expect(parseCliArgs(["serve"])).toEqual({ kind: "serve" });
  });

  it("keeps CLI searches local and bounded unless requested otherwise", () => {
    expect(parseCliArgs(["context", "auth token", "--project=/repo", "--max-results", "3", "--json"])).toEqual({
      kind: "operation", command: "context", input: { query: "auth token", project_path: "/repo", mode: "keyword", response_mode: "paths_only", max_results: 3 }, json: true,
    });
    expect(parseCliArgs(["index"])).toMatchObject({ input: { dry_run: false } });
    expect(parseCliArgs(["search", "--", "--query"])).toMatchObject({ input: { query: "--query" } });
    expect(parseCliArgs(["context", "query", "--format", "paths"])).toMatchObject({ input: { response_mode: "paths_only" } });
  });

  it.each([
    ["search"], ["search", ""], ["search", "a", "b"], ["status", "extra"],
    ["status", "--mode", "keyword"], ["index", "--dry-run", "--embeddings"],
    ["search", "query", "--max-results", "1.5"], ["search", "query", "--project"],
    ["search", "query", "--project", "--json"], ["related", "auth.ts", "--embeddings"],
  ])("rejects malformed arguments %j", (...args) => {
    expect(parseCliArgs(args).kind).toBe("error");
  });

  it("renders smoke-test friendly help text", () => {
    const help = renderHelp();

    expect(help).toContain(`Scythe Context MCP ${PACKAGE_VERSION}`);
    expect(help).toContain("scythe-context-mcp --version");
    expect(help).toContain("PWD");
    expect(help).toContain("SCYTHE_CONTEXT_DEFAULT_PROJECT");
  });
});
