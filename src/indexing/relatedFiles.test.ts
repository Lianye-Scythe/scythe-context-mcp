import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { classifyRelatedPath, readRelatedFileGraph } from "./relatedFiles.js";

describe("related file graph", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-related-files-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads a bounded multi-hop related file graph", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "controller.ts"), 'import { service } from "./service";\nservice();\n');
    await fs.writeFile(path.join(tempDir, "src", "service.ts"), 'import { repo } from "./repo";\nexport function service() { repo(); }\n');
    await fs.writeFile(path.join(tempDir, "src", "repo.ts"), "export function repo() {}\n");

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/controller.ts"],
      maxDepth: 2,
      maxFiles: 10,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => ({ path: node.path, depth: node.depth, via: node.via }))).toEqual([
      { path: "src/controller.ts", depth: 0, via: null },
      { path: "src/service.ts", depth: 1, via: "src/controller.ts" },
      { path: "src/repo.ts", depth: 2, via: "src/service.ts" },
    ]);
  });

  it("prioritizes source neighbors before tests in related traversal", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "service.ts"), "export function service() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "controller.ts"), 'import { service } from "./service";\nservice();\n');
    await fs.writeFile(path.join(tempDir, "src", "service.test.ts"), 'import { service } from "./service";\nservice();\n');

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/service.ts"],
      maxDepth: 1,
      maxFiles: 3,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => node.path)).toEqual(["src/service.ts", "src/controller.ts", "src/service.test.ts"]);
  });

  it("prioritizes source files globally across queued traversal branches", async () => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.writeFile(path.join(tempDir, "src", "root.ts"), 'import { a } from "./a";\nimport { b } from "./b";\na(); b();\n');
    await fs.writeFile(path.join(tempDir, "src", "a.ts"), "export function a() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "b.ts"), "export function b() {}\n");
    await fs.writeFile(path.join(tempDir, "src", "a.test.ts"), 'import { a } from "./a";\na();\n');
    await fs.writeFile(path.join(tempDir, "src", "b-helper.ts"), 'import { b } from "./b";\nexport function helper() { b(); }\n');

    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 2048,
      targetChunkChars: 100,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const graph = readRelatedFileGraph({
      dbPath: metadata.dbPath,
      seedPaths: ["src/root.ts"],
      maxDepth: 2,
      maxFiles: 5,
      maxResultsPerFile: 10,
    });

    expect(graph.map((node) => node.path)).toEqual([
      "src/root.ts",
      "src/a.ts",
      "src/b.ts",
      "src/b-helper.ts",
      "src/a.test.ts",
    ]);
  });
});

describe("related path classification", () => {
  it.each(["src/token_test.go", "src/test_token.py", "src/token_test.py"])("classifies language test files: %s", (file) => {
    expect(classifyRelatedPath(file)).toBe("test");
  });

  it("classifies common support file roles", () => {
    expect(classifyRelatedPath("src/service.ts")).toBe("source");
    expect(classifyRelatedPath("src/service.test.ts")).toBe("test");
    expect(classifyRelatedPath("src/__mocks__/service.ts")).toBe("mock");
    expect(classifyRelatedPath("fixtures/user.json")).toBe("fixture");
    expect(classifyRelatedPath("src/generated/client.ts")).toBe("generated");
    expect(classifyRelatedPath("docs/usage.md")).toBe("docs");
  });
});
