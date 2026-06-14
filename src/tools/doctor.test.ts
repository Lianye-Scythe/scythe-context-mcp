import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import { persistentReindexMetadata } from "../indexing/indexWriter.js";
import { runRepoDoctor } from "./doctor.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-doctor-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    defaultProjectPath: tempDir,
    indexDirName: ".scythe-context",
    indexing: {
      maxFileBytes: 512 * 1024,
      targetChunkChars: 4000,
      chunkOverlapChars: 400,
      maxChunksPerFile: 80,
      embeddingBatchSize: 16,
      maxEmbeddingChunks: 256,
    },
    search: {
      rerankMode: "auto",
    },
    gemini: {
      apiKey: "secret-key",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-embedding-2",
      outputDimensionality: 1536,
      authMode: "x-goog-api-key",
      apiKeyHeader: "x-goog-api-key",
      apiKeyQueryParam: "key",
    },
    ...overrides,
  };
}

describe("runRepoDoctor", () => {
  it("reports local runtime checks and missing index recommendations without calling external APIs", async () => {
    const result = await runRepoDoctor({
      config: testConfig(),
      projectPath: tempDir,
      expectedDimensions: 1536,
    });

    expect(result.status).toBe("warn");
    expect(result.checks.map((check) => check.name)).toEqual([
      "node_runtime",
      "native_modules",
      "project_path",
      "environment",
      "gemini_config",
      "wsl_interop",
      "index",
    ]);
    expect(result.recommendedNextActions).toContain("Run repo_reindex with dry_run=false to create the metadata index.");
  });

  it("does not expose the Gemini API key in diagnostics", async () => {
    const result = await runRepoDoctor({
      config: testConfig(),
      projectPath: tempDir,
      expectedDimensions: 1536,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret-key");
    expect(serialized).toContain('"hasApiKey":true');
  });

  it("warns when the Gemini API key is missing", async () => {
    const result = await runRepoDoctor({
      config: testConfig({
        gemini: {
          ...testConfig().gemini,
          apiKey: undefined,
        },
      }),
      projectPath: tempDir,
      expectedDimensions: 1536,
    });

    const geminiCheck = result.checks.find((check) => check.name === "gemini_config");
    expect(geminiCheck).toEqual(expect.objectContaining({ status: "warn" }));
    expect(geminiCheck?.recommendedActions).toContain("Set GEMINI_API_KEY in the environment that starts Codex, or forward it with env_vars.");
  });

  it("warns when metadata exists but embeddings are not populated", async () => {
    await fs.writeFile(path.join(tempDir, "example.ts"), "export const example = 1;\n");
    await persistentReindexMetadata({
      projectPath: tempDir,
      indexDirName: ".scythe-context",
      vectorDimensions: 1536,
      maxFileBytes: 4096,
      targetChunkChars: 200,
      chunkOverlapChars: 0,
      maxChunksPerFile: 10,
    });

    const result = await runRepoDoctor({
      config: testConfig(),
      projectPath: tempDir,
      expectedDimensions: 1536,
    });

    const indexCheck = result.checks.find((check) => check.name === "index");
    expect(indexCheck).toEqual(expect.objectContaining({ status: "warn" }));
    expect(indexCheck?.recommendedActions).toContain(
      "Run repo_reindex with dry_run=false and index_embeddings=true to create 1536-dimension embeddings for semantic search.",
    );
  });
});
