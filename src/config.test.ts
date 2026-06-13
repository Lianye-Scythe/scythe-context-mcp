import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const MANAGED_ENV = [
  "SCYTHE_CONTEXT_DEFAULT_PROJECT",
  "SCYTHE_CONTEXT_INDEX_DIR",
  "SCYTHE_CONTEXT_MAX_FILE_BYTES",
  "SCYTHE_CONTEXT_TARGET_CHUNK_CHARS",
  "SCYTHE_CONTEXT_CHUNK_OVERLAP_CHARS",
  "SCYTHE_CONTEXT_MAX_CHUNKS_PER_FILE",
  "SCYTHE_CONTEXT_EMBEDDING_BATCH_SIZE",
  "SCYTHE_CONTEXT_MAX_EMBEDDING_CHUNKS",
  "REPO_BEACON_DEFAULT_PROJECT",
  "REPO_BEACON_INDEX_DIR",
  "REPO_BEACON_MAX_FILE_BYTES",
  "REPO_BEACON_TARGET_CHUNK_CHARS",
  "REPO_BEACON_CHUNK_OVERLAP_CHARS",
  "REPO_BEACON_MAX_CHUNKS_PER_FILE",
  "REPO_BEACON_EMBEDDING_BATCH_SIZE",
  "REPO_BEACON_MAX_EMBEDDING_CHUNKS",
] as const;

function clearManagedEnv() {
  for (const key of MANAGED_ENV) {
    delete process.env[key];
  }
}

describe("loadConfig", () => {
  beforeEach(clearManagedEnv);
  afterEach(clearManagedEnv);

  it("uses Scythe Context environment variables", () => {
    process.env.SCYTHE_CONTEXT_DEFAULT_PROJECT = "/tmp/scythe-project";
    process.env.SCYTHE_CONTEXT_INDEX_DIR = ".custom-scythe";
    process.env.SCYTHE_CONTEXT_MAX_FILE_BYTES = "123";
    process.env.SCYTHE_CONTEXT_TARGET_CHUNK_CHARS = "456";
    process.env.SCYTHE_CONTEXT_CHUNK_OVERLAP_CHARS = "7";
    process.env.SCYTHE_CONTEXT_MAX_CHUNKS_PER_FILE = "8";
    process.env.SCYTHE_CONTEXT_EMBEDDING_BATCH_SIZE = "9";
    process.env.SCYTHE_CONTEXT_MAX_EMBEDDING_CHUNKS = "10";

    const config = loadConfig();

    expect(config.defaultProjectPath).toBe("/tmp/scythe-project");
    expect(config.indexDirName).toBe(".custom-scythe");
    expect(config.indexing).toMatchObject({
      maxFileBytes: 123,
      targetChunkChars: 456,
      chunkOverlapChars: 7,
      maxChunksPerFile: 8,
      embeddingBatchSize: 9,
      maxEmbeddingChunks: 10,
    });
  });

  it("falls back to legacy Repo Beacon environment variables during migration", () => {
    process.env.REPO_BEACON_DEFAULT_PROJECT = "/tmp/legacy-project";
    process.env.REPO_BEACON_INDEX_DIR = ".legacy-index";
    process.env.REPO_BEACON_MAX_FILE_BYTES = "321";

    const config = loadConfig();

    expect(config.defaultProjectPath).toBe("/tmp/legacy-project");
    expect(config.indexDirName).toBe(".legacy-index");
    expect(config.indexing.maxFileBytes).toBe(321);
  });

  it("prefers Scythe Context variables over legacy aliases", () => {
    process.env.SCYTHE_CONTEXT_INDEX_DIR = ".new-index";
    process.env.REPO_BEACON_INDEX_DIR = ".legacy-index";
    process.env.SCYTHE_CONTEXT_MAX_FILE_BYTES = "222";
    process.env.REPO_BEACON_MAX_FILE_BYTES = "111";

    const config = loadConfig();

    expect(config.indexDirName).toBe(".new-index");
    expect(config.indexing.maxFileBytes).toBe(222);
  });
});
