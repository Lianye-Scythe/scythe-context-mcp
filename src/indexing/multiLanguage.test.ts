import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { registerTools } from "../tools/registerTools.js";
import { persistentReindexMetadata } from "./indexWriter.js";
import { readRelatedFileGraph, readRelatedFiles } from "./relatedFiles.js";

const fixtures = fileURLToPath(new URL("../../fixtures/languages/", import.meta.url));
const cli = fileURLToPath(new URL("../command.ts", import.meta.url));
const exec = promisify(execFile);
const tempDirs: string[] = [];

async function project(language: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `scythe-${language}-`));
  tempDirs.push(directory);
  await fs.cp(path.join(fixtures, language), directory, { recursive: true });
  return directory;
}

function reindex(projectPath: string) {
  return persistentReindexMetadata({ projectPath, indexDirName: ".scythe-context", vectorDimensions: 3 });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const cases = [
  { language: "python", query: "validate_token", path: "src/shop/auth.py", symbol: "validate_token", line: 1, importer: "src/shop/service.py", module: ".auth", importLine: 1, next: "src/shop/storage.py", ignored: ".venv/generated.py" },
  { language: "go", query: "ValidateToken", path: "internal/auth/token.go", symbol: "ValidateToken", line: 5, importer: "cmd/server/main.go", module: "example.com/shop/internal/auth", importLine: 5, next: "internal/store/store.go", ignored: "vendor/generated.go" },
  { language: "rust", query: "validate_token", path: "src/auth/mod.rs", symbol: "validate_token", line: 4, importer: "src/auth/token.rs", module: "super::validate_token", importLine: 1, next: "src/storage.rs", ignored: "target/generated.rs" },
];

describe("multi-language repository workflow", () => {
  it.each(cases)("indexes, navigates, and searches $language through CLI and MCP", async (example) => {
    const projectPath = await project(example.language);
    const ignored = path.join(projectPath, example.ignored);
    await fs.mkdir(path.dirname(ignored), { recursive: true });
    await fs.writeFile(ignored, "generated build artifact\n");
    const result = await reindex(projectPath);
    const relations = readRelatedFiles({ dbPath: result.dbPath, filePath: example.path, maxResults: 30 });
    expect(relations.symbols).toContainEqual(expect.objectContaining({ name: example.symbol, line: example.line }));
    expect(relations.importedBy).toContainEqual({ path: example.importer, specifier: example.module, line: example.importLine });
    const graph = readRelatedFileGraph({ dbPath: result.dbPath, seedPaths: [example.importer], maxDepth: 2, maxFiles: 20, maxResultsPerFile: 30 });
    expect(graph.map((node) => node.path)).toContain(example.next);
    const db = new Database(result.dbPath, { readonly: true });
    try {
      expect(db.prepare("select path from files where path = ?").get(example.ignored)).toBeUndefined();
    } finally { db.close(); }

    const config = loadConfig();
    config.defaultProjectPath = projectPath;
    config.indexDirName = ".scythe-context";
    config.gemini.outputDimensionality = 3;
    const server = new McpServer({ name: "language-test", version: "1.0.0" });
    registerTools(server, config);
    const client = new Client({ name: "language-test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const mcp = await client.callTool({ name: "repo_context_pack", arguments: { query: example.query, mode: "keyword", response_mode: "compact" } });
      expect(mcp.isError).not.toBe(true);
      const payload = JSON.parse((mcp.content as Array<{ text: string }>)[0].text);
      const { stdout } = await exec(process.execPath, ["--import", import.meta.resolve("tsx"), cli, "context", example.query, "--project", projectPath, "--format", "compact", "--json"], {
        cwd: projectPath, env: { ...process.env, SCYTHE_CONTEXT_INDEX_DIR: ".scythe-context", GEMINI_OUTPUT_DIMENSIONALITY: "3" }, timeout: 10000,
      });
      expect(JSON.parse(stdout)).toEqual(payload);
      expect(payload.primaryResults[0].path).toBe(example.path);
      const match = payload.primaryResults.find((item: { path: string }) => item.path === example.path);
      expect(match).toBeDefined();
      expect(match.startLine).toBeLessThanOrEqual(example.line);
      expect(match.endLine).toBeGreaterThanOrEqual(example.line);
      expect(match.snippet).toContain(example.symbol);
    } finally { await client.close(); await server.close(); }
  });
  it("rebuilds Go package edges after manifest changes without replacing unchanged chunks", async () => {
    const projectPath = await project("go");
    const result = await reindex(projectPath);
    const chunkIds = () => {
      const db = new Database(result.dbPath, { readonly: true });
      try { return db.prepare("select chunks.id from chunks join files on files.id = chunks.file_id where files.path = ? order by chunks.id").all("cmd/server/main.go"); }
      finally { db.close(); }
    };
    const ids = chunkIds();
    const related = () => readRelatedFiles({ dbPath: result.dbPath, filePath: "cmd/server/main.go", maxResults: 30 });
    const localImports = () => related().imports.filter((item) => item.specifier === "example.com/shop/internal/auth");
    expect(localImports().map((item) => item.resolvedPath)).toEqual(["internal/auth/session.go", "internal/auth/token.go"]);
    expect(related().imports.filter((item) => item.specifier === "fmt" || item.specifier === "example.org/telemetry").every((item) => item.resolvedPath === null)).toBe(true);
    await fs.writeFile(path.join(projectPath, "go.mod"), "module example.com/renamed\n\ngo 1.24\n");
    await reindex(projectPath);
    expect(localImports()).toEqual([{ specifier: "example.com/shop/internal/auth", resolvedPath: null, line: 5 }]);
    expect(chunkIds()).toEqual(ids);
    await fs.writeFile(path.join(projectPath, "go.mod"), "module example.com/shop\n\ngo 1.24\n");
    await fs.rm(path.join(projectPath, "internal/auth/session.go"));
    await reindex(projectPath);
    expect(localImports().map((item) => item.resolvedPath)).toEqual(["internal/auth/token.go"]);
    expect(chunkIds()).toEqual(ids);
  });

});
