import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeHybridResults, searchKeywordOnly } from "./hybridSearch.js";
import { searchByKeyword } from "./keywordSearch.js";
import { persistentReindexMetadata } from "./indexWriter.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-hybrid-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("mergeHybridResults", () => {
  it("boosts results that match both semantic and keyword searches", () => {
    const results = mergeHybridResults(
      [
        {
          path: "semantic-only.ts",
          startLine: 1,
          endLine: 2,
          distance: 0.1,
          snippet: "semantic",
          matchType: "semantic",
        },
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          distance: 0.5,
          snippet: "both semantic",
          matchType: "semantic",
        },
      ],
      [
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          score: -1,
          snippet: "both keyword",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results[0].path).toBe("both.ts");
    expect(results[0].matchTypes).toEqual(["semantic", "keyword"]);
  });

  it("keeps keyword-only results for exact symbol matches", () => {
    const results = mergeHybridResults(
      [],
      [
        {
          path: "payment.ts",
          startLine: 1,
          endLine: 1,
          score: -10,
          snippet: "processPayment",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ path: "payment.ts", matchTypes: ["keyword"] }));
  });
});

describe("searchKeywordOnly", () => {
  it("returns hybrid-shaped keyword results without a query vector", async () => {
    await fs.writeFile(path.join(tempDir, "payment.ts"), "export function processPayment() { return 'paid'; }\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 1024,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "processPayment",
      maxResults: 5,
      maxSnippetChars: 80,
    });

    expect(results[0]).toEqual(expect.objectContaining({ path: "payment.ts", matchTypes: ["keyword"] }));
  });

  it("adds source counterparts for matched test files during code-aware reranking", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.ts"),
      "export function persistentReindexMetadata() { return 'source implementation'; }\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.test.ts"),
      "it('preserves stable chunk row ids so embedding cache remains useful after reindex', () => {});\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "preserve stable chunk row ids so embedding cache remains useful after reindex",
      maxResults: 5,
      maxSnippetChars: 120,
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("src/indexWriter.ts");
    expect(paths.indexOf("src/indexWriter.ts")).toBeLessThan(paths.indexOf("src/indexWriter.test.ts"));
  });

  it.each([
    { language: "go", source: "src/model.go", tests: "tests/model_test.go", declaration: "func NewBaseCollection() bool { return true }", call: "NewBaseCollection()", name: "NewBaseCollection" },
    { language: "python", source: "src/auth.py", tests: "tests/test_auth.py", declaration: "def validate_token():\n    return True", call: "validate_token()", name: "validate_token" },
    { language: "rust", source: "src/auth.rs", tests: "tests/auth.rs", declaration: "pub fn validate_token() -> bool { true }", call: "validate_token();", name: "validate_token" },
  ])("recovers $language declarations beyond the FTS shortlist and anchors the preview", async (example) => {
    await fs.mkdir(path.join(tempDir, "src"));
    await fs.mkdir(path.join(tempDir, "tests"));
    const comment = example.language === "python" ? "#" : "//";
    const padding = Array.from({ length: 80 }, (_, index) => `${comment} unrelated implementation detail ${index}`).join("\n");
    await fs.writeFile(path.join(tempDir, example.source), padding + "\n" + example.declaration + "\n");
    // Repeated usages dominate lexical ranking; they must not hide the declaration.
    await fs.writeFile(path.join(tempDir, example.tests), Array.from({ length: 500 }, () => example.call).join("\n"));
    const metadata = await persistentReindexMetadata({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3,
      targetChunkChars: 500, chunkOverlapChars: 0 });
    const shortlist = searchByKeyword({ dbPath: metadata.dbPath, query: example.name, maxResults: 6, maxSnippetChars: 100 });
    expect(shortlist).toHaveLength(6);
    expect(shortlist.every((row) => row.path === example.tests)).toBe(true);
    const off = searchKeywordOnly({ dbPath: metadata.dbPath, query: example.name, maxResults: 3, maxSnippetChars: 100, rerankMode: "off" });
    expect(off.every((row) => row.path === example.tests)).toBe(true);
    const results = searchKeywordOnly({ dbPath: metadata.dbPath, query: example.name, maxResults: 3, maxSnippetChars: 100 });
    expect(results[0]).toMatchObject({ path: example.source, startLine: 81 });
    expect(results[0].snippet).toContain(example.declaration.split("\n")[0]);
  });

  it("retains an exact source declaration beyond symbol previews and many test declarations", async () => {
    await fs.mkdir(path.join(tempDir, "tests"));
    await fs.writeFile(path.join(tempDir, "z_source.py"), Array.from({ length: 100 }, (_, i) => `def helper_${i}(): pass`).join("\n") + "\ndef validate_token(): return True\n");
    for (let i = 0; i < 40; i++) await fs.writeFile(path.join(tempDir, "tests", `test_${i}.py`), "def validate_token(): return False\n" + "validate_token()\n".repeat(20));
    const metadata = await persistentReindexMetadata({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3, targetChunkChars: 500, chunkOverlapChars: 0 });
    const results = searchKeywordOnly({ dbPath: metadata.dbPath, query: "validate_token", maxResults: 2, maxSnippetChars: 100 });
    expect(results[0]).toMatchObject({ path: "z_source.py", startLine: 101 });
    expect(results[0].snippet).toContain("def validate_token()");
  });

  it("does not invent source candidates for undeclared names or multiword queries", async () => {
    await fs.writeFile(path.join(tempDir, "test_auth.py"), "unknown_token()\n".repeat(50));
    const metadata = await persistentReindexMetadata({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3 });
    for (const query of ["unknown_token", "unknown_token callers"]) {
      const results = searchKeywordOnly({ dbPath: metadata.dbPath, query, maxResults: 3, maxSnippetChars: 100 });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((row) => row.path === "test_auth.py" && !row.matchTypes.includes("local"))).toBe(true);
    }
  });

  it("keeps multiword usage searches on the existing candidate path", async () => {
    await fs.writeFile(path.join(tempDir, "auth.py"), "# implementation detail\n".repeat(100) + "def validate_token(): return True\n");
    await fs.writeFile(path.join(tempDir, "test_auth.py"), "validate_token() # callers\n".repeat(500));
    const metadata = await persistentReindexMetadata({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3, targetChunkChars: 500, chunkOverlapChars: 0 });
    const results = searchKeywordOnly({ dbPath: metadata.dbPath, query: "validate_token callers", maxResults: 2, maxSnippetChars: 100 });
    expect(results).toHaveLength(2);
    expect(results.every((row) => row.path === "test_auth.py" && !row.matchTypes.includes("local"))).toBe(true);
  });

  it("does not return a declaration beyond the indexed chunk limit", async () => {
    await fs.writeFile(path.join(tempDir, "auth.py"), "# unrelated padding\n".repeat(100) + "def validate_token(): return True\n");
    await fs.writeFile(path.join(tempDir, "test_auth.py"), "validate_token()\n".repeat(50));
    const metadata = await persistentReindexMetadata({ projectPath: tempDir, indexDirName: ".scythe-context", vectorDimensions: 3, targetChunkChars: 100, chunkOverlapChars: 0, maxChunksPerFile: 1 });
    const results = searchKeywordOnly({ dbPath: metadata.dbPath, query: "validate_token", maxResults: 3, maxSnippetChars: 100 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((row) => row.path === "test_auth.py")).toBe(true);
  });

  it("can disable code-aware reranking", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.ts"),
      "export function persistentReindexMetadata() { return 'source implementation'; }\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "indexWriter.test.ts"),
      "it('preserves stable chunk row ids so embedding cache remains useful after reindex', () => {});\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "preserve stable chunk row ids so embedding cache remains useful after reindex",
      maxResults: 5,
      maxSnippetChars: 120,
      rerankMode: "off",
    });

    const paths = results.map((result) => result.path);
    expect(paths).toContain("src/indexWriter.test.ts");
    expect(paths.indexOf("src/indexWriter.test.ts")).toBeLessThan(paths.indexOf("src/indexWriter.ts"));
  });

  it("can apply benchmark-only rerank weights", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "src", "baseUrlNormalization.ts"), "export const marker = 'gemini provider compatibility';\n");
    await fs.writeFile(path.join(tempDir, "src", "provider.ts"), "export const marker = 'gemini provider compatibility';\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const defaultResults = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "base url normalization gemini provider compatibility",
      maxResults: 5,
      maxSnippetChars: 120,
    });
    const pathHeavyResults = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "base url normalization gemini provider compatibility",
      maxResults: 5,
      maxSnippetChars: 120,
      rerankWeights: {
        path: 2,
      },
    });

    const defaultTarget = defaultResults.find((result) => result.path === "src/baseUrlNormalization.ts");
    const pathHeavyTarget = pathHeavyResults.find((result) => result.path === "src/baseUrlNormalization.ts");
    expect(defaultTarget).toBeDefined();
    expect(pathHeavyTarget).toBeDefined();
    expect(pathHeavyTarget!.score).toBeGreaterThan(defaultTarget!.score);
  });

  it("does not let source-role boosts outrank documentation for security policy queries", async () => {
    await fs.mkdir(path.join(tempDir, "src", "tools"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "SECURITY.md"),
      "Security policy: embedding text goes to the configured remote provider and local indexes are not committed.\n",
    );
    await fs.writeFile(
      path.join(tempDir, "src", "tools", "registerTools.ts"),
      "export const message = 'embedding provider remote configured local index text';\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "security policy should explain embedding text goes to configured remote provider and local indexes are not committed",
      maxResults: 5,
      maxSnippetChars: 160,
    });

    expect(results[0].path).toBe("SECURITY.md");
  });

  it("routes setup examples to docs while retaining explicit test lookup", async () => {
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "docs", "setup.md"), "Setup examples timeout configuration.\n");
    await fs.writeFile(path.join(tempDir, "src", "config.ts"), "export const settings = 'setup examples timeout configuration';\n");
    await fs.writeFile(path.join(tempDir, "src", "config.test.ts"), "export const checks = 'setup examples timeout configuration';\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 3,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });
    const options = { dbPath: metadata.dbPath, maxResults: 5, maxSnippetChars: 160 };
    const docs = searchKeywordOnly({ ...options, query: "setup examples timeout configuration" });
    expect(docs[0].path).toBe("docs/setup.md");
    const tests = searchKeywordOnly({ ...options, query: "test examples timeout configuration" });
    expect(tests[0].path).toBe("src/config.test.ts");
  });

  it("prioritizes package manifests for npm package maintenance queries", async () => {
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify(
        {
          name: "example",
          scripts: {
            build: "tsc",
            test: "vitest run",
          },
          files: ["dist", "docs", "benchmarks", "scripts/context-benchmark.mjs"],
        },
        null,
        2,
      ),
    );
    await fs.writeFile(path.join(tempDir, "docs", "benchmark.md"), "benchmark docs context package npm release script ".repeat(12));
    await fs.writeFile(path.join(tempDir, "scripts", "context-benchmark.mjs"), "export const benchmark = 'context benchmark script npm package';\n");
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "npm package should include dist docs benchmark cases and context benchmark script",
      maxResults: 5,
      maxSnippetChars: 160,
    });

    expect(results.map((result) => result.path)).toContain("package.json");
  });

  it("downranks benchmark fixtures for runtime behavior queries", async () => {
    await fs.mkdir(path.join(tempDir, "src", "tools"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "benchmarks"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "tools", "registerTools.ts"),
      "export function embeddingUnavailablePayload() { return 'context pack degrade to keyword results when query embedding is unavailable in hybrid mode'; }\n",
    );
    await fs.writeFile(
      path.join(tempDir, "benchmarks", "context-search-cases.json"),
      JSON.stringify([
        {
          query: "context pack should degrade to keyword results when query embedding is unavailable in hybrid mode",
          expectedPaths: ["src/tools/registerTools.ts"],
        },
      ]),
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 300,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "context pack should degrade to keyword results when query embedding is unavailable in hybrid mode",
      maxResults: 5,
      maxSnippetChars: 180,
    });

    expect(results[0].path).toBe("src/tools/registerTools.ts");
    expect(results.map((result) => result.path)).toContain("benchmarks/context-search-cases.json");
  });

  it("keeps benchmark files competitive for benchmark-intent queries", async () => {
    await fs.mkdir(path.join(tempDir, "src", "tools"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "benchmarks"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "src", "tools", "registerTools.ts"),
      "export const fallback = 'context pack query embedding unavailable hybrid mode';\n",
    );
    await fs.writeFile(
      path.join(tempDir, "benchmarks", "context-search-cases.json"),
      "benchmark case suite context pack query embedding unavailable hybrid mode expected paths\n",
    );
    const metadata = await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 300,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const results = searchKeywordOnly({
      dbPath: metadata.dbPath,
      query: "benchmark case suite for context pack query embedding unavailable hybrid mode",
      maxResults: 5,
      maxSnippetChars: 180,
    });

    expect(results[0].path).toBe("benchmarks/context-search-cases.json");
  });
});
