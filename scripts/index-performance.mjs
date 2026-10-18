#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const scenarios = ["fresh", "unchanged", "edit_one", "add_target", "remove_target", "manifest_change"];
const args = process.argv.slice(2);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
};
const files = Number(value("--files", 1000));
const runs = Number(value("--runs", 3));
if (!Number.isInteger(files) || files < 2 || !Number.isInteger(runs) || runs < 1) throw new Error("--files >= 2 and --runs >= 1 must be integers");
if (args.includes("--help")) {
  console.log("Usage: node scripts/index-performance.mjs [--files 1000] [--runs 3] [--output report.json]\nLocal synthetic indexing/search timings; no embeddings. Each scenario uses a fresh child process and temporary repository. 'fresh' means no index, not an empty OS disk cache.");
} else if (args.includes("--worker")) {
  const scenario = value("--worker");
  if (!scenarios.includes(scenario)) throw new Error("Unknown worker scenario");
  const { persistentReindexMetadata } = await import("../dist/indexing/indexWriter.js");
  const { readRelatedFiles } = await import("../dist/indexing/relatedFiles.js");
  const { searchByKeyword } = await import("../dist/indexing/keywordSearch.js");
  const { rerankCodeAware } = await import("../dist/indexing/codeAwareReranker.js");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-index-perf-"));
  try {
    await fs.mkdir(path.join(directory, "src"));
    await fs.mkdir(path.join(directory, "internal/auth"), { recursive: true });
    await fs.mkdir(path.join(directory, "cmd"));
    for (let index = 0; index < files; index++) {
      const name = `file${String(index).padStart(6, "0")}`;
      const imports = index === 0 ? 'import { value } from "./file000001";\nimport { optional } from "./optional";\n' : "";
      const content = imports + Array.from({ length: 20 }, (_, member) => `export function ${name}_member${member}(input: string) { return input + "token validation ${index} ${member}"; }`).join("\n") + "\n";
      await fs.writeFile(path.join(directory, "src", `${name}.ts`), content);
    }
    await fs.writeFile(path.join(directory, "go.mod"), "module example.com/shop\n");
    await fs.writeFile(path.join(directory, "internal/auth/token.go"), "package auth\nfunc ValidateToken() bool { return true }\n");
    await fs.writeFile(path.join(directory, "cmd/main.go"), 'package main\nimport "example.com/shop/internal/auth"\n');
    const options = { projectPath: directory, indexDirName: ".scythe-context", vectorDimensions: 3 };
    if (scenario !== "fresh") await persistentReindexMetadata(options);
    if (scenario === "edit_one") await fs.appendFile(path.join(directory, "src/file000001.ts"), "export const changed = true;\n");
    if (scenario === "add_target") await fs.writeFile(path.join(directory, "src/optional.ts"), "export const optional = true;\n");
    if (scenario === "remove_target") await fs.rm(path.join(directory, "src/file000001.ts"));
    if (scenario === "manifest_change") await fs.writeFile(path.join(directory, "go.mod"), "module example.com/renamed\n");
    const rssBefore = process.memoryUsage().rss;
    const start = performance.now();
    const result = await persistentReindexMetadata(options);
    const indexMs = performance.now() - start;
    const rssAfter = process.memoryUsage().rss;
    const source = readRelatedFiles({ dbPath: result.dbPath, filePath: "src/file000000.ts", maxResults: 10 });
    const expected = { "./file000001": scenario === "remove_target" ? null : "src/file000001.ts", "./optional": scenario === "add_target" ? "src/optional.ts" : null };
    for (const [specifier, target] of Object.entries(expected)) {
      if (source.imports.find((item) => item.specifier === specifier)?.resolvedPath !== target) throw new Error(`Incorrect edge: ${scenario} ${specifier}`);
    }
    const go = readRelatedFiles({ dbPath: result.dbPath, filePath: "cmd/main.go", maxResults: 10 });
    if (go.imports[0]?.resolvedPath !== (scenario === "manifest_change" ? null : "internal/auth/token.go")) throw new Error("Incorrect Go manifest edge");
    const searchTimes = [];
    for (let i = 0; i < 20; i++) {
      const searchStart = performance.now();
      const results = searchByKeyword({ dbPath: result.dbPath, query: "file000000_member0", maxResults: 8, maxSnippetChars: 800 });
      const ranked = rerankCodeAware({ dbPath: result.dbPath, query: "file000000_member0", results, maxResults: 4, maxSnippetChars: 800 });
      if (ranked[0]?.path !== "src/file000000.ts") throw new Error("Search did not return expected source");
      searchTimes.push(performance.now() - searchStart);
    }
    console.log(JSON.stringify({ scenario, indexMs, searchMs: searchTimes, rssBefore, rssAfter, processPeakRssBytes: process.resourceUsage().maxRSS * 1024, stats: result.stats }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
} else {
  const measurements = [];
  for (const scenario of scenarios) {
    for (let run = 0; run < runs; run++) {
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", scenario, "--files", String(files)], { encoding: "utf8", timeout: 120000, maxBuffer: 1024 * 1024 });
      if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stderr);
      measurements.push({ run: run + 1, ...JSON.parse(child.stdout) });
    }
  }
  const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * ratio) - 1)];
  const summary = scenarios.map((scenario) => {
    const rows = measurements.filter((row) => row.scenario === scenario);
    const searches = rows.flatMap((row) => row.searchMs);
    return { scenario, indexMedianMs: percentile(rows.map((row) => row.indexMs), 0.5), searchMedianMs: percentile(searches, 0.5), searchP95Ms: percentile(searches, 0.95), processPeakRssMiB: Math.max(...rows.map((row) => row.processPeakRssBytes)) / 1024 ** 2 };
  });
  const report = { kind: "synthetic-index-performance", node: process.version, platform: process.platform, arch: process.arch, files, runs, notes: "Fresh temporary index per worker; OS caches not cleared. Search includes keyword + rerank, no CLI/MCP transport. Process peak RSS includes setup, warm-up, and search; not an isolated indexing peak. No embedding calls.", summary, measurements };
  const output = value("--output");
  if (output) { await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
  console.table(summary);
}
