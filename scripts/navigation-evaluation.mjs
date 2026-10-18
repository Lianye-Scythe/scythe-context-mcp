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

const args = process.argv.slice(2);
const value = (flag, fallback) => { const index = args.indexOf(flag); if (index < 0) return fallback; if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${flag} needs a value`); return args[index + 1]; };
if (args.includes("--help")) {
  console.log("Usage: node scripts/navigation-evaluation.mjs --snapshots /snapshot/root --baseline /baseline/dist [--candidate dist] [--cases benchmarks/navigation-repositories.json] [--output local/report.json]\nReads fixed source snapshots only; no target project scripts, package installs, or embedding requests.");
} else {
  const snapshots = value("--snapshots"), baseline = value("--baseline"), candidate = value("--candidate", "dist");
  if (!snapshots || !baseline) throw new Error("--snapshots and --baseline are required");
  const cases = JSON.parse(await fs.readFile(value("--cases", "benchmarks/navigation-repositories.json"), "utf8"));
  const results = [];
  for (const example of cases.repos) {
    const pair = {};
    for (const [label, dist] of [["baseline", baseline], ["candidate", candidate]]) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-nav-eval-"));
      try {
        await fs.cp(path.join(snapshots, example.directory), directory, { recursive: true, dereference: false,
          filter: async (file) => ![".git", ".scythe-context", ".repo-beacon", "node_modules"].includes(path.basename(file)) && !(await fs.lstat(file)).isSymbolicLink() });
        const load = (file) => import(pathToFileURL(path.resolve(dist, file)).href);
        const { persistentReindexMetadata } = await load("indexing/indexWriter.js");
        const { readRelatedFiles } = await load("indexing/relatedFiles.js");
        const { searchKeywordOnly } = await load("indexing/hybridSearch.js");
        const index = await persistentReindexMetadata({ projectPath: directory, indexDirName: ".scythe-context", vectorDimensions: 3 });
        const db = new Database(index.dbPath, { readonly: true });
        const digest = createHash("sha256");
        let graph;
        try {
          for (const sql of [
            "select files.path,start_line,end_line,chunks.hash from chunks join files on files.id=chunks.file_id order by files.path,start_line,end_line,chunks.hash",
            "select files.path,name,kind,line,signature,exported from file_symbols join files on files.id=file_symbols.file_id order by files.path,name,kind,line,signature,exported",
          ]) for (const row of db.prepare(sql).iterate()) digest.update(JSON.stringify(row) + "\n");
          graph = db.prepare("select files.path,specifier,resolved_path as target,line from file_dependencies join files on files.id=file_dependencies.file_id order by files.path,specifier,line,target").all();
        } finally { db.close(); }
        const edges = example.edges.map((probe) => {
          const source = readRelatedFiles({ dbPath: index.dbPath, filePath: probe.from, maxResults: 200 });
          const target = probe.target === null ? undefined : readRelatedFiles({ dbPath: index.dbPath, filePath: probe.target, maxResults: 200 });
          const matches = source.imports.filter((item) => item.specifier === probe.specifier);
          assert(matches.length, `Missing import text: ${example.repo} ${probe.specifier}`);
          const hit = matches.some((item) => item.resolvedPath === probe.target);
          if (label === "candidate") { assert(hit, `${example.repo} wrong target: ${probe.specifier}`); if (target) assert(target.importedBy.some((item) => item.path === probe.from && item.specifier === probe.specifier), "Missing reverse edge"); }
          return { ...probe, hit, imports: matches };
        });
        const queries = example.queries.map((probe) => {
          const ranked = searchKeywordOnly({ dbPath: index.dbPath, query: probe.query, maxResults: 5, maxSnippetChars: 800 });
          const hit = ranked.some((item) => item.path === probe.expectedPath);
          if (label === "candidate") assert(hit, `Candidate search missed ${example.repo} ${probe.query}`);
          return { ...probe, hit, paths: ranked.map((item) => item.path) };
        });
        if (label === "candidate") {
          const { loadConfig } = await load("config.js");
          const { registerTools } = await load("tools/registerTools.js");
          const config = loadConfig(); config.defaultProjectPath = directory; config.indexDirName = ".scythe-context"; config.gemini.outputDimensionality = 3;
          const server = new McpServer({ name: "navigation-eval", version: "1.0.0" }); registerTools(server, config);
          const client = new Client({ name: "navigation-eval-client", version: "1.0.0" });
          const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
          try {
            const file = example.edges[0].from;
            const response = await client.callTool({ name: "repo_related_files", arguments: { path: file, project_path: directory, max_results: 100, response_mode: "full" } });
            assert(!response.isError, "MCP related operation failed");
            const { stdout } = await promisify(execFile)(process.execPath, [path.resolve(dist, "command.js"), "related", file, "--project", directory, "--max-results", "100", "--format", "full", "--json"], {
              timeout: 10000, env: { ...process.env, SCYTHE_CONTEXT_INDEX_DIR: ".scythe-context", GEMINI_OUTPUT_DIMENSIONALITY: "3" },
            });
            assert.deepEqual(JSON.parse(stdout), JSON.parse(response.content[0].text), "CLI/MCP payloads differ");
          } finally { await client.close(); await server.close(); }
        }
        pair[label] = { stats: index.stats, chunksAndSymbolsDigest: digest.digest("hex"), edges, queries, graph };
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    }
    assert.equal(pair.baseline.chunksAndSymbolsDigest, pair.candidate.chunksAndSymbolsDigest, `${example.repo} chunks/symbols changed`);
    for (let index = 0; index < example.queries.length; index++) if (pair.baseline.queries[index].hit) assert(pair.candidate.queries[index].hit, "Lost baseline source hit");
    const before = new Set(pair.baseline.graph.filter((row) => row.target).map((row) => JSON.stringify(row)));
    const after = new Set(pair.candidate.graph.filter((row) => row.target).map((row) => JSON.stringify(row)));
    const added = [...after].filter((row) => !before.has(row)).map((row) => JSON.parse(row));
    const removed = [...before].filter((row) => !after.has(row)).map((row) => JSON.parse(row));
    delete pair.baseline.graph; delete pair.candidate.graph;
    results.push({ repo: example.repo, commit: example.commit, sourcePath: example.sourcePath ?? ".", ...pair, added, removed, cliMcpParity: true });
    console.log(`${example.repo}: edge probes ${pair.baseline.edges.filter((edge) => edge.hit).length}/${example.edges.length} -> ${pair.candidate.edges.filter((edge) => edge.hit).length}/${example.edges.length}, +${added.length}/-${removed.length} resolved edges; chunks/symbols stable; CLI/MCP equal`);
  }
  const output = value("--output");
  const report = { baseline, candidate, node: process.version, platform: process.platform, results,
    notes: "Fixed commit source archives, indexed as data without project commands or embeddings. Expected edges and reverse edges must resolve in candidate; source probes may not regress. Chunks/symbols remain equal. Dependency graph changes are recorded, not hidden. One index per version/repository; not a performance benchmark." };
  if (output) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
}
