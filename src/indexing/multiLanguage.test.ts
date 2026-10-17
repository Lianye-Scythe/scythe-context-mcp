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
  { language: "cpp", query: "validate_token", path: "src/auth.hpp", symbol: "validate_token", line: 4, importer: "src/checkout.cpp", module: "auth.hpp", importLine: 1, next: "src/storage.hpp", ignored: "build/generated.cpp" },
  { language: "python", query: "validate_token", path: "src/shop/auth.py", symbol: "validate_token", line: 1, importer: "src/shop/service.py", module: ".auth", importLine: 1, next: "src/shop/storage.py", ignored: ".venv/generated.py" },
  { language: "go", query: "ValidateToken", path: "internal/auth/token.go", symbol: "ValidateToken", line: 5, importer: "cmd/server/main.go", module: "example.com/shop/internal/auth", importLine: 5, next: "internal/store/store.go", ignored: "vendor/generated.go" },
  { language: "rust", query: "validate_token", path: "src/auth/mod.rs", symbol: "validate_token", line: 4, importer: "src/auth/token.rs", module: "super::validate_token", importLine: 1, next: "src/storage.rs", ignored: "target/generated.rs" },
  { language: "csharp", query: "ValidateToken", path: "src/Shop.Core/TokenValidator.cs", symbol: "ValidateToken", line: 6, importer: "src/Shop.Api/Shop.Api.csproj", module: "..\\Shop.Core\\Shop.Core.csproj", importLine: 3, next: "src/Shop.Storage/Shop.Storage.csproj", navigationPath: "src/Shop.Core/Shop.Core.csproj", ignored: "src/Shop.Core/obj/Generated.cs" },
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
    const navigation = example.navigationPath ? readRelatedFiles({ dbPath: result.dbPath, filePath: example.navigationPath, maxResults: 30 }) : relations;
    expect(navigation.importedBy).toContainEqual({ path: example.importer, specifier: example.module, line: example.importLine });
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

  it("refreshes C++ include edges after target removal and preserves unchanged chunks", async () => {
    const projectPath = await project("cpp");
    const result = await reindex(projectPath);
    const related = () => readRelatedFiles({ dbPath: result.dbPath, filePath: "src/checkout.cpp", maxResults: 30 });
    const chunkIds = () => {
      const db = new Database(result.dbPath, { readonly: true });
      try { return db.prepare("select chunks.id from chunks join files on files.id = chunks.file_id where files.path = ? order by chunks.id").all("src/checkout.cpp"); }
      finally { db.close(); }
    };
    const ids = chunkIds();
    expect(related().imports).toEqual([
      { specifier: "auth.hpp", line: 1, resolvedPath: "src/auth.hpp" },
      { specifier: "string", line: 2, resolvedPath: null },
    ]);
    await fs.rm(path.join(projectPath, "src/auth.hpp"));
    await reindex(projectPath);
    expect(related().imports.every((item) => item.resolvedPath === null)).toBe(true);
    expect(chunkIds()).toEqual(ids);
  });

  it("retains C# using hints and refreshes project edges without replacing unchanged source chunks", async () => {
    const projectPath = await project("csharp");
    const result = await reindex(projectPath);
    const related = (filePath: string) => readRelatedFiles({ dbPath: result.dbPath, filePath, maxResults: 30 });
    expect(related("src/Shop.Core/TokenValidator.cs").imports).toEqual([
      { specifier: "System", line: 1, resolvedPath: null }, { specifier: "Shop.Storage", line: 2, resolvedPath: null },
    ]);
    const chunkIds = () => {
      const db = new Database(result.dbPath, { readonly: true });
      try { return db.prepare("select chunks.id from chunks join files on files.id = chunks.file_id where files.path = ? order by chunks.id").all("src/Shop.Core/TokenValidator.cs"); }
      finally { db.close(); }
    };
    const ids = chunkIds();
    expect(related("src/Shop.Core/Shop.Core.csproj").imports[0].resolvedPath).toBe("src/Shop.Storage/Shop.Storage.csproj");
    await fs.rm(path.join(projectPath, "src/Shop.Storage/Shop.Storage.csproj"));
    await reindex(projectPath);
    expect(related("src/Shop.Core/Shop.Core.csproj").imports).toEqual([
      { specifier: "../Shop.Storage/Shop.Storage.csproj", resolvedPath: null, line: 3 },
    ]);
    expect(chunkIds()).toEqual(ids);
  });

});
