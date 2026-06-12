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

function authModeFromEnv(value: string | undefined): GeminiAuthMode {
  if (!value) return "x-goog-api-key";
  if (value === "x-goog-api-key" || value === "bearer" || value === "query") {
    return value;
  }
  throw new Error("GEMINI_AUTH_MODE must be one of: x-goog-api-key, bearer, query");
}

export function loadConfig(): AppConfig {
  return {
    defaultProjectPath: path.resolve(
      process.env.REPO_BEACON_DEFAULT_PROJECT || process.cwd(),
    ),
    indexDirName: process.env.REPO_BEACON_INDEX_DIR || ".repo-beacon",
    indexing: {
      maxFileBytes:
        numberFromEnv("REPO_BEACON_MAX_FILE_BYTES", DEFAULT_INDEXING_LIMITS.maxFileBytes) ??
        DEFAULT_INDEXING_LIMITS.maxFileBytes,
      targetChunkChars:
        numberFromEnv("REPO_BEACON_TARGET_CHUNK_CHARS", DEFAULT_INDEXING_LIMITS.targetChunkChars) ??
        DEFAULT_INDEXING_LIMITS.targetChunkChars,
      chunkOverlapChars:
        numberFromEnv("REPO_BEACON_CHUNK_OVERLAP_CHARS", DEFAULT_INDEXING_LIMITS.chunkOverlapChars) ??
        DEFAULT_INDEXING_LIMITS.chunkOverlapChars,
      maxChunksPerFile:
        numberFromEnv("REPO_BEACON_MAX_CHUNKS_PER_FILE", DEFAULT_INDEXING_LIMITS.maxChunksPerFile) ??
        DEFAULT_INDEXING_LIMITS.maxChunksPerFile,
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
