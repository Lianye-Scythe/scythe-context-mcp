import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DEFAULT_INDEXING_LIMITS } from "./indexing/defaults.js";

export type GeminiAuthMode = "x-goog-api-key" | "bearer" | "query";

export interface AppConfig {
  defaultProjectPath: string;
  indexDirName: string;
  indexing: {
    maxFileBytes: number;
    targetChunkChars: number;
    chunkOverlapChars: number;
    maxChunksPerFile: number;
    embeddingBatchSize: number;
    maxEmbeddingChunks: number;
  };
  gemini: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    outputDimensionality?: number;
    authMode: GeminiAuthMode;
    apiKeyHeader: string;
    apiKeyQueryParam: string;
  };
}

function numberFromEnv(name: string, fallback?: number): number | undefined {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function envValue(name: string, legacyName?: string): string | undefined {
  return process.env[name] || (legacyName ? process.env[legacyName] : undefined);
}

function numberFromEnvAlias(name: string, legacyName: string, fallback?: number): number | undefined {
  const value = envValue(name, legacyName);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} or ${legacyName} must be a positive number`);
  }
  return parsed;
}

function authModeFromEnv(value: string | undefined): GeminiAuthMode {
  if (!value) return "x-goog-api-key";
  if (value === "x-goog-api-key" || value === "bearer" || value === "query") {
    return value;
  }
  throw new Error("GEMINI_AUTH_MODE must be one of: x-goog-api-key, bearer, query");
}

function defaultProjectPathFromEnv(): string {
  const explicitProject = envValue("SCYTHE_CONTEXT_DEFAULT_PROJECT", "REPO_BEACON_DEFAULT_PROJECT");
  if (explicitProject) return explicitProject;

  // Codex App on Windows may launch this server through Windows Node while the
  // active workspace is in WSL. In that setup, cwd often has to stay on a
  // Windows directory for npm/npx, while PWD can still carry the workspace path.
  if (process.env.PWD && fs.existsSync(process.env.PWD)) {
    return process.env.PWD;
  }

  return process.cwd();
}

export function loadConfig(): AppConfig {
  return {
    defaultProjectPath: path.resolve(defaultProjectPathFromEnv()),
    indexDirName: envValue("SCYTHE_CONTEXT_INDEX_DIR", "REPO_BEACON_INDEX_DIR") || ".scythe-context",
    indexing: {
      maxFileBytes:
        numberFromEnvAlias("SCYTHE_CONTEXT_MAX_FILE_BYTES", "REPO_BEACON_MAX_FILE_BYTES", DEFAULT_INDEXING_LIMITS.maxFileBytes) ??
        DEFAULT_INDEXING_LIMITS.maxFileBytes,
      targetChunkChars:
        numberFromEnvAlias("SCYTHE_CONTEXT_TARGET_CHUNK_CHARS", "REPO_BEACON_TARGET_CHUNK_CHARS", DEFAULT_INDEXING_LIMITS.targetChunkChars) ??
        DEFAULT_INDEXING_LIMITS.targetChunkChars,
      chunkOverlapChars:
        numberFromEnvAlias("SCYTHE_CONTEXT_CHUNK_OVERLAP_CHARS", "REPO_BEACON_CHUNK_OVERLAP_CHARS", DEFAULT_INDEXING_LIMITS.chunkOverlapChars) ??
        DEFAULT_INDEXING_LIMITS.chunkOverlapChars,
      maxChunksPerFile:
        numberFromEnvAlias("SCYTHE_CONTEXT_MAX_CHUNKS_PER_FILE", "REPO_BEACON_MAX_CHUNKS_PER_FILE", DEFAULT_INDEXING_LIMITS.maxChunksPerFile) ??
        DEFAULT_INDEXING_LIMITS.maxChunksPerFile,
      embeddingBatchSize: numberFromEnvAlias("SCYTHE_CONTEXT_EMBEDDING_BATCH_SIZE", "REPO_BEACON_EMBEDDING_BATCH_SIZE", 16) ?? 16,
      maxEmbeddingChunks: numberFromEnvAlias("SCYTHE_CONTEXT_MAX_EMBEDDING_CHUNKS", "REPO_BEACON_MAX_EMBEDDING_CHUNKS", 256) ?? 256,
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
      model: process.env.GEMINI_MODEL || "gemini-embedding-2",
      outputDimensionality: numberFromEnv("GEMINI_OUTPUT_DIMENSIONALITY", 1536),
      authMode: authModeFromEnv(process.env.GEMINI_AUTH_MODE),
      apiKeyHeader: process.env.GEMINI_API_KEY_HEADER || "x-goog-api-key",
      apiKeyQueryParam: process.env.GEMINI_API_KEY_QUERY_PARAM || "key",
    },
  };
}
