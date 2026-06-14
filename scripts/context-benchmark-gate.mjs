#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_SUITE = "full";
const DEFAULT_MIN_HIT5 = 1;
const DEFAULT_MIN_MRR = 0.85;
const DEFAULT_MAX_COMPACT_TOKENS = 2300;
const DEFAULT_MAX_HYBRID_COMPACT_TOKENS = 2600;

function printHelp() {
  console.log(`Usage: node scripts/context-benchmark-gate.mjs [options]

Builds/refreshes the local benchmark index, runs the context response-mode
benchmark, and fails when retrieval quality or compact output size regresses.

Options:
  --project <path>                       Project to benchmark. Defaults to cwd.
  --cases <path>                         Benchmark cases path. Defaults to bundled cases.
  --suite <name[,name]>                  Suite tags to run. Defaults to ${DEFAULT_SUITE}.
  --include-hybrid                       Also gate Gemini-backed hybrid results. Calls the configured embedding API.
  --min-hit5 <n>                         Minimum hit@5 for Scythe methods. Defaults to ${DEFAULT_MIN_HIT5}.
  --min-mrr <n>                          Minimum MRR for Scythe methods. Defaults to ${DEFAULT_MIN_MRR}.
  --max-compact-tokens <n>               Max mean output tokens for scythe-keyword:compact. Defaults to ${DEFAULT_MAX_COMPACT_TOKENS}.
  --max-hybrid-compact-tokens <n>        Max mean output tokens for scythe-hybrid:compact. Defaults to ${DEFAULT_MAX_HYBRID_COMPACT_TOKENS}.
`);
}

function parseArgs(argv) {
  const args = {
    project: process.cwd(),
    cases: undefined,
    suite: DEFAULT_SUITE,
    includeHybrid: false,
    minHit5: DEFAULT_MIN_HIT5,
    minMrr: DEFAULT_MIN_MRR,
    maxCompactTokens: DEFAULT_MAX_COMPACT_TOKENS,
    maxHybridCompactTokens: DEFAULT_MAX_HYBRID_COMPACT_TOKENS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };

    switch (arg) {
      case "--project":
        args.project = next();
        break;
      case "--cases":
        args.cases = next();
        break;
      case "--suite":
        args.suite = next();
        break;
      case "--include-hybrid":
        args.includeHybrid = true;
        break;
      case "--min-hit5":
        args.minHit5 = Number(next());
        break;
      case "--min-mrr":
        args.minMrr = Number(next());
        break;
      case "--max-compact-tokens":
        args.maxCompactTokens = Number(next());
        break;
      case "--max-hybrid-compact-tokens":
        args.maxHybridCompactTokens = Number(next());
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  for (const key of ["minHit5", "minMrr", "maxCompactTokens", "maxHybridCompactTokens"]) {
    if (!Number.isFinite(args[key]) || args[key] < 0) {
      throw new Error(`${key} must be a non-negative number`);
    }
  }
  return args;
}

function providerCapabilityKeyInput(config, dimensions) {
  return {
    provider: "gemini",
    baseUrl: config.gemini.baseUrl,
    model: config.gemini.model,
    dimensions,
    authMode: config.gemini.authMode,
  };
}

async function refreshIndex({ repoRoot, projectPath, includeHybrid }) {
  const [{ loadConfig }, { persistentReindexMetadata }, { createConfiguredStructureExtractor }] = await Promise.all([
    import(path.join(repoRoot, "dist/config.js")),
    import(path.join(repoRoot, "dist/indexing/indexWriter.js")),
    import(path.join(repoRoot, "dist/indexing/structureExtractorFactory.js")),
  ]);
  const config = loadConfig();
  const dimensions = config.gemini.outputDimensionality ?? 1536;
  const metadata = await persistentReindexMetadata({
    projectPath,
    indexDirName: config.indexDirName,
    vectorDimensions: dimensions,
    maxFileBytes: config.indexing.maxFileBytes,
    targetChunkChars: config.indexing.targetChunkChars,
    chunkOverlapChars: config.indexing.chunkOverlapChars,
    maxChunksPerFile: config.indexing.maxChunksPerFile,
    structureExtractor: await createConfiguredStructureExtractor(config.structure),
  });

  if (!includeHybrid) return metadata;
  if (!config.gemini.apiKey) {
    throw new Error("--include-hybrid requires GEMINI_API_KEY in the benchmark process environment");
  }

  const [{ indexMissingEmbeddings }, { GeminiEmbeddingProvider }, capabilitiesModule] = await Promise.all([
    import(path.join(repoRoot, "dist/indexing/embeddingWriter.js")),
    import(path.join(repoRoot, "dist/providers/gemini.js")),
    import(path.join(repoRoot, "dist/providers/capabilities.js")),
  ]);
  const indexPath = path.join(projectPath, config.indexDirName);
  const capabilityInput = providerCapabilityKeyInput(config, dimensions);
  const provider = new GeminiEmbeddingProvider(config.gemini);
  await indexMissingEmbeddings({
    dbPath: metadata.dbPath,
    providerName: "gemini",
    providerBaseUrl: config.gemini.baseUrl,
    model: config.gemini.model,
    dimensions,
    batchSize: config.indexing.embeddingBatchSize,
    maxChunks: config.indexing.maxEmbeddingChunks,
    provider,
    capabilities: capabilitiesModule.findProviderCapability(indexPath, capabilityInput),
    onCapabilitiesUpdated: (update) => {
      capabilitiesModule.updateProviderCapability(indexPath, capabilityInput, update);
    },
  });
  capabilitiesModule.updateProviderCapability(indexPath, capabilityInput, {
    outputDimensionality: "supported",
    lastSuccessAt: new Date().toISOString(),
  });

  return metadata;
}

function runBenchmark({ repoRoot, projectPath, args }) {
  const benchmarkArgs = [
    path.join(repoRoot, "scripts/context-benchmark.mjs"),
    "--project",
    projectPath,
    "--suite",
    args.suite,
    "--compare-response-modes",
    "--json",
  ];
  if (args.cases) benchmarkArgs.push("--cases", args.cases);
  if (args.includeHybrid) benchmarkArgs.push("--include-hybrid");

  const result = spawnSync(process.execPath, benchmarkArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(result.stdout);
    throw new Error(`context benchmark failed with exit code ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function methodByName(report, name) {
  const method = report.methods.find((item) => item.method === name);
  if (!method) throw new Error(`Benchmark report is missing method: ${name}`);
  return method;
}

function assertThreshold(condition, message, failures) {
  if (!condition) failures.push(message);
}

function checkScytheMethod(method, thresholds, failures) {
  const summary = method.summary;
  assertThreshold(
    summary.ok === summary.cases && summary.errors === 0 && summary.skipped === 0,
    `${method.method}: expected all cases ok, got ok/skipped/errors ${summary.ok}/${summary.skipped}/${summary.errors}`,
    failures,
  );
  assertThreshold(
    summary.hitAt5 >= thresholds.minHit5,
    `${method.method}: hit@5 ${summary.hitAt5.toFixed(3)} < ${thresholds.minHit5}`,
    failures,
  );
  assertThreshold(
    summary.mrr >= thresholds.minMrr,
    `${method.method}: MRR ${summary.mrr.toFixed(3)} < ${thresholds.minMrr}`,
    failures,
  );
}

function checkReport(report, args) {
  const failures = [];
  const keywordMethods = [
    "scythe-keyword:paths_only",
    "scythe-keyword:compact",
    "scythe-keyword:snippets",
  ].map((name) => methodByName(report, name));
  for (const method of keywordMethods) checkScytheMethod(method, args, failures);

  const keywordCompact = methodByName(report, "scythe-keyword:compact");
  assertThreshold(
    keywordCompact.summary.meanOutputTokens <= args.maxCompactTokens,
    `scythe-keyword:compact mean output tokens ${keywordCompact.summary.meanOutputTokens.toFixed(0)} > ${args.maxCompactTokens}`,
    failures,
  );

  if (args.includeHybrid) {
    const hybridMethods = [
      "scythe-hybrid:paths_only",
      "scythe-hybrid:compact",
      "scythe-hybrid:snippets",
    ].map((name) => methodByName(report, name));
    for (const method of hybridMethods) checkScytheMethod(method, args, failures);
    const hybridCompact = methodByName(report, "scythe-hybrid:compact");
    assertThreshold(
      hybridCompact.summary.meanOutputTokens <= args.maxHybridCompactTokens,
      `scythe-hybrid:compact mean output tokens ${hybridCompact.summary.meanOutputTokens.toFixed(0)} > ${args.maxHybridCompactTokens}`,
      failures,
    );
  }

  return failures;
}

function printSummary(report, args) {
  console.log(`Context benchmark gate`);
  console.log(`Project: ${report.projectPath}`);
  console.log(`Suites: ${report.suites.join(", ")}`);
  console.log(`Cases: ${report.selectedCases}/${report.totalCases}`);
  console.log(`Hybrid: ${args.includeHybrid ? "included" : "not included"}`);
  console.log("");
  for (const method of report.methods.filter((item) => item.method.startsWith("scythe-"))) {
    const summary = method.summary;
    console.log(
      `${method.method.padEnd(28)} hit@5 ${summary.hitAt5.toFixed(2)}  MRR ${summary.mrr.toFixed(2)}  out tok ${summary.meanOutputTokens.toFixed(0)}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const projectPath = path.resolve(args.project);
  await refreshIndex({ repoRoot, projectPath, includeHybrid: args.includeHybrid });
  const report = runBenchmark({ repoRoot, projectPath, args });
  printSummary(report, args);
  const failures = checkReport(report, args);
  if (failures.length > 0) {
    console.error("");
    console.error("Benchmark gate failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log("Benchmark gate passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
