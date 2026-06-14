#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const DEFAULT_CASES_PATH = "benchmarks/context-search-cases.json";
const DEFAULT_SUITE = "full";
const RERANK_WEIGHT_KEYS = ["base", "path", "snippet", "symbol", "role", "graph", "sourceCounterpartRatio"];

function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    cases: DEFAULT_CASES_PATH,
    maxResults: 8,
    maxSnippetChars: 1200,
    maxContextChars: 16000,
    includeHybrid: false,
    compareRerank: false,
    compareResponseModes: false,
    rerank: process.env.SCYTHE_CONTEXT_RERANK_MODE || "auto",
    json: false,
    output: undefined,
    allowMissingExpected: false,
    suites: [DEFAULT_SUITE],
    rerankProfiles: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[i];
    };

    switch (arg) {
      case "--project":
        args.project = next();
        break;
      case "--cases":
        args.cases = next();
        break;
      case "--max-results":
        args.maxResults = Number(next());
        break;
      case "--max-snippet-chars":
        args.maxSnippetChars = Number(next());
        break;
      case "--max-context-chars":
        args.maxContextChars = Number(next());
        break;
      case "--include-hybrid":
        args.includeHybrid = true;
        break;
      case "--compare-rerank":
        args.compareRerank = true;
        break;
      case "--compare-response-modes":
        args.compareResponseModes = true;
        break;
      case "--rerank":
        args.rerank = next();
        break;
      case "--json":
        args.json = true;
        break;
      case "--output":
        args.output = next();
        break;
      case "--allow-missing-expected":
        args.allowMissingExpected = true;
        break;
      case "--suite":
        args.suites = parseSuites(next());
        break;
      case "--rerank-profiles":
        args.rerankProfiles = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const key of ["maxResults", "maxSnippetChars", "maxContextChars"]) {
    if (!Number.isInteger(args[key]) || args[key] <= 0) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  if (args.rerank !== "auto" && args.rerank !== "off") {
    throw new Error("--rerank must be one of: auto, off");
  }
  if (args.suites.length === 0) {
    throw new Error("--suite must include at least one suite name");
  }
  if (args.compareRerank && args.rerankProfiles) {
    throw new Error("--compare-rerank cannot be combined with --rerank-profiles");
  }
  if (args.compareResponseModes && (args.compareRerank || args.rerankProfiles)) {
    throw new Error("--compare-response-modes cannot be combined with --compare-rerank or --rerank-profiles");
  }

  return args;
}

function parseSuites(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`Usage: npm run bench:context -- [options]

Options:
  --project <path>             Project to benchmark. Defaults to cwd.
  --cases <path>               JSON case file. Defaults to ${DEFAULT_CASES_PATH}.
  --max-results <n>            Ranked results to keep per method. Defaults to 8.
  --include-hybrid             Also run Gemini-backed hybrid search. Calls the configured embedding API.
  --compare-rerank             Run rerank auto and off, then print a delta report.
  --compare-response-modes     Compare Scythe context-pack response modes and output-token cost.
  --rerank <auto|off>          Code-aware reranking mode. Defaults to env or auto.
  --json                       Print JSON instead of a table.
  --output <path>              Write JSON report to a file.
  --allow-missing-expected     Do not fail when expected paths are missing from the target project.
  --suite <name[,name]>        Case suite tags to run. Defaults to full.
  --rerank-profiles <path>     Run a benchmark-only rerank profile matrix from JSON.
`);
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProjectPath(project) {
  const projectPath = path.resolve(project);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  if (!fs.statSync(projectPath).isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
  return projectPath;
}

function resolveCasesPath(cases) {
  const casesPath = path.resolve(cases);
  if (!fs.existsSync(casesPath)) {
    throw new Error(`Benchmark case file does not exist: ${casesPath}`);
  }
  if (!fs.statSync(casesPath).isFile()) {
    throw new Error(`Benchmark case path is not a file: ${casesPath}`);
  }
  return casesPath;
}

function readCases(casesPath, projectPath, options = {}) {
  const raw = fs.readFileSync(casesPath, "utf8");
  const cases = JSON.parse(raw);
  if (!Array.isArray(cases)) throw new Error("Benchmark cases must be a JSON array");
  const seenIds = new Set();
  const missingExpected = [];
  const normalizedCases = cases.map((item, index) => {
    if (
      typeof item.id !== "string" ||
      item.id.trim() === "" ||
      typeof item.query !== "string" ||
      item.query.trim() === "" ||
      !Array.isArray(item.expectedPaths) ||
      item.expectedPaths.length === 0
    ) {
      throw new Error(`Invalid benchmark case at index ${index}`);
    }
    if (seenIds.has(item.id)) {
      throw new Error(`Duplicate benchmark case id: ${item.id}`);
    }
    seenIds.add(item.id);
    const expectedPaths = item.expectedPaths.map((expectedPath) => {
      if (typeof expectedPath !== "string" || expectedPath.trim() === "") {
        throw new Error(`Invalid expected path in benchmark case ${item.id}`);
      }
      if (path.isAbsolute(expectedPath)) {
        throw new Error(`Expected path must be project-relative in benchmark case ${item.id}: ${expectedPath}`);
      }
      const resolvedExpectedPath = path.resolve(projectPath, expectedPath);
      if (!isPathInside(projectPath, resolvedExpectedPath)) {
        throw new Error(`Expected path must stay inside the project in benchmark case ${item.id}: ${expectedPath}`);
      }
      const normalized = normalizeRelativePath(path.relative(projectPath, resolvedExpectedPath));
      if (!fs.existsSync(path.join(projectPath, normalized))) {
        missingExpected.push({ id: item.id, path: normalized });
      }
      return normalized;
    });
    const tags = Array.isArray(item.tags)
      ? item.tags.map((tag) => {
          if (typeof tag !== "string" || tag.trim() === "") {
            throw new Error(`Invalid tag in benchmark case ${item.id}`);
          }
          return tag.trim();
        })
      : [];
    return { ...item, expectedPaths, tags };
  });

  if (missingExpected.length > 0 && !options.allowMissingExpected) {
    const sample = missingExpected
      .slice(0, 10)
      .map((item) => `${item.id}: ${item.path}`)
      .join("; ");
    throw new Error(
      `Benchmark case file references ${missingExpected.length} missing expected path(s). ` +
        `Fix the case file or pass --allow-missing-expected. Sample: ${sample}`,
    );
  }

  return { cases: normalizedCases, missingExpected };
}

function readRerankProfiles(profilesPath) {
  const resolvedPath = resolveCasesPath(profilesPath);
  const raw = fs.readFileSync(resolvedPath, "utf8");
  const profiles = JSON.parse(raw);
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("Rerank profiles must be a non-empty JSON array");
  }

  const seenNames = new Set();
  return {
    path: resolvedPath,
    profiles: profiles.map((profile, index) => {
      if (typeof profile.name !== "string" || profile.name.trim() === "") {
        throw new Error(`Invalid rerank profile at index ${index}: name is required`);
      }
      const name = profile.name.trim();
      if (seenNames.has(name)) {
        throw new Error(`Duplicate rerank profile name: ${name}`);
      }
      seenNames.add(name);

      const rerankMode = profile.rerankMode ?? "auto";
      if (rerankMode !== "auto" && rerankMode !== "off") {
        throw new Error(`Profile ${name} rerankMode must be one of: auto, off`);
      }

      const weights = profile.weights ?? undefined;
      if (weights !== undefined) {
        if (typeof weights !== "object" || Array.isArray(weights) || weights === null) {
          throw new Error(`Profile ${name} weights must be an object`);
        }
        for (const key of Object.keys(weights)) {
          if (!RERANK_WEIGHT_KEYS.includes(key)) {
            throw new Error(`Profile ${name} has unknown weight: ${key}`);
          }
          if (typeof weights[key] !== "number" || !Number.isFinite(weights[key])) {
            throw new Error(`Profile ${name} weight ${key} must be a finite number`);
          }
        }
      }

      return {
        name,
        rerankMode,
        weights,
        notes: profile.notes,
      };
    }),
  };
}

function filterCasesBySuite(cases, suites) {
  const knownSuites = new Set([DEFAULT_SUITE]);
  for (const testCase of cases) {
    for (const tag of testCase.tags) knownSuites.add(tag);
  }
  const unknownSuites = suites.filter((suite) => !knownSuites.has(suite));
  if (unknownSuites.length > 0) {
    throw new Error(
      `Unknown benchmark suite(s): ${unknownSuites.join(", ")}. Known suites: ${Array.from(knownSuites).sort().join(", ")}`,
    );
  }

  if (suites.includes(DEFAULT_SUITE)) {
    return {
      selectedCases: cases,
      activeSuites: [DEFAULT_SUITE],
    };
  }

  const selectedSuites = new Set(suites);
  const selectedCases = cases.filter((testCase) => testCase.tags.some((tag) => selectedSuites.has(tag)));
  if (selectedCases.length === 0) {
    throw new Error(`No benchmark cases matched suite(s): ${suites.join(", ")}`);
  }

  return {
    selectedCases,
    activeSuites: suites,
  };
}

function uniquePaths(results) {
  const seen = new Set();
  const paths = [];
  for (const result of results) {
    const candidate = typeof result === "string" ? result : result.path;
    if (!candidate) continue;
    const normalized = normalizeRelativePath(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

function normalizeRelativePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function rankOfExpected(paths, expectedPaths) {
  const expected = new Set(expectedPaths.map(normalizeRelativePath));
  const index = paths.findIndex((candidate) => expected.has(candidate));
  return index >= 0 ? index + 1 : null;
}

function metricsFor(paths, expectedPaths) {
  const rank = rankOfExpected(paths, expectedPaths);
  return {
    rank,
    hitAt1: rank === 1,
    hitAt3: rank !== null && rank <= 3,
    hitAt5: rank !== null && rank <= 5,
    reciprocalRank: rank ? 1 / rank : 0,
  };
}

function estimatedTokensFromJson(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function benchmarkMethod(name, cases, runCase, options = {}) {
  const excludedPaths = new Set((options.excludedPaths ?? []).filter(Boolean).map(normalizeRelativePath));
  const caseResults = [];
  for (const testCase of cases) {
    const startedAt = performance.now();
    try {
      const result = runCase(testCase);
      const latencyMs = performance.now() - startedAt;
      const paths = uniquePaths(result.paths ?? []).filter((candidate) => !excludedPaths.has(candidate));
      const contextPaths = result.contextPaths
        ? uniquePaths(result.contextPaths).filter((candidate) => !excludedPaths.has(candidate))
        : undefined;
      const estimatedOutputTokens =
        result.estimatedOutputTokens ??
        estimatedTokensFromJson({
          status: result.status ?? "ok",
          paths,
          contextPaths,
          error: result.error,
        });
      caseResults.push({
        id: testCase.id,
        query: testCase.query,
        expectedPaths: testCase.expectedPaths,
        status: result.status ?? "ok",
        latencyMs,
        paths,
        contextPaths,
        estimatedOutputTokens,
        error: result.error,
        ...metricsFor(paths, testCase.expectedPaths),
        context: contextPaths ? metricsFor(contextPaths, testCase.expectedPaths) : undefined,
      });
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      caseResults.push({
        id: testCase.id,
        query: testCase.query,
        expectedPaths: testCase.expectedPaths,
        status: "error",
        latencyMs,
        paths: [],
        estimatedOutputTokens: estimatedTokensFromJson({
          status: "error",
          paths: [],
          error: error instanceof Error ? error.message : String(error),
        }),
        error: error instanceof Error ? error.message : String(error),
        ...metricsFor([], testCase.expectedPaths),
      });
    }
  }

  return {
    method: name,
    summary: summarizeCases(caseResults),
    cases: caseResults,
  };
}

function summarizeCases(caseResults) {
  return {
    cases: caseResults.length,
    ok: caseResults.filter((item) => item.status === "ok").length,
    skipped: caseResults.filter((item) => item.status === "skipped").length,
    errors: caseResults.filter((item) => item.status === "error").length,
    hitAt1: mean(caseResults.map((item) => (item.hitAt1 ? 1 : 0))),
    hitAt3: mean(caseResults.map((item) => (item.hitAt3 ? 1 : 0))),
    hitAt5: mean(caseResults.map((item) => (item.hitAt5 ? 1 : 0))),
    mrr: mean(caseResults.map((item) => item.reciprocalRank)),
    meanOutputTokens: mean(caseResults.map((item) => item.estimatedOutputTokens ?? 0)),
    hitAt5Per1kTokens:
      mean(caseResults.map((item) => (item.hitAt5 ? 1 : 0))) / Math.max(0.001, mean(caseResults.map((item) => item.estimatedOutputTokens ?? 0)) / 1000),
    meanLatencyMs: mean(caseResults.map((item) => item.latencyMs)),
    p95LatencyMs: percentile(caseResults.map((item) => item.latencyMs), 95),
  };
}

function rgAvailable() {
  const result = spawnSync("rg", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

function rgSmartSearch(projectPath, query, maxResults, keywordTerms) {
  if (!rgAvailable()) {
    return { status: "skipped", paths: [], error: "rg is not available on PATH" };
  }

  const terms = keywordTerms(query)
    .filter((term) => term.length >= 3)
    .slice(0, 10);
  if (terms.length === 0) return { paths: [] };

  const args = [
    "--json",
    "--ignore-case",
    "--line-number",
    "--glob",
    "!.scythe-context/**",
    "--glob",
    "!local/**",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!dist/**",
    "--glob",
    "!build/**",
    "--glob",
    "!coverage/**",
    "--glob",
    "!package-lock.json",
    "--glob",
    "!pnpm-lock.yaml",
    "--glob",
    "!yarn.lock",
  ];
  for (const term of terms) args.push("-e", term);
  args.push(".");

  const result = spawnSync("rg", args, {
    cwd: projectPath,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.status !== 0 && result.status !== 1) {
    return {
      status: "error",
      paths: [],
      error: result.stderr.trim() || `rg exited with status ${result.status}`,
    };
  }

  const scores = new Map();
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type !== "match") continue;
    const filePath = event.data?.path?.text;
    if (!filePath) continue;
    const lineText = event.data?.lines?.text ?? "";
    const matches = event.data?.submatches?.length ?? 1;
    const current = scores.get(filePath) ?? { path: filePath, score: 0, firstLine: event.data?.line_number ?? 0 };
    current.score += matches + terms.filter((term) => lineText.toLowerCase().includes(term.toLowerCase())).length * 0.25;
    current.firstLine = Math.min(current.firstLine || Infinity, event.data?.line_number ?? Infinity);
    scores.set(filePath, current);
  }

  const paths = Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.firstLine - b.firstLine || a.path.localeCompare(b.path))
    .slice(0, maxResults)
    .map((item) => item.path);

  return { paths };
}

function contextPackFromResults(rawResults, buildContextPack, readRelatedFileGraph, options) {
  const seedPaths = uniquePaths(rawResults).slice(0, 3);
  const relatedFiles = readRelatedFileGraph({
    dbPath: options.dbPath,
    seedPaths,
    maxDepth: 1,
    maxFiles: 10,
    maxResultsPerFile: 8,
  });
  const pack = buildContextPack(options.query, rawResults, relatedFiles, {
    maxContextChars: options.maxContextChars,
    maxRelatedFiles: 10,
    maxRelatedItems: 8,
  });
  return {
    relatedSeedCount: seedPaths.length,
    relatedFiles,
    pack,
  };
}

function contextPathsFromResults(rawResults, buildContextPack, readRelatedFileGraph, options) {
  return contextPackFromResults(rawResults, buildContextPack, readRelatedFileGraph, options).pack.suggestedPaths;
}

function contextPackResponseEstimate(rawResults, options, responseMode) {
  const { relatedSeedCount, pack } = contextPackFromResults(rawResults, options.buildContextPack, options.readRelatedFileGraph, {
    dbPath: options.dbPath,
    query: options.query,
    maxContextChars: options.maxContextChars,
  });
  const payload = options.shapeContextPackPayload(
    {
      query: options.query,
      projectPath: options.projectPath,
      mode: options.searchMode,
      effectiveMode: options.effectiveMode,
      rerankMode: options.rerankMode,
      rerankApplied: options.rerankMode !== "off" && options.effectiveMode !== "semantic",
      fallback: undefined,
      relatedDepth: 1,
      relatedSeedCount,
      includeRelatedSnippets: false,
      ...pack,
    },
    responseMode,
  );
  return {
    contextPaths: pack.suggestedPaths,
    estimatedOutputTokens: payload.responseStats?.estimatedOutputTokens ?? estimatedTokensFromJson(payload),
  };
}

async function runBenchmarkPass(options) {
  process.env.SCYTHE_CONTEXT_RERANK_MODE = options.rerankMode;
  const methods = [
    benchmarkMethod("rg-smart", options.cases, (testCase) =>
      rgSmartSearch(options.projectPath, testCase.query, options.args.maxResults, options.keywordTerms),
      { excludedPaths: [options.casesRelativePath] },
    ),
  ];
  const responseModes = options.args.compareResponseModes ? ["paths_only", "compact", "snippets"] : [undefined];
  for (const responseMode of responseModes) {
    methods.push(
      benchmarkMethod(
        responseMode ? `scythe-keyword:${responseMode}` : "scythe-keyword",
        options.cases,
        (testCase) => {
          const rawResults = options.searchKeywordOnly({
            dbPath: options.dbPath,
            query: testCase.query,
            maxResults: options.args.maxResults,
            maxSnippetChars: options.args.maxSnippetChars,
            rerankMode: options.rerankMode,
            rerankWeights: options.rerankWeights,
          });
          if (responseMode) {
            const estimate = contextPackResponseEstimate(rawResults, {
              buildContextPack: options.buildContextPack,
              readRelatedFileGraph: options.readRelatedFileGraph,
              shapeContextPackPayload: options.shapeContextPackPayload,
              dbPath: options.dbPath,
              projectPath: options.projectPath,
              query: testCase.query,
              maxContextChars: options.args.maxContextChars,
              searchMode: "hybrid",
              effectiveMode: "keyword",
              rerankMode: options.rerankMode,
            }, responseMode);
            return {
              paths: rawResults,
              contextPaths: estimate.contextPaths,
              estimatedOutputTokens: estimate.estimatedOutputTokens,
            };
          }
          return {
            paths: rawResults,
            contextPaths: contextPathsFromResults(rawResults, options.buildContextPack, options.readRelatedFileGraph, {
              dbPath: options.dbPath,
              query: testCase.query,
              maxContextChars: options.args.maxContextChars,
            }),
          };
        },
        { excludedPaths: [options.casesRelativePath] },
      ),
    );
  }
  const omittedMethods = [];

  if (options.args.includeHybrid) {
    const [{ loadConfig }, { GeminiEmbeddingProvider }] = await Promise.all([
      import(path.join(options.repoRoot, "dist/config.js")),
      import(path.join(options.repoRoot, "dist/providers/gemini.js")),
    ]);
    const config = loadConfig();
    if (!config.gemini.apiKey) {
      for (const responseMode of responseModes) {
        const hybridCases = options.cases.map((testCase) => ({
          id: testCase.id,
          query: testCase.query,
          expectedPaths: testCase.expectedPaths,
          status: "skipped",
          latencyMs: 0,
          paths: [],
          estimatedOutputTokens: estimatedTokensFromJson({ status: "skipped", paths: [], error: "GEMINI_API_KEY is not set" }),
          error: "GEMINI_API_KEY is not set",
          ...metricsFor([], testCase.expectedPaths),
        }));
        methods.push({
          method: responseMode ? `scythe-hybrid:${responseMode}` : "scythe-hybrid",
          summary: summarizeCases(hybridCases),
          cases: hybridCases,
        });
      }
    } else {
      const provider = new GeminiEmbeddingProvider(config.gemini);
      const dimensions = config.gemini.outputDimensionality ?? 1536;

      const hybridCasesByMode = new Map(responseModes.map((responseMode) => [responseMode, []]));
      for (const testCase of options.cases) {
        const startedAt = performance.now();
        try {
          const embedding = await provider.embed({ kind: "query", text: testCase.query });
          if (embedding.dimensions !== dimensions) {
            throw new Error(`Query embedding dimensions mismatch: expected ${dimensions}, got ${embedding.dimensions}`);
          }
          const rawResults = options.searchHybrid({
            dbPath: options.dbPath,
            query: testCase.query,
            dimensions,
            queryVector: embedding.vector,
            maxResults: options.args.maxResults,
            maxSnippetChars: options.args.maxSnippetChars,
            rerankMode: options.rerankMode,
            rerankWeights: options.rerankWeights,
          });
          const paths = uniquePaths(rawResults).filter((candidate) => candidate !== options.casesRelativePath);
          const latencyMs = performance.now() - startedAt;
          for (const responseMode of responseModes) {
            const estimate = responseMode
              ? contextPackResponseEstimate(rawResults, {
                  buildContextPack: options.buildContextPack,
                  readRelatedFileGraph: options.readRelatedFileGraph,
                  shapeContextPackPayload: options.shapeContextPackPayload,
                  dbPath: options.dbPath,
                  projectPath: options.projectPath,
                  query: testCase.query,
                  maxContextChars: options.args.maxContextChars,
                  searchMode: "hybrid",
                  effectiveMode: "hybrid",
                  rerankMode: options.rerankMode,
                }, responseMode)
              : {
                  contextPaths: contextPathsFromResults(rawResults, options.buildContextPack, options.readRelatedFileGraph, {
                    dbPath: options.dbPath,
                    query: testCase.query,
                    maxContextChars: options.args.maxContextChars,
                  }),
                };
            const filteredContextPaths = uniquePaths(estimate.contextPaths).filter((candidate) => candidate !== options.casesRelativePath);
            hybridCasesByMode.get(responseMode).push({
              id: testCase.id,
              query: testCase.query,
              expectedPaths: testCase.expectedPaths,
              status: "ok",
              latencyMs,
              paths,
              contextPaths: filteredContextPaths,
              estimatedOutputTokens:
                estimate.estimatedOutputTokens ??
                estimatedTokensFromJson({
                  status: "ok",
                  paths,
                  contextPaths: filteredContextPaths,
                }),
              ...metricsFor(paths, testCase.expectedPaths),
              context: metricsFor(filteredContextPaths, testCase.expectedPaths),
            });
          }
        } catch (error) {
          for (const responseMode of responseModes) {
            hybridCasesByMode.get(responseMode).push({
              id: testCase.id,
              query: testCase.query,
              expectedPaths: testCase.expectedPaths,
              status: "error",
              latencyMs: performance.now() - startedAt,
              paths: [],
              estimatedOutputTokens: estimatedTokensFromJson({
                status: "error",
                paths: [],
                error: error instanceof Error ? error.message : String(error),
              }),
              error: error instanceof Error ? error.message : String(error),
              ...metricsFor([], testCase.expectedPaths),
            });
          }
        }
      }
      for (const responseMode of responseModes) {
        const hybridCases = hybridCasesByMode.get(responseMode);
        methods.push({
          method: responseMode ? `scythe-hybrid:${responseMode}` : "scythe-hybrid",
          summary: summarizeCases(hybridCases),
          cases: hybridCases,
        });
      }
    }
  } else {
    omittedMethods.push({
      method: "scythe-hybrid",
      reason: "not_requested",
      message: "Gemini-backed hybrid search was not run. Pass --include-hybrid or use npm run bench:context:hybrid to call the configured embedding API.",
    });
  }

  return { rerankMode: options.rerankMode, rerankProfile: options.rerankProfile, methods, omittedMethods };
}

function summaryDelta(autoSummary, offSummary) {
  return {
    hitAt1: autoSummary.hitAt1 - offSummary.hitAt1,
    hitAt3: autoSummary.hitAt3 - offSummary.hitAt3,
    hitAt5: autoSummary.hitAt5 - offSummary.hitAt5,
    mrr: autoSummary.mrr - offSummary.mrr,
    meanOutputTokens: autoSummary.meanOutputTokens - offSummary.meanOutputTokens,
    meanLatencyMs: autoSummary.meanLatencyMs - offSummary.meanLatencyMs,
    p95LatencyMs: autoSummary.p95LatencyMs - offSummary.p95LatencyMs,
  };
}

function compareRerankRuns(runs) {
  const auto = runs.find((run) => run.rerankMode === "auto");
  const off = runs.find((run) => run.rerankMode === "off");
  if (!auto || !off) return [];
  const offByMethod = new Map(off.methods.map((method) => [method.method, method]));
  return auto.methods
    .map((autoMethod) => {
      const offMethod = offByMethod.get(autoMethod.method);
      if (!offMethod) return undefined;
      return {
        method: autoMethod.method,
        auto: autoMethod.summary,
        off: offMethod.summary,
        delta: summaryDelta(autoMethod.summary, offMethod.summary),
      };
    })
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const projectPath = resolveProjectPath(args.project);
  const casesPath = resolveCasesPath(args.cases);
  const casesPathInsideProject = isPathInside(projectPath, casesPath);
  const casesRelativePath = casesPathInsideProject ? normalizeRelativePath(path.relative(projectPath, casesPath)) : undefined;
  const { cases, missingExpected } = readCases(casesPath, projectPath, {
    allowMissingExpected: args.allowMissingExpected,
  });
  const { selectedCases, activeSuites } = filterCasesBySuite(cases, args.suites);
  const rerankProfileConfig = args.rerankProfiles ? readRerankProfiles(args.rerankProfiles) : undefined;
  const dbPath = path.join(projectPath, ".scythe-context", "index.sqlite");

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Index database not found: ${dbPath}. Run repo_reindex first.`);
  }

  const [
    { keywordTerms },
    { searchKeywordOnly, searchHybrid },
    { buildContextPack },
    { readRelatedFileGraph },
    { shapeContextPackPayload },
  ] = await Promise.all([
    import(path.join(repoRoot, "dist/indexing/keywordSearch.js")),
    import(path.join(repoRoot, "dist/indexing/hybridSearch.js")),
    import(path.join(repoRoot, "dist/indexing/contextPack.js")),
    import(path.join(repoRoot, "dist/indexing/relatedFiles.js")),
    import(path.join(repoRoot, "dist/tools/responseShape.js")),
  ]);

  const passOptions = {
    args,
    repoRoot,
    projectPath,
    casesPath,
    casesRelativePath,
    cases: selectedCases,
    dbPath,
    keywordTerms,
    searchKeywordOnly,
    searchHybrid,
    buildContextPack,
    readRelatedFileGraph,
    shapeContextPackPayload,
  };
  const runs = [];
  if (rerankProfileConfig) {
    for (const profile of rerankProfileConfig.profiles) {
      runs.push(
        await runBenchmarkPass({
          ...passOptions,
          rerankMode: profile.rerankMode,
          rerankWeights: profile.weights,
          rerankProfile: profile.name,
        }),
      );
    }
  } else if (args.compareRerank) {
    runs.push(
      await runBenchmarkPass({ ...passOptions, rerankMode: "auto" }),
      await runBenchmarkPass({ ...passOptions, rerankMode: "off" }),
    );
  } else {
    runs.push(await runBenchmarkPass({ ...passOptions, rerankMode: args.rerank }));
  }
  const primaryRun = runs[0];
  const comparisons = args.compareRerank ? compareRerankRuns(runs) : undefined;

  const report = {
    generatedAt: new Date().toISOString(),
    projectPath,
    casesPath,
    benchmarkScope: casesPathInsideProject ? "project-local" : "external-cases",
    suites: activeSuites,
    totalCases: cases.length,
    selectedCases: selectedCases.length,
    missingExpected,
    rerankProfilesPath: rerankProfileConfig?.path,
    rerankProfiles: rerankProfileConfig?.profiles,
    dbPath,
    maxResults: args.maxResults,
    rerankMode: args.compareRerank || rerankProfileConfig ? undefined : args.rerank,
    compareRerank: args.compareRerank,
    compareResponseModes: args.compareResponseModes,
    includeHybrid: args.includeHybrid,
    omittedMethods: primaryRun.omittedMethods,
    methods: primaryRun.methods,
    runs: args.compareRerank || rerankProfileConfig ? runs : undefined,
    comparisons,
  };

  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Context search benchmark`);
  console.log(`Project: ${projectPath}`);
  console.log(`Case file: ${casesPath}`);
  console.log(`Scope: ${casesPathInsideProject ? "project-local" : "external-cases"}`);
  console.log(`Suites: ${activeSuites.join(", ")}`);
  console.log(`Cases: ${selectedCases.length}/${cases.length}`);
  if (missingExpected.length > 0) {
    console.log(`Missing expected paths: ${missingExpected.length} (--allow-missing-expected enabled)`);
  }
  console.log(`Rerank: ${rerankProfileConfig ? `profiles (${rerankProfileConfig.profiles.length})` : args.compareRerank ? "auto vs off" : args.rerank}`);
  console.log(`Response modes: ${args.compareResponseModes ? "paths_only vs compact vs snippets" : "default"}`);
  if (!args.includeHybrid) {
    console.log("Hybrid: omitted. Pass --include-hybrid or use npm run bench:context:hybrid to call the configured embedding API.");
  }
  console.log("");
  if (rerankProfileConfig) {
    console.log("method/profile              ok/skp/err  hit@1  hit@3  hit@5  MRR    out tok  h5/1k tok  mean ms  p95 ms");
    console.log("--------------------------  ----------  -----  -----  -----  -----  -------  ---------  -------  ------");
    for (const run of runs) {
      for (const method of run.methods) {
        const summary = method.summary;
        const label = `${method.method}/${run.rerankProfile ?? run.rerankMode}`;
        console.log(
          `${label.padEnd(26)}  ${String(`${summary.ok}/${summary.skipped}/${summary.errors}`).padStart(10)}  ${summary.hitAt1.toFixed(2).padStart(5)}  ${summary.hitAt3.toFixed(2).padStart(5)}  ${summary.hitAt5.toFixed(2).padStart(5)}  ${summary.mrr.toFixed(2).padStart(5)}  ${summary.meanOutputTokens.toFixed(0).padStart(7)}  ${summary.hitAt5Per1kTokens.toFixed(2).padStart(9)}  ${summary.meanLatencyMs.toFixed(1).padStart(7)}  ${summary.p95LatencyMs.toFixed(1).padStart(6)}`,
        );
      }
    }
    return;
  }
  if (args.compareRerank) {
    console.log("method           hit@1 auto/off/Δ   hit@3 auto/off/Δ   hit@5 auto/off/Δ   MRR auto/off/Δ     out tok Δ  mean ms Δ  p95 ms Δ");
    console.log("---------------  ---------------  ---------------  ---------------  ---------------  ---------  ---------  --------");
    for (const comparison of comparisons) {
      const { method, auto, off, delta } = comparison;
      const metric = (name) => `${auto[name].toFixed(2)}/${off[name].toFixed(2)}/${delta[name] >= 0 ? "+" : ""}${delta[name].toFixed(2)}`;
      console.log(
        `${method.padEnd(15)}  ${metric("hitAt1").padStart(15)}  ${metric("hitAt3").padStart(15)}  ${metric("hitAt5").padStart(15)}  ${metric("mrr").padStart(15)}  ${delta.meanOutputTokens.toFixed(0).padStart(9)}  ${delta.meanLatencyMs.toFixed(1).padStart(9)}  ${delta.p95LatencyMs.toFixed(1).padStart(8)}`,
      );
    }
    return;
  }

  console.log("method                        ok/skp/err  hit@1  hit@3  hit@5  MRR    out tok  h5/1k tok  mean ms  p95 ms");
  console.log("----------------------------  ----------  -----  -----  -----  -----  -------  ---------  -------  ------");
  for (const method of primaryRun.methods) {
    const summary = method.summary;
    console.log(
      `${method.method.padEnd(28)}  ${String(`${summary.ok}/${summary.skipped}/${summary.errors}`).padStart(10)}  ${summary.hitAt1.toFixed(2).padStart(5)}  ${summary.hitAt3.toFixed(2).padStart(5)}  ${summary.hitAt5.toFixed(2).padStart(5)}  ${summary.mrr.toFixed(2).padStart(5)}  ${summary.meanOutputTokens.toFixed(0).padStart(7)}  ${summary.hitAt5Per1kTokens.toFixed(2).padStart(9)}  ${summary.meanLatencyMs.toFixed(1).padStart(7)}  ${summary.p95LatencyMs.toFixed(1).padStart(6)}`,
    );
  }

  console.log("");
  console.log("Misses:");
  for (const method of primaryRun.methods) {
    const misses = method.cases.filter((item) => item.status === "ok" && !item.hitAt5);
    if (misses.length === 0) continue;
    console.log(`- ${method.method}: ${misses.map((item) => item.id).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
