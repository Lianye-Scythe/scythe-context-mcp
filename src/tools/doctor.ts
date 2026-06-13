import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { readDetailedIndexStatus, readIndexFreshness, recommendedNextActions, type IndexFreshness } from "../indexing/indexStatus.js";
import { buildGeminiEndpoint, normalizeGeminiBaseUrl } from "../providers/gemini.js";
import { loadSqliteVec } from "../storage/sqliteVec.js";

export type DoctorStatus = "ok" | "warn" | "error";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  summary: string;
  details?: Record<string, unknown>;
  recommendedActions?: string[];
}

export interface RepoDoctorResult {
  status: DoctorStatus;
  projectPath: string;
  indexPath: string;
  checks: DoctorCheck[];
  recommendedNextActions: string[];
}

function worstStatus(checks: readonly DoctorCheck[]): DoctorStatus {
  if (checks.some((check) => check.status === "error")) return "error";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

function safeRealpath(value: string): string | undefined {
  try {
    return fs.realpathSync(value);
  } catch {
    return undefined;
  }
}

function canAccess(value: string, mode: number): boolean {
  try {
    fs.accessSync(value, mode);
    return true;
  } catch {
    return false;
  }
}

function nodeRuntimeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0]);
  const status: DoctorStatus = major >= 24 && major < 27 ? "ok" : "warn";
  return {
    name: "node_runtime",
    status,
    summary: status === "ok" ? "Node.js runtime is within the supported range." : "Node.js runtime is outside the supported range.",
    details: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      executable: process.execPath,
      supportedRange: ">=24.11.0 <27",
    },
    recommendedActions:
      status === "ok" ? undefined : ["Use Node.js 24 LTS for the primary supported runtime, or Node 26 after it enters LTS."],
  };
}

function nativeModuleCheck(): DoctorCheck {
  try {
    const db = new Database(":memory:");
    try {
      const sqliteVecVersion = loadSqliteVec(db);
      return {
        name: "native_modules",
        status: "ok",
        summary: "better-sqlite3 and sqlite-vec loaded successfully.",
        details: {
          sqlite: db.prepare("select sqlite_version() as version").get(),
          sqliteVecVersion,
        },
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      name: "native_modules",
      status: "error",
      summary: "Native SQLite dependencies failed to load.",
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
      recommendedActions: [
        "Reinstall dependencies in the same OS/runtime that launches the MCP server.",
        "Avoid mixing Windows Node modules with WSL/Linux Node modules.",
        "If npm blocks install scripts, allow better-sqlite3 install scripts and reinstall.",
      ],
    };
  }
}

function projectPathCheck(projectPath: string): DoctorCheck {
  const exists = fs.existsSync(projectPath);
  const stat = exists ? fs.statSync(projectPath) : undefined;
  const isDirectory = Boolean(stat?.isDirectory());
  const status: DoctorStatus = exists && isDirectory ? "ok" : "error";
  return {
    name: "project_path",
    status,
    summary: status === "ok" ? "Project path exists and is a directory." : "Project path is missing or is not a directory.",
    details: {
      projectPath,
      realpath: safeRealpath(projectPath),
      exists,
      isDirectory,
      readable: exists ? canAccess(projectPath, fs.constants.R_OK) : false,
      writable: exists ? canAccess(projectPath, fs.constants.W_OK) : false,
      cwd: process.cwd(),
      pwd: process.env.PWD,
    },
    recommendedActions:
      status === "ok"
        ? undefined
        : ["Pass project_path explicitly, or start Codex/MCP from an existing repository workspace."],
  };
}

async function indexCheck(config: AppConfig, projectPath: string, dbPath: string, expectedDimensions: number): Promise<DoctorCheck> {
  const index = readDetailedIndexStatus(dbPath);
  const freshness: IndexFreshness | undefined = index.exists
    ? await readIndexFreshness({
        projectPath,
        dbPath,
        limits: { maxFileBytes: config.indexing.maxFileBytes },
      })
    : undefined;
  const matchingEmbeddingSet = index.embeddingSets.find((set) => set.dimensions === expectedDimensions);
  const embeddingCoverageIncomplete =
    index.chunks > 0 && (!matchingEmbeddingSet || matchingEmbeddingSet.embeddings < index.chunks);
  const status: DoctorStatus =
    !index.exists || index.chunks === 0 || freshness?.status === "stale" || embeddingCoverageIncomplete ? "warn" : "ok";

  return {
    name: "index",
    status,
    summary:
      status === "ok"
        ? "Index exists and metadata freshness is acceptable."
        : "Index is missing, empty, stale, or partially populated.",
    details: {
      dbPath,
      exists: index.exists,
      files: index.files,
      chunks: index.chunks,
      ftsRows: index.ftsRows,
      symbols: index.symbols,
      dependencies: index.dependencies,
      freshnessStatus: freshness?.status,
      embeddingCoverage: matchingEmbeddingSet
        ? {
            provider: matchingEmbeddingSet.provider,
            model: matchingEmbeddingSet.model,
            dimensions: matchingEmbeddingSet.dimensions,
            embeddings: matchingEmbeddingSet.embeddings,
            chunks: index.chunks,
          }
        : undefined,
    },
    recommendedActions: recommendedNextActions(index, { desiredDimensions: expectedDimensions, freshness }),
  };
}

function geminiConfigCheck(config: AppConfig["gemini"], expectedDimensions: number): DoctorCheck {
  try {
    const normalizedBaseUrl = normalizeGeminiBaseUrl(config.baseUrl);
    const endpoint = buildGeminiEndpoint(config.baseUrl, config.model, "embedContent").toString();
    const status: DoctorStatus = config.apiKey ? "ok" : "warn";
    return {
      name: "gemini_config",
      status,
      summary: config.apiKey
        ? "Gemini-compatible configuration is syntactically valid and an API key is present."
        : "Gemini-compatible configuration is syntactically valid, but GEMINI_API_KEY is missing.",
      details: {
        baseUrl: config.baseUrl,
        normalizedBaseUrl,
        endpoint,
        model: config.model,
        expectedDimensions,
        authMode: config.authMode,
        hasApiKey: Boolean(config.apiKey),
        apiKeyHeader: config.apiKeyHeader,
        apiKeyQueryParam: config.apiKeyQueryParam,
      },
      recommendedActions: config.apiKey
        ? undefined
        : ["Set GEMINI_API_KEY in the environment that starts Codex, or forward it with env_vars."],
    };
  } catch (error) {
    return {
      name: "gemini_config",
      status: "error",
      summary: "Gemini-compatible configuration is invalid.",
      details: {
        baseUrl: config.baseUrl,
        model: config.model,
        expectedDimensions,
        authMode: config.authMode,
        hasApiKey: Boolean(config.apiKey),
        error: error instanceof Error ? error.message : String(error),
      },
      recommendedActions: ["Verify GEMINI_BASE_URL can include or omit /v1beta and points to a valid provider root."],
    };
  }
}

function wslCheck(projectPath: string): DoctorCheck {
  const isWsl = Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || /microsoft/i.test(os.release()));
  const isWindows = process.platform === "win32";
  const projectLooksWsl = projectPath.startsWith("/mnt/") || projectPath.startsWith("/home/") || projectPath.includes("\\wsl");
  const status: DoctorStatus = isWindows && projectLooksWsl ? "warn" : "ok";

  return {
    name: "wsl_interop",
    status,
    summary:
      status === "ok"
        ? "WSL/Windows interop signals do not show a known unsafe setup."
        : "Windows Node appears to be handling a WSL-looking project path.",
    details: {
      platform: process.platform,
      osRelease: os.release(),
      isWsl,
      wslDistroName: process.env.WSL_DISTRO_NAME,
      hasWslInterop: Boolean(process.env.WSL_INTEROP),
      wslEnv: process.env.WSLENV,
      projectPath,
      projectLooksWsl,
      executable: process.execPath,
    },
    recommendedActions:
      status === "ok"
        ? undefined
        : [
            "Prefer launching WSL Node through wsl.exe for WSL repos so .scythe-context stays on the WSL filesystem.",
            "Avoid Windows Node directly reading or writing a WSL repo-local SQLite index.",
          ],
  };
}

function environmentCheck(config: AppConfig): DoctorCheck {
  return {
    name: "environment",
    status: "ok",
    summary: "Environment summary collected without printing secrets.",
    details: {
      hasPwd: Boolean(process.env.PWD),
      hasGeminiApiKey: Boolean(process.env.GEMINI_API_KEY),
      hasScytheDefaultProject: Boolean(process.env.SCYTHE_CONTEXT_DEFAULT_PROJECT),
      hasLegacyDefaultProject: Boolean(process.env.REPO_BEACON_DEFAULT_PROJECT),
      defaultProjectPath: config.defaultProjectPath,
      indexDirName: config.indexDirName,
    },
  };
}

export async function runRepoDoctor(options: {
  config: AppConfig;
  projectPath: string;
  expectedDimensions: number;
}): Promise<RepoDoctorResult> {
  const projectPath = path.resolve(options.projectPath);
  const indexPath = path.join(projectPath, options.config.indexDirName);
  const dbPath = path.join(indexPath, "index.sqlite");
  const checks: DoctorCheck[] = [
    nodeRuntimeCheck(),
    nativeModuleCheck(),
    projectPathCheck(projectPath),
    environmentCheck(options.config),
    geminiConfigCheck(options.config.gemini, options.expectedDimensions),
    wslCheck(projectPath),
    await indexCheck(options.config, projectPath, dbPath, options.expectedDimensions),
  ];
  const recommendedNextActions = Array.from(new Set(checks.flatMap((check) => check.recommendedActions ?? [])));

  return {
    status: worstStatus(checks),
    projectPath,
    indexPath,
    checks,
    recommendedNextActions,
  };
}
