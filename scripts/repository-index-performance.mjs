#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
};
const scenarios = ["fresh", "unchanged", "edit_one"];
if (args.includes("--help")) {
  console.log("Usage: node scripts/repository-index-performance.mjs --cases cases.json --baseline /baseline/dist [--candidate ./dist] [--snapshots /snapshot/root] [--runs 3] [--output report.json] [--search-policy identical|no-hit-regression] [--require-candidate-hits]\nCases: {repos:[{repo,commit,path,editPath,queries:[{query,expectedPath}]}]}. Source snapshots are read as data and copied into temporary repositories. No project commands or embeddings are executed.");
} else if (args.includes("--worker")) {
  const options = JSON.parse(value("--worker"));
  const load = (file) => import(pathToFileURL(path.resolve(options.dist, file)).href);
  const { persistentReindexMetadata } = await load("indexing/indexWriter.js");
  const { searchKeywordOnly } = await load("indexing/hybridSearch.js");
  const project = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-real-index-"));
  try {
    await fs.cp(options.repo.path, project, { recursive: true, dereference: false,
      filter: async (source) => ![".git", ".scythe-context", ".repo-beacon", "node_modules"].includes(path.basename(source)) && !(await fs.lstat(source)).isSymbolicLink() });
    const editPath = path.resolve(project, options.repo.editPath);
    if (!editPath.startsWith(project + path.sep)) throw new Error("Edit path must stay inside the temporary snapshot");
    const measurements = [];
    for (const scenario of scenarios) {
      if (scenario === "edit_one") await fs.appendFile(editPath, `\n${editPath.endsWith(".py") ? "#" : "//"} scythe benchmark single-file edit\n`);
      const rssBefore = process.memoryUsage().rss;
      const start = performance.now();
      const result = await persistentReindexMetadata({ projectPath: project, indexDirName: ".scythe-context", vectorDimensions: 3 });
      const indexMs = performance.now() - start;
      const rssAfter = process.memoryUsage().rss;
      const db = new Database(result.dbPath, { readonly: true });
      const digest = createHash("sha256");
      try {
        // Compare logical rows, excluding database ids, timestamps, and implementation caches.
        for (const sql of [
          "select path, hash from files order by path",
          "select files.path, start_line, end_line, chunks.hash, chunks.text from chunks join files on files.id = chunks.file_id order by files.path, start_line, end_line, chunks.hash",
          "select files.path, name, kind, line, signature, exported from file_symbols join files on files.id = file_symbols.file_id order by files.path, name, kind, line, signature, exported",
          "select files.path, specifier, resolved_path, line from file_dependencies join files on files.id = file_dependencies.file_id order by files.path, specifier, resolved_path, line",
        ]) {
          digest.update(sql);
          for (const row of db.prepare(sql).iterate()) digest.update(JSON.stringify(row) + "\n");
        }
      } finally { db.close(); }
      const probes = [];
      for (const probe of options.repo.queries) {
        const timings = [];
        let ranked;
        for (let iteration = 0; iteration < 10; iteration++) {
          const start = performance.now();
          ranked = searchKeywordOnly({ dbPath: result.dbPath, query: probe.query, maxResults: 5, maxSnippetChars: 800 });
          timings.push(performance.now() - start);
        }
        // Keep baseline misses visible rather than selecting easier probes after seeing results.
        probes.push({ query: probe.query, expectedPath: probe.expectedPath, hit: ranked.some((row) => row.path === probe.expectedPath), timings, results: ranked.map(({ path, startLine, endLine, snippet }) => ({ path, startLine, endLine, snippet })) });
      }
      measurements.push({ scenario, indexMs, rssBefore, rssAfter, stats: result.stats, digest: digest.digest("hex"), probes });
    }
    console.log(JSON.stringify({ measurements, processPeakRssMiB: process.resourceUsage().maxRSS / 1024 }));
  } finally { await fs.rm(project, { recursive: true, force: true }); }
} else {
  const casesPath = value("--cases");
  const baseline = value("--baseline");
  const candidate = value("--candidate", "dist");
  const runs = Number(value("--runs", 3));
  if (!casesPath || !baseline || !Number.isInteger(runs) || runs < 1) throw new Error("--cases, --baseline and positive integer --runs are required");
  const searchPolicy = value("--search-policy", "identical");
  if (!["identical", "no-hit-regression"].includes(searchPolicy)) throw new Error("Unknown search policy");
  const requireCandidateHits = args.includes("--require-candidate-hits");
  let changedSearchPayloads = 0;
  const cases = JSON.parse(await fs.readFile(casesPath, "utf8"));
  const snapshots = value("--snapshots");
  for (const repo of cases.repos) {
    repo.path ??= snapshots ? path.join(path.resolve(snapshots), repo.repo.split("/").at(-1)) : undefined;
    if (!repo.path) throw new Error("Each case needs path or --snapshots");
  }
  const measurements = [];
  for (const repo of cases.repos) {
    for (let run = 0; run < runs; run++) {
      const pair = {};
      // Alternate order to reduce systematic cache/order bias.
      for (const label of run % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const dist = label === "baseline" ? baseline : candidate;
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", JSON.stringify({ repo, dist })], { encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
        if (child.error || child.status !== 0) throw new Error(`${repo.repo} ${label}: ${child.error?.message ?? child.stderr}`);
        const result = JSON.parse(child.stdout);
        pair[label] = result;
        measurements.push({ repo: repo.repo, commit: repo.commit, run: run + 1, label, ...result });
        console.log(`${repo.repo} ${label} run ${run + 1}: ${result.measurements.map((row) => `${row.scenario}=${row.indexMs.toFixed(1)}ms`).join(" ")}`);
      }
      for (let index = 0; index < scenarios.length; index++) {
        const a = pair.baseline.measurements[index], b = pair.candidate.measurements[index];
        if (a.digest !== b.digest) throw new Error(`${repo.repo}: logical index differs in ${a.scenario}`);
        const changed = JSON.stringify(a.probes.map((probe) => probe.results)) !== JSON.stringify(b.probes.map((probe) => probe.results));
        if (changed && searchPolicy === "identical") throw new Error(`${repo.repo}: search differs in ${a.scenario}`);
        if (changed) changedSearchPayloads++;
        for (let probe = 0; probe < a.probes.length; probe++) {
          if (a.probes[probe].hit && !b.probes[probe].hit) throw new Error(`${repo.repo}: lost expected-source hit for ${a.probes[probe].query}`);
          if (requireCandidateHits && !b.probes[probe].hit) throw new Error(`${repo.repo}: candidate missed ${b.probes[probe].query}`);
        }
      }
    }
  }
  const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
  const summary = cases.repos.flatMap((repo) => scenarios.map((scenario) => {
    const row = { repo: repo.repo, scenario };
    for (const label of ["baseline", "candidate"]) {
      const workers = measurements.filter((item) => item.repo === repo.repo && item.label === label);
      const samples = workers.map((item) => item.measurements.find((item) => item.scenario === scenario));
      row[`${label}Ms`] = percentile(samples.map((item) => item.indexMs), 0.5);
      row[`${label}ProbeHits`] = samples[0].probes.filter((probe) => probe.hit).length;
      row[`${label}ProbeCount`] = samples[0].probes.length;
      row[`${label}SearchMedianMs`] = percentile(samples.flatMap((item) => item.probes.flatMap((probe) => probe.timings)), 0.5);
      row[`${label}SearchP95Ms`] = percentile(samples.flatMap((item) => item.probes.flatMap((probe) => probe.timings)), 0.95);
      row[`${label}PeakRssMiB`] = Math.max(...workers.map((item) => item.processPeakRssMiB));
      if (label === "candidate") { row.files = samples[0].stats.indexedFiles; row.bytes = samples[0].stats.bytes; row.chunkedFiles = samples[0].stats.chunkedFiles; }
    }
    row.reductionPercent = (row.baselineMs - row.candidateMs) / row.baselineMs * 100;
    return row;
  }));
  const report = { searchPipeline: "searchKeywordOnly", searchPolicy, requireCandidateHits, changedSearchPayloads, node: process.version, platform: process.platform, arch: process.arch, runs, cases: cases.repos, summary, measurements,
    notes: "Fixed external snapshots; alternating baseline/candidate order; source data only, no setup/build scripts or embeddings. Fresh means no index; OS caches not cleared. Search uses the production keyword-only pipeline, excluding transport/context packing. Peak RSS includes snapshot copying, indexing, equivalence checks, and search; not an isolated indexing peak. Logical index digests match for every pair; search payloads follow the recorded searchPolicy. Every previously successful expected-source probe is retained. Expected-source misses are retained as retrieval findings, not counted as successes." };
  const output = value("--output");
  if (output) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
  console.table(summary.map(({ repo, scenario, files, baselineMs, candidateMs, reductionPercent }) => ({ repo, scenario, files, baselineMs, candidateMs, reductionPercent })));
}
