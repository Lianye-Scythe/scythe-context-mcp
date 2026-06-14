#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const DEFAULT_CASES_PATH = "benchmarks/context-search-cases.json";

function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    cases: DEFAULT_CASES_PATH,
    maxResults: 8,
    maxSnippetChars: 1200,
    maxContextChars: 16000,
    includeHybrid: false,
    rerank: process.env.SCYTHE_CONTEXT_RERANK_MODE || "auto",
    json: false,
    output: undefined,
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
      case "--rerank":
        args.rerank = next();
        break;
      case "--json":
        args.json = true;
        break;
      case "--output":
        args.output = next();
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

  return args;
}

function printHelp() {
  console.log(`Usage: npm run bench:context -- [options]

Options:
  --project <path>             Project to benchmark. Defaults to cwd.
  --cases <path>               JSON case file. Defaults to ${DEFAULT_CASES_PATH}.
  --max-results <n>            Ranked results to keep per method. Defaults to 8.
  --include-hybrid             Also run Gemini-backed hybrid search.
  --rerank <auto|off>          Code-aware reranking mode. Defaults to env or auto.
  --json                       Print JSON instead of a table.
  --output <path>              Write JSON report to a file.
`);
}

function readCases(casesPath) {
  const raw = fs.readFileSync(casesPath, "utf8");
  const cases = JSON.parse(raw);
  if (!Array.isArray(cases)) throw new Error("Benchmark cases must be a JSON array");
  return cases.map((item, index) => {
    if (!item.id || !item.query || !Array.isArray(item.expectedPaths) || item.expectedPaths.length === 0) {
      throw new Error(`Invalid benchmark case at index ${index}`);
    }
    return item;
  });
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
  const excludedPaths = new Set((options.excludedPaths ?? []).map(normalizeRelativePath));
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
      caseResults.push({
        id: testCase.id,
        query: testCase.query,
        expectedPaths: testCase.expectedPaths,
        status: result.status ?? "ok",
        latencyMs,
        paths,
        contextPaths,
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

function contextPathsFromResults(rawResults, buildContextPack, readRelatedFileGraph, options) {
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
  return pack.suggestedPaths;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const projectPath = path.resolve(args.project);
  const casesPath = path.resolve(args.cases);
  const casesRelativePath = normalizeRelativePath(path.relative(projectPath, casesPath));
  const cases = readCases(casesPath);
  const dbPath = path.join(projectPath, ".scythe-context", "index.sqlite");
  process.env.SCYTHE_CONTEXT_RERANK_MODE = args.rerank;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Index database not found: ${dbPath}. Run repo_reindex first.`);
  }

  const [
    { keywordTerms },
    { searchKeywordOnly, searchHybrid },
    { buildContextPack },
    { readRelatedFileGraph },
  ] = await Promise.all([
    import(path.join(repoRoot, "dist/indexing/keywordSearch.js")),
    import(path.join(repoRoot, "dist/indexing/hybridSearch.js")),
    import(path.join(repoRoot, "dist/indexing/contextPack.js")),
    import(path.join(repoRoot, "dist/indexing/relatedFiles.js")),
  ]);

  const methods = [
    benchmarkMethod("rg-smart", cases, (testCase) =>
      rgSmartSearch(projectPath, testCase.query, args.maxResults, keywordTerms),
      { excludedPaths: [casesRelativePath] },
    ),
    benchmarkMethod("scythe-keyword", cases, (testCase) => {
      const rawResults = searchKeywordOnly({
        dbPath,
        query: testCase.query,
        maxResults: args.maxResults,
        maxSnippetChars: args.maxSnippetChars,
        rerankMode: args.rerank,
      });
      return {
        paths: rawResults,
        contextPaths: contextPathsFromResults(rawResults, buildContextPack, readRelatedFileGraph, {
          dbPath,
          query: testCase.query,
          maxContextChars: args.maxContextChars,
        }),
      };
    }, { excludedPaths: [casesRelativePath] }),
  ];

  if (args.includeHybrid) {
    const [{ loadConfig }, { GeminiEmbeddingProvider }] = await Promise.all([
      import(path.join(repoRoot, "dist/config.js")),
      import(path.join(repoRoot, "dist/providers/gemini.js")),
    ]);
    const config = loadConfig();
    if (!config.gemini.apiKey) {
      const hybridCases = cases.map((testCase) => ({
        id: testCase.id,
        query: testCase.query,
        expectedPaths: testCase.expectedPaths,
        status: "skipped",
        latencyMs: 0,
        paths: [],
        error: "GEMINI_API_KEY is not set",
        ...metricsFor([], testCase.expectedPaths),
      }));
      methods.push({
        method: "scythe-hybrid",
        summary: summarizeCases(hybridCases),
        cases: hybridCases,
      });
    } else {
      const provider = new GeminiEmbeddingProvider(config.gemini);
      const dimensions = config.gemini.outputDimensionality ?? 1536;

      const hybridCases = [];
      for (const testCase of cases) {
        const startedAt = performance.now();
        try {
          const embedding = await provider.embed({ kind: "query", text: testCase.query });
          if (embedding.dimensions !== dimensions) {
            throw new Error(`Query embedding dimensions mismatch: expected ${dimensions}, got ${embedding.dimensions}`);
          }
          const rawResults = searchHybrid({
            dbPath,
            query: testCase.query,
            dimensions,
            queryVector: embedding.vector,
            maxResults: args.maxResults,
            maxSnippetChars: args.maxSnippetChars,
            rerankMode: args.rerank,
          });
          const paths = uniquePaths(rawResults).filter((candidate) => candidate !== casesRelativePath);
          const contextPaths = contextPathsFromResults(rawResults, buildContextPack, readRelatedFileGraph, {
            dbPath,
            query: testCase.query,
            maxContextChars: args.maxContextChars,
          });
          const filteredContextPaths = uniquePaths(contextPaths).filter((candidate) => candidate !== casesRelativePath);
          hybridCases.push({
            id: testCase.id,
            query: testCase.query,
            expectedPaths: testCase.expectedPaths,
            status: "ok",
            latencyMs: performance.now() - startedAt,
            paths,
            contextPaths: filteredContextPaths,
            ...metricsFor(paths, testCase.expectedPaths),
            context: metricsFor(filteredContextPaths, testCase.expectedPaths),
          });
        } catch (error) {
          hybridCases.push({
            id: testCase.id,
            query: testCase.query,
            expectedPaths: testCase.expectedPaths,
            status: "error",
            latencyMs: performance.now() - startedAt,
            paths: [],
            error: error instanceof Error ? error.message : String(error),
            ...metricsFor([], testCase.expectedPaths),
          });
        }
      }
      methods.push({
        method: "scythe-hybrid",
        summary: summarizeCases(hybridCases),
        cases: hybridCases,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    projectPath,
    casesPath,
    dbPath,
    maxResults: args.maxResults,
    rerankMode: args.rerank,
    methods,
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
  console.log(`Cases: ${cases.length}`);
  console.log(`Rerank: ${args.rerank}`);
  console.log("");
  console.log("method           ok/skp/err  hit@1  hit@3  hit@5  MRR    mean ms  p95 ms");
  console.log("---------------  ----------  -----  -----  -----  -----  -------  ------");
  for (const method of methods) {
    const summary = method.summary;
    console.log(
      `${method.method.padEnd(15)}  ${String(`${summary.ok}/${summary.skipped}/${summary.errors}`).padStart(10)}  ${summary.hitAt1.toFixed(2).padStart(5)}  ${summary.hitAt3.toFixed(2).padStart(5)}  ${summary.hitAt5.toFixed(2).padStart(5)}  ${summary.mrr.toFixed(2).padStart(5)}  ${summary.meanLatencyMs.toFixed(1).padStart(7)}  ${summary.p95LatencyMs.toFixed(1).padStart(6)}`,
    );
  }

  console.log("");
  console.log("Misses:");
  for (const method of methods) {
    const misses = method.cases.filter((item) => item.status === "ok" && !item.hitAt5);
    if (misses.length === 0) continue;
    console.log(`- ${method.method}: ${misses.map((item) => item.id).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
