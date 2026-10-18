#!/usr/bin/env node
// Benchmark-only: production search continues to use mergeHybridResults.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

export function fuseRrf(semantic, keyword, limit, rankConstant = 60) {
  if (!Number.isInteger(rankConstant) || rankConstant < 1) throw new Error("rankConstant must be a positive integer");
  const merged = new Map();
  for (const [results, type] of [[semantic, "semantic"], [keyword, "keyword"]]) {
    const seen = new Set();
    results.forEach((result, index) => {
      const key = `${result.path}:${result.startLine}:${result.endLine}`;
      if (seen.has(key)) return;
      seen.add(key);
      const existing = merged.get(key);
      const item = existing ?? { ...result, score: 0, matchTypes: [] };
      delete item.matchType;
      item.score += 1 / (rankConstant + index + 1);
      item.matchTypes.push(type);
      if (type === "keyword") item.keywordScore = result.score;
      if (result.snippet.length > item.snippet.length) item.snippet = result.snippet;
      merged.set(key, item);
    });
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, limit);
}

export function metrics(results, expectedPaths) {
  const paths = [...new Set(results.map((item) => item.path))];
  const rank = paths.findIndex((item) => expectedPaths.includes(item)) + 1;
  return {
    paths,
    hit1: Number(rank === 1),
    hit3: Number(rank > 0 && rank <= 3),
    hit5: Number(rank > 0 && rank <= 5),
    mrr: rank ? 1 / rank : 0,
  };
}

async function main(argv) {
  const options = { maxResults: 8, rankConstant: 60 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") {
      console.log(`Usage: node scripts/hybrid-fusion-benchmark.mjs --project <path> --cases <json> --output <json>
  --max-results <n>       Final chunk limit, default 8; candidates per channel are twice this.
  --rank-constant <n>     RRF constant, default 60.
Requires a fresh index with complete configured embedding coverage. Calls the configured
embedding API once per query; never indexes or embeds source. Cases must be outside
the target project. Reports keyword, current and RRF, both before and after reranking.
Also reports RRF scaled to the current top score to expose reranker scale sensitivity.`);
      return;
    }
    const keys = { "--project": "project", "--cases": "cases", "--output": "output", "--max-results": "maxResults", "--rank-constant": "rankConstant" };
    if (!keys[arg] || !argv[i + 1]) throw new Error(`Unknown argument or missing value: ${arg}`);
    options[keys[arg]] = argv[++i];
  }
  for (const name of ["project", "cases", "output"]) {
    if (!options[name]) throw new Error(`Missing --${name}`);
    options[name] = path.resolve(options[name]);
  }
  for (const name of ["maxResults", "rankConstant"]) {
    options[name] = Number(options[name]);
    if (!Number.isInteger(options[name]) || options[name] < 1) throw new Error(`${name} must be a positive integer`);
  }
  const casesRelative = path.relative(options.project, options.cases);
  if (casesRelative === "" || (!casesRelative.startsWith(`..${path.sep}`) && casesRelative !== ".." && !path.isAbsolute(casesRelative))) {
    throw new Error("Keep benchmark cases outside the indexed project to prevent query leakage");
  }
  const cases = JSON.parse(fs.readFileSync(options.cases, "utf8"));
  if (!Array.isArray(cases) || cases.length === 0) throw new Error("Cases must be a non-empty array");
  const ids = new Set();
  for (const item of cases) {
    if (!item.id || ids.has(item.id) || typeof item.query !== "string" || !item.query.trim() ||
        !Array.isArray(item.expectedPaths) || !item.expectedPaths.length) throw new Error("Invalid or duplicate case");
    ids.add(item.id);
    for (const file of item.expectedPaths) {
      const relative = path.relative(options.project, path.resolve(options.project, file));
      if (path.isAbsolute(file) || relative.startsWith(`..${path.sep}`) || relative === ".." || !fs.statSync(path.join(options.project, file)).isFile()) {
        throw new Error(`Invalid expected path in ${item.id}`);
      }
    }
  }
  const [{ loadConfig }, { createOperations }, { GeminiEmbeddingProvider }, { searchByKeyword }, { searchByVector }, { mergeHybridResults, searchKeywordOnly }, { rerankCodeAware }] = await Promise.all([
    import("../dist/config.js"), import("../dist/core/operations.js"), import("../dist/providers/gemini.js"),
    import("../dist/indexing/keywordSearch.js"), import("../dist/indexing/semanticSearch.js"),
    import("../dist/indexing/hybridSearch.js"), import("../dist/indexing/codeAwareReranker.js"),
  ]);
  const config = loadConfig();
  if (!config.gemini.apiKey) throw new Error("Configured embedding credentials are required");
  const operations = createOperations(config);
  const status = await operations.repo_index_status.run({ project_path: options.project });
  // Use engine status, including provider/endpoint/model/dimension-specific coverage.
  if (!status.index.exists || status.freshness.status !== "fresh" || status.embeddingCoverage.missingChunks !== 0 || status.embeddingCoverage.embeddings === 0) {
    throw new Error("A fresh index with complete configured embedding coverage is required");
  }
  const dbPath = path.join(options.project, config.indexDirName, "index.sqlite");
  const dimensions = config.gemini.outputDimensionality ?? 1536;
  const embeddingSet = {
    provider: "gemini", model: config.gemini.model, dimensions,
    baseUrlHash: createHash("sha256").update(config.gemini.baseUrl).digest("hex"),
  };
  const provider = new GeminiEmbeddingProvider(config.gemini);
  const report = {
    generatedAt: new Date().toISOString(), project: options.project,
    settings: { maxResults: options.maxResults, rankConstant: options.rankConstant, candidateLimit: options.maxResults * 2, dimensions, model: config.gemini.model },
    coverage: status.embeddingCoverage, queryEmbeddingRequests: 0, cases: [],
  };
  for (const item of cases) {
    const started = performance.now();
    const embedding = await provider.embed({ kind: "query", text: item.query }).catch(() => {
      throw new Error(`Embedding request failed for ${item.id}; provider response omitted to protect credentials`);
    });
    report.queryEmbeddingRequests++;
    if (embedding.dimensions !== dimensions) throw new Error(`Query dimension mismatch for ${item.id}`);
    const embeddingMs = performance.now() - started;
    const searchOptions = { dbPath, query: item.query, maxResults: options.maxResults * 2, maxSnippetChars: 1200 };
    const retrievalStart = performance.now();
    const keyword = searchByKeyword(searchOptions);
    const semantic = searchByVector({ ...searchOptions, dimensions, embeddingSet, queryVector: embedding.vector });
    if (!semantic.length) throw new Error(`No vector candidates for ${item.id}`);
    const retrievalMs = performance.now() - retrievalStart;
    const limit = options.maxResults * 3;
    const fusionStart = performance.now();
    const current = mergeHybridResults(semantic, keyword, limit);
    const currentFusionMs = performance.now() - fusionStart;
    const rrfStart = performance.now();
    const rrf = fuseRrf(semantic, keyword, limit, options.rankConstant);
    const rrfFusionMs = performance.now() - rrfStart;
    const scale = current[0].score / rrf[0].score;
    const scaled = rrf.map((result) => ({ ...result, score: result.score * scale }));
    const variants = {};
    for (const [name, candidates] of Object.entries({ current, rrf, rrfScaled: scaled })) {
      const rerankStart = performance.now();
      const ranked = rerankCodeAware({ ...searchOptions, maxResults: options.maxResults, results: candidates });
      variants[name] = {
        raw: metrics(candidates.slice(0, options.maxResults), item.expectedPaths),
        reranked: metrics(ranked, item.expectedPaths),
        rerankMs: performance.now() - rerankStart,
      };
    }
    const keywordResults = searchKeywordOnly({ ...searchOptions, maxResults: options.maxResults });
    report.cases.push({ ...item, embeddingMs, retrievalMs, currentFusionMs, rrfFusionMs, keyword: metrics(keywordResults, item.expectedPaths), variants });
    console.error(`Completed ${report.cases.length}/${cases.length}: ${item.id}`);
  }
  const average = (values) => Object.fromEntries(["hit1", "hit3", "hit5", "mrr"].map((key) => [key, values.reduce((sum, value) => sum + value[key], 0) / values.length]));
  report.summary = { keyword: average(report.cases.map((item) => item.keyword)) };
  for (const name of ["current", "rrf", "rrfScaled"]) {
    report.summary[name] = Object.fromEntries(["raw", "reranked"].map((stage) => [stage, average(report.cases.map((item) => item.variants[name][stage]))]));
  }
  report.comparisons = Object.fromEntries(["rrf", "rrfScaled"].map((name) => {
    const changes = report.cases.map((item) => ({ id: item.id, deltaMrr: item.variants[name].reranked.mrr - item.variants.current.reranked.mrr }));
    return [name, { improved: changes.filter((item) => item.deltaMrr > 0), regressed: changes.filter((item) => item.deltaMrr < 0), tied: changes.filter((item) => item.deltaMrr === 0).length }];
  }));
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: options.output, cases: cases.length, queryEmbeddingRequests: report.queryEmbeddingRequests, summary: report.summary }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
