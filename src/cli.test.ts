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

  it("renders smoke-test friendly help text", () => {
    const help = renderHelp();

    expect(help).toContain(`Scythe Context MCP ${PACKAGE_VERSION}`);
    expect(help).toContain("scythe-context-mcp --version");
    expect(help).toContain("PWD");
    expect(help).toContain("SCYTHE_CONTEXT_DEFAULT_PROJECT");
  });
});
