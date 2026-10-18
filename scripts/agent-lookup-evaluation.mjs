#!/usr/bin/env node
// Source-checkout-only, explicitly API/account-backed pilot. Never run in CI.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { isQuotaBlocked, mayResumeQuotaRun, lookupOperational } from "./agent-lookup-events.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (args[i] === "--help") {
    console.log("Usage: node scripts/agent-lookup-evaluation.mjs --sources-root <prepared snapshots> --output <report.json> --model <same configured model> --reasoning <same configured effort> [--max-runs 36]\nRequires fresh metadata and complete configured vectors in each source snapshot. Uses Codex account usage and the configured embedding service. Each run is a new ephemeral session; pilot only, one repetition per task/group.");
    process.exit(0);
  }
  if (!["--sources-root", "--output", "--model", "--reasoning", "--max-runs", "--tasks", "--resume-from"].includes(args[i]) || !args[i + 1]) throw new Error("Invalid arguments; use --help");
  options[args[i].slice(2)] = args[i + 1];
}
for (const key of ["sources-root", "output", "model", "reasoning"]) if (!options[key]) throw new Error(`Missing --${key}`);
const output = path.resolve(options.output);
const evidenceDir = output.replace(/\.json$/, "") + "-runs";
fs.mkdirSync(evidenceDir, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "benchmarks/agent-lookup-tasks.json"), "utf8"));
const driverHash = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const manifestHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
const schema = {
  type: "object", additionalProperties: false,
  properties: { file: { type: "string" }, symbol: { type: "string" }, start_line: { type: "integer" }, end_line: { type: "integer" }, quote: { type: "string" }, answer: { type: "string" } },
  required: ["file", "symbol", "start_line", "end_line", "quote", "answer"],
};
const schemaPath = path.join(evidenceDir, "answer-schema.json");
fs.writeFileSync(schemaPath, JSON.stringify(schema));
const report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, "utf8")) : {
  generatedAt: new Date().toISOString(), driverHash, manifestHash, model: options.model, reasoning: options.reasoning,
  codexVersion: spawnSync("codex", ["--version"], { encoding: "utf8" }).stdout.trim(),
  scytheCommit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).stdout.trim(),
  scope: manifest.scope, selectedTasks: options.tasks ?? null, repetitions: 1, timeoutSeconds: 120, runs: [],
  initialization: { vectorsReused: true, coldEmbeddingSeconds: null, coldEmbeddingBilling: null },
};
if (options["resume-from"] && !fs.existsSync(output)) {
  const previousPath = path.resolve(options["resume-from"]);
  const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
  if (previous.manifestHash !== manifestHash || previous.model !== options.model || previous.reasoning !== options.reasoning || previous.selectedTasks !== (options.tasks ?? null) || previous.scytheCommit !== report.scytheCommit || previous.codexVersion !== report.codexVersion) throw new Error("Resume conditions differ");
  const previousDir = previousPath.replace(/\.json$/, "") + "-runs";
  report.previousReport = previousPath;
  report.previousDriverHash = previous.driverHash;
  report.initialization = previous.initialization;
  report.quotaBlockedAttempts = [...(previous.quotaBlockedAttempts ?? [])];
  for (const run of previous.runs) {
    const events = fs.readFileSync(path.join(previousDir, run.id + ".jsonl"), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
    if (mayResumeQuotaRun(run, events)) report.quotaBlockedAttempts.push(run);
    else {
      const operational = lookupOperational(run.commands, run.scytheCalls, run.group);
      if (operational !== run.checks.lookupOperational) {
        run.validationCorrection = { originalLookupOperational: run.checks.lookupOperational, reason: "Distinguish an rg exclude glob from a Scythe invocation; original report retained" };
        run.checks.lookupOperational = operational;
        run.evidenceChecksPassed = Object.values(run.checks).every(Boolean);
      }
      report.runs.push(run);
      for (const suffix of [".jsonl", ".stderr", "-answer.json"]) {
        const file = path.join(previousDir, run.id + suffix);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(evidenceDir, run.id + suffix));
      }
    }
  }
}
if (report.selectedTasks !== (options.tasks ?? null) || report.driverHash !== driverHash || report.manifestHash !== manifestHash || report.model !== options.model || report.reasoning !== options.reasoning) throw new Error("Cannot resume with different model/effort");
const groups = ["rg", "keyword", "hybrid"];
const normalize = (value) => value.replace(/\s+/g, " ").trim();
function hashes(dir) {
  const result = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".scythe-context", ".git", "bench-bin"].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) for (const [key, value] of Object.entries(hashes(file))) result[`${entry.name}/${key}`] = value;
    else if (entry.isFile()) result[entry.name] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  }
  return result;
}
function cli(args, project) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, "dist/command.js"), ...args, "--project", project, "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) throw new Error("Snapshot status/index preparation failed; raw provider diagnostics omitted");
  return JSON.parse(result.stdout);
}
const sources = new Map();
for (const source of manifest.repositories) {
  const project = path.resolve(options["sources-root"], source.name);
  const status = cli(["status"], project);
  if (status.freshness.status !== "fresh" || status.embeddingCoverage.missingChunks || !status.embeddingCoverage.embeddings) throw new Error(`Fresh complete vectors required for ${source.name}`);
  for (const task of source.tasks) {
    const text = fs.readFileSync(path.join(project, task.expectedFile), "utf8");
    if (!task.evidenceAnchors.every((anchor) => text.includes(anchor))) throw new Error(`Invalid evidence anchors for ${task.id}`);
  }
  sources.set(source.name, { project, coverage: status.embeddingCoverage });
}
if (!report.initialization.metadataCold) {
  report.initialization.metadataCold = {};
  for (const [name, source] of sources) {
    const cold = fs.mkdtempSync(path.join(os.tmpdir(), "scythe-cold-index-"));
    fs.cpSync(source.project, cold, { recursive: true, filter: (file) => ![".scythe-context", ".git"].includes(path.basename(file)) });
    const started = performance.now();
    const result = cli(["index"], cold);
    report.initialization.metadataCold[name] = { seconds: (performance.now() - started) / 1000, stats: result.stats };
    fs.rmSync(cold, { recursive: true, force: true });
  }
}
report.initialization.coverage = Object.fromEntries([...sources].map(([name, source]) => [name, source.coverage]));
let scheduled = 0;
const tasks = manifest.repositories.flatMap((source) => source.tasks.map((task) => ({ source, task }))).map((item, taskIndex) => ({ ...item, taskIndex }));
const selected = options.tasks?.split(",");
if (selected?.some((id) => !tasks.some((item) => item.task.id === id))) throw new Error("Unknown task selection");
for (const { taskIndex, source, task } of tasks.filter((item) => !selected || selected.includes(item.task.id))) {
  for (let offset = 0; offset < groups.length; offset++) {
    const group = groups[(taskIndex + offset) % groups.length];
    const id = `${task.id}-${group}`;
    if (report.runs.some((run) => run.id === id)) continue;
    if (scheduled++ >= Number(options["max-runs"] ?? 36)) break;
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "scythe-agent-lookup-"));
    const startedPreparation = performance.now();
    fs.cpSync(sources.get(source.name).project, fixture, { recursive: true, preserveTimestamps: true });
    fs.rmSync(path.join(fixture, ".git"), { recursive: true, force: true });
    // No target-project configuration, hooks, skills or source code are executed.
    spawnSync("git", ["init", "-q"], { cwd: fixture });
    // The index is scoped to a project root. Rebase only this private copied fixture,
    // preserving chunk/vector IDs; ordinary indexing must not mix old/new project roots.
    const db = new Database(path.join(fixture, ".scythe-context", "index.sqlite"));
    const roots = db.prepare("select distinct project_path from files").all();
    if (roots.length !== 1) throw new Error("Expected a single-project source index");
    db.prepare("update files set project_path = ?").run(fixture);
    db.close();
    cli(["index"], fixture);
    const status = cli(["status"], fixture);
    if (status.freshness.status !== "fresh" || status.embeddingCoverage.missingChunks) throw new Error("Copied snapshot coverage/freshness changed");
    const preparationMs = performance.now() - startedPreparation;
    const bin = path.join(fixture, ".scythe-context", "bench-bin");
    fs.mkdirSync(bin);
    const tracePath = path.join(fixture, ".scythe-context", "lookup-trace.jsonl");
    // Transparent CLI wrapper pins the assigned project/mode and records actual Scythe usage.
    fs.writeFileSync(path.join(bin, "scythe-context"), `#!${process.execPath}
const fs=require('node:fs');
(async()=>{
const args=process.argv.slice(2), mode=${JSON.stringify(group)};
if(mode==='rg'){console.error('Scythe disabled for baseline');process.exitCode=1;return}
process.chdir(${JSON.stringify(repoRoot)});
await import(${JSON.stringify(import.meta.resolve("dotenv/config"))});
const {main}=await import(${JSON.stringify(new URL("../dist/main.js", import.meta.url).href)});
let output=''; const log=console.log;
console.log=(...values)=>{output+=values.join(' ')+'\\n';log(...values)};
const code=await main([...args,'--project',${JSON.stringify(fixture)},...(['context','search'].includes(args[0])?['--mode',mode]:[])],'help');
const effectiveMode=output.match(/Mode: (\\w+)/)?.[1]??null;
fs.appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({args,mode,effectiveMode,exitCode:code,outputChars:output.length})+'\\n');
process.exitCode=output.length?code:1;
})().catch((error)=>{fs.appendFileSync(${JSON.stringify(tracePath)},JSON.stringify({args:process.argv.slice(2),mode:${JSON.stringify(group)},exitCode:1,outputChars:0,errorType:error.name,errorCode:error.code})+'\\n');console.error('Scythe evaluation wrapper failed');process.exitCode=1});
`, { mode: 0o755 });
    const before = hashes(fixture);
    const method = group === "rg"
      ? "Use rg, directory listings and direct source reads. Do not use Scythe."
      : `For an unknown location, start with ${JSON.stringify(path.join(bin, "scythe-context"))} context \"your query\" --mode ${group} --format compact --max-results 3 --max-context-chars 2400. You may refine searches, use rg for exact strings, and directly read source. For a known identifier or path, rg/direct reads are appropriate immediately.`;
    const prompt = `Read-only code lookup evaluation. Work only in this temporary repository. ${method}
Do not use skills, MCP, web/network tools, subagents, other repositories, credentials/environment files, benchmark manifests or index internals. The provided Scythe wrapper may access its configured embedding service; do not inspect the wrapper. Do not edit source, configuration or the index, install packages, or run target-project code. Metadata/vectors are prepared. Keep command outputs bounded. Stop once sufficient source evidence is found.
Task: ${task.prompt}
Return the implementation file relative to this repository, symbol, start/end lines covering the relevant behavior, an exact short source quote without line-number prefixes, and a concise answer grounded in the code. Do not guess from prior knowledge.`;
    const eventPath = path.join(evidenceDir, `${id}.jsonl`);
    const errorPath = path.join(evidenceDir, `${id}.stderr`);
    const answerPath = path.join(evidenceDir, `${id}-answer.json`);
    const eventFd = fs.openSync(eventPath, "w");
    const errorFd = fs.openSync(errorPath, "w");
    const started = performance.now();
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH };
    for (const key of Object.keys(env)) if (/^(GEMINI_|SCYTHE_CONTEXT_|REPO_BEACON_)/.test(key)) delete env[key];
    const child = spawn("codex", ["exec", "--ignore-user-config", "--ephemeral", "--json", "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--sandbox", "workspace-write", "-C", fixture, "-m", options.model, "-c", `model_reasoning_effort=${JSON.stringify(options.reasoning)}`, "-c", 'sandbox_workspace_write.network_access=true', "-c", 'approval_policy="never"', "--output-schema", schemaPath, "-o", answerPath, prompt], { cwd: fixture, env, detached: true, stdio: ["ignore", eventFd, errorFd] });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 120_000);
    const exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    clearTimeout(timeout);
    fs.closeSync(eventFd); fs.closeSync(errorFd);
    const wallSeconds = (performance.now() - started) / 1000;
    const events = fs.readFileSync(eventPath, "utf8").split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    const completed = events.filter((event) => event.type === "item.completed").map((event) => event.item);
    const commands = completed.filter((item) => item.type === "command_execution");
    const usage = events.findLast((event) => event.type === "turn.completed")?.usage ?? null;
    let answer = null;
    try { answer = JSON.parse(fs.readFileSync(answerPath, "utf8")); } catch {}
    const sourceText = fs.readFileSync(path.join(fixture, task.expectedFile), "utf8");
    const span = answer ? sourceText.split("\n").slice(answer.start_line - 1, answer.end_line).join("\n") : "";
    const outputs = commands.map((item) => item.aggregated_output ?? "").join("\n");
    const sourceUnchanged = JSON.stringify(before) === JSON.stringify(hashes(fixture));
    const checks = {
      completed: exitCode === 0 && !timedOut && usage !== null,
      correctFile: answer?.file?.replace(/^\.\//, "") === task.expectedFile,
      correctSymbol: answer?.symbol?.includes(task.expectedSymbol) || answer?.symbol?.endsWith(task.expectedSymbol.split(".").at(-1)) || false,
      groundedQuote: Boolean(answer?.quote?.trim() && normalize(span).includes(normalize(answer.quote)) && answer.quote.split("\n").filter((line) => line.trim()).every((line) => normalize(outputs).includes(normalize(line)))),
      coversBehavior: Boolean(answer && answer.start_line >= 1 && answer.end_line >= answer.start_line && answer.end_line - answer.start_line <= 120 && task.evidenceAnchors.every((anchor) => span.includes(anchor))),
      sourceUnchanged,
    };
    const trace = fs.existsSync(tracePath) ? fs.readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
    checks.lookupOperational = lookupOperational(commands, trace, group);
    const run = { id, task: task.id, kind: task.kind, group, repo: source.repo, commit: source.commit, sourceRoot: source.sourceRoot, exitCode, timedOut, quotaBlocked: isQuotaBlocked(events), wallSeconds, preparationMs, usage, checks, evidenceChecksPassed: Object.values(checks).every(Boolean), answer, toolCalls: completed.filter((item) => !["agent_message", "reasoning"].includes(item.type)).length, commandCalls: commands.length, searchCommands: commands.filter((item) => /\brg\b|scythe-context (?:context|search)/.test(item.command ?? "")).length, capturedCommandOutputChars: outputs.length, scytheCalls: trace, commands: commands.map((item) => ({ command: item.command, exitCode: item.exit_code, outputChars: (item.aggregated_output ?? "").length })), unexpectedTools: completed.filter((item) => !["agent_message", "reasoning", "command_execution"].includes(item.type)).map((item) => item.type) };
    report.runs.push(run);
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ id, seconds: Math.round(wallSeconds), evidenceChecksPassed: run.evidenceChecksPassed, commands: commands.length, scytheCalls: trace.length, timedOut }));
    fs.rmSync(fixture, { recursive: true, force: true });
    if (run.quotaBlocked) throw new Error("Codex account quota blocked this run; retained record and stopped further runs");
    if (!checks.lookupOperational) throw new Error("Lookup infrastructure failed; retained run, stopped further account-backed runs");
  }
}
