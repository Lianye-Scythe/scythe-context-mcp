#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scanProject } from "../dist/indexing/scanner.js";
import { regexStructureExtractor } from "../dist/indexing/structureExtractor.js";
import {
  createExperimentalTreeSitterStructureExtractor,
  isTreeSitterCandidatePath,
} from "../dist/indexing/experimental/treeSitterStructure.js";

function printHelp() {
  console.log(`Usage: node scripts/tree-sitter-spike.mjs [--project <path>] [--grammar-dir <path>]

Runs the current experimental tree-sitter structure extractor skeleton against a
project and prints comparison metrics. This does not call embedding APIs.
`);
}

function parseArgs(argv) {
  const args = { project: process.cwd(), grammarDir: process.env.SCYTHE_CONTEXT_TREE_SITTER_GRAMMAR_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--project") {
      index += 1;
      if (index >= argv.length) throw new Error("--project requires a value");
      args.project = argv[index];
      continue;
    }
    if (arg === "--grammar-dir") {
      index += 1;
      if (index >= argv.length) throw new Error("--grammar-dir requires a value");
      args.grammarDir = argv[index];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function graphKey(graph) {
  return JSON.stringify({
    symbols: graph.symbols.map((symbol) => [symbol.name, symbol.kind, symbol.line, symbol.exported]),
    dependencies: graph.dependencies.map((dependency) => [dependency.specifier, dependency.line]),
  });
}

async function main() {
  const startedAt = performance.now();
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const projectPath = path.resolve(args.project);
  const limits = {
    maxFileBytes: 1_000_000,
    targetChunkChars: 4_000,
    chunkOverlapChars: 400,
    maxChunksPerFile: 200,
  };
  const scan = await scanProject(projectPath, limits);
  const extractor = await createExperimentalTreeSitterStructureExtractor({
    grammarDir: args.grammarDir ? path.resolve(args.grammarDir) : undefined,
  });
  let candidateFiles = 0;
  let changedFiles = 0;
  let regexSymbols = 0;
  let experimentalSymbols = 0;
  let regexDependencies = 0;
  let experimentalDependencies = 0;
  const changedSamples = [];

  for (const file of scan.files) {
    if (!isTreeSitterCandidatePath(file.relativePath)) continue;
    candidateFiles += 1;
    const content = await fs.readFile(file.absolutePath, "utf8");
    const regexGraph = regexStructureExtractor.extractFileGraph(file.relativePath, content);
    const experimentalGraph = extractor.extractFileGraph(file.relativePath, content);
    regexSymbols += regexGraph.symbols.length;
    experimentalSymbols += experimentalGraph.symbols.length;
    regexDependencies += regexGraph.dependencies.length;
    experimentalDependencies += experimentalGraph.dependencies.length;
    if (graphKey(regexGraph) !== graphKey(experimentalGraph)) {
      changedFiles += 1;
      if (changedSamples.length < 10) changedSamples.push(file.relativePath);
    }
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  console.log("Tree-sitter spike");
  console.log(`Project: ${projectPath}`);
  console.log(`Repo root: ${repoRoot}`);
  console.log(`Parser wired: ${extractor.parserAvailable ? "yes" : "no"}`);
  if (extractor.fallbackReason) console.log(`Fallback reason: ${extractor.fallbackReason}`);
  if (extractor.loadedLanguages.length > 0) console.log(`Loaded languages: ${extractor.loadedLanguages.join(", ")}`);
  console.log(`Candidate TS/JS files: ${candidateFiles}`);
  console.log(`Changed files: ${changedFiles}`);
  console.log(`Regex symbols/dependencies: ${regexSymbols}/${regexDependencies}`);
  console.log(`Experimental symbols/dependencies: ${experimentalSymbols}/${experimentalDependencies}`);
  console.log(`Elapsed: ${elapsedMs}ms`);
  if (changedSamples.length > 0) {
    console.log(`Changed samples: ${changedSamples.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
