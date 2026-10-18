#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function argumentValue(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} needs a value`);
  return args[index + 1];
}

function parseArguments(args) {
  const snapshots = argumentValue(args, "--snapshots");
  const baseline = argumentValue(args, "--baseline");
  const candidate = argumentValue(args, "--candidate", "dist");
  if (!snapshots || !baseline) throw new Error("--snapshots and --baseline are required");
  return {
    snapshots, baseline, candidate,
    cases: argumentValue(args, "--cases", "benchmarks/navigation-repositories.json"),
    output: argumentValue(args, "--output"),
  };
}

async function copySnapshot(source, directory) {
  await fs.cp(source, directory, {
    recursive: true, dereference: false,
    filter: async (file) => ![".git", ".scythe-context", ".repo-beacon", "node_modules"].includes(path.basename(file))
      && !(await fs.lstat(file)).isSymbolicLink(),
  });
}

function readIndexSnapshot(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const digest = createHash("sha256");
    for (const sql of [
      "select files.path,start_line,end_line,chunks.hash from chunks join files on files.id=chunks.file_id order by files.path,start_line,end_line,chunks.hash",
      "select files.path,name,kind,line,signature,exported from file_symbols join files on files.id=file_symbols.file_id order by files.path,name,kind,line,signature,exported",
    ]) {
      for (const row of db.prepare(sql).iterate()) digest.update(JSON.stringify(row) + "\n");
    }
    const graph = db.prepare("select files.path,specifier,resolved_path as target,line from file_dependencies join files on files.id=file_dependencies.file_id order by files.path,specifier,line,target").all();
    return { chunksAndSymbolsDigest: digest.digest("hex"), graph };
  } finally {
    db.close();
  }
}

function evaluateEdges(example, dbPath, readRelatedFiles, assertExpected) {
  return example.edges.map((probe) => {
    const source = readRelatedFiles({ dbPath, filePath: probe.from, maxResults: 200 });
    const target = probe.target === null ? undefined : readRelatedFiles({ dbPath, filePath: probe.target, maxResults: 200 });
    const matches = source.imports.filter((item) => item.specifier === probe.specifier);
    assert(matches.length, `Missing import text: ${example.repo} ${probe.specifier}`);
    const hit = matches.some((item) => item.resolvedPath === probe.target);
    if (assertExpected) {
      assert(hit, `${example.repo} wrong target: ${probe.specifier}`);
      if (target) {
        assert(target.importedBy.some((item) => item.path === probe.from && item.specifier === probe.specifier), "Missing reverse edge");
      }
    }
    return { ...probe, hit, imports: matches };
  });
}

function evaluateQueries(example, dbPath, searchKeywordOnly, assertExpected) {
  return example.queries.map((probe) => {
    const ranked = searchKeywordOnly({ dbPath, query: probe.query, maxResults: 5, maxSnippetChars: 800 });
    const hit = ranked.some((item) => item.path === probe.expectedPath);
    if (assertExpected) assert(hit, `Candidate search missed ${example.repo} ${probe.query}`);
    return { ...probe, hit, paths: ranked.map((item) => item.path) };
  });
}

async function assertCliMcpParity(load, dist, directory, file) {
  const { loadConfig } = await load("config.js");
  const { registerTools } = await load("tools/registerTools.js");
  const config = loadConfig();
  config.defaultProjectPath = directory;
  config.indexDirName = ".scythe-context";
  config.gemini.outputDimensionality = 3;
  const server = new McpServer({ name: "navigation-eval", version: "1.0.0" });
  registerTools(server, config);
  const client = new Client({ name: "navigation-eval-client", version: "1.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const response = await client.callTool({ name: "repo_related_files", arguments: {
      path: file, project_path: directory, max_results: 100, response_mode: "full",
    } });
    assert(!response.isError, "MCP related operation failed");
    const { stdout } = await promisify(execFile)(process.execPath, [
      path.resolve(dist, "command.js"), "related", file, "--project", directory,
      "--max-results", "100", "--format", "full", "--json",
    ], {
      timeout: 10000,
      env: { ...process.env, SCYTHE_CONTEXT_INDEX_DIR: ".scythe-context", GEMINI_OUTPUT_DIMENSIONALITY: "3" },
    });
    assert.deepEqual(JSON.parse(stdout), JSON.parse(response.content[0].text), "CLI/MCP payloads differ");
  } finally {
    await client.close();
    await server.close();
  }
}

async function evaluateVersion(example, dist, snapshots, isCandidate) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-nav-eval-"));
  try {
    await copySnapshot(path.join(snapshots, example.directory), directory);
    const load = (file) => import(pathToFileURL(path.resolve(dist, file)).href);
    const { persistentReindexMetadata } = await load("indexing/indexWriter.js");
    const { readRelatedFiles } = await load("indexing/relatedFiles.js");
    const { searchKeywordOnly } = await load("indexing/hybridSearch.js");
    const index = await persistentReindexMetadata({ projectPath: directory, indexDirName: ".scythe-context", vectorDimensions: 3 });
    const snapshot = readIndexSnapshot(index.dbPath);
    const edges = evaluateEdges(example, index.dbPath, readRelatedFiles, isCandidate);
    const queries = evaluateQueries(example, index.dbPath, searchKeywordOnly, isCandidate);
    if (isCandidate) await assertCliMcpParity(load, dist, directory, example.edges[0].from);
    return { stats: index.stats, chunksAndSymbolsDigest: snapshot.chunksAndSymbolsDigest, edges, queries, graph: snapshot.graph };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function compareVersions(example, baseline, candidate) {
  assert.equal(baseline.chunksAndSymbolsDigest, candidate.chunksAndSymbolsDigest, `${example.repo} chunks/symbols changed`);
  for (let index = 0; index < example.queries.length; index++) {
    if (baseline.queries[index].hit) assert(candidate.queries[index].hit, "Lost baseline source hit");
  }
  const before = new Set(baseline.graph.filter((row) => row.target).map((row) => JSON.stringify(row)));
  const after = new Set(candidate.graph.filter((row) => row.target).map((row) => JSON.stringify(row)));
  const added = [...after].filter((row) => !before.has(row)).map((row) => JSON.parse(row));
  const removed = [...before].filter((row) => !after.has(row)).map((row) => JSON.parse(row));
  const { graph: baselineGraph, ...baselineReport } = baseline;
  const { graph: candidateGraph, ...candidateReport } = candidate;
  return {
    repo: example.repo, commit: example.commit, sourcePath: example.sourcePath ?? ".",
    baseline: baselineReport, candidate: candidateReport, added, removed, cliMcpParity: true,
  };
}

async function evaluateRepository(example, options) {
  const baseline = await evaluateVersion(example, options.baseline, options.snapshots, false);
  const candidate = await evaluateVersion(example, options.candidate, options.snapshots, true);
  const result = compareVersions(example, baseline, candidate);
  const baselineHits = baseline.edges.filter((edge) => edge.hit).length;
  const candidateHits = candidate.edges.filter((edge) => edge.hit).length;
  console.log(`${example.repo}: edge probes ${baselineHits}/${example.edges.length} -> ${candidateHits}/${example.edges.length}, +${result.added.length}/-${result.removed.length} resolved edges; chunks/symbols stable; CLI/MCP equal`);
  return result;
}

async function main(args) {
  if (args.includes("--help")) {
    console.log("Usage: node scripts/navigation-evaluation.mjs --snapshots /snapshot/root --baseline /baseline/dist [--candidate dist] [--cases benchmarks/navigation-repositories.json] [--output local/report.json]\nReads fixed source snapshots only; no target project scripts, package installs, or embedding requests.");
    return;
  }
  const options = parseArguments(args);
  const cases = JSON.parse(await fs.readFile(options.cases, "utf8"));
  const results = [];
  for (const example of cases.repos) results.push(await evaluateRepository(example, options));
  const report = {
    baseline: options.baseline, candidate: options.candidate, node: process.version, platform: process.platform, results,
    notes: "Fixed commit source archives, indexed as data without project commands or embeddings. Expected edges and reverse edges must resolve in candidate; source probes may not regress. Chunks/symbols remain equal. Dependency graph changes are recorded, not hidden. One index per version/repository; not a performance benchmark.",
  };
  if (options.output) {
    await fs.mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await fs.writeFile(options.output, JSON.stringify(report, null, 2) + "\n");
  }
}

await main(process.argv.slice(2));
