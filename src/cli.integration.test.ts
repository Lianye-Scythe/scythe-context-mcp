import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "./cli.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const commandPath = fileURLToPath(new URL("./command.ts", import.meta.url));
const mcpPath = fileURLToPath(new URL("./index.ts", import.meta.url));
const loader = import.meta.resolve("tsx");
let projectPath: string;
let upstream: Server;
let requests: number;
let upstreamFails: boolean;
let failureStatus: number;
let env: NodeJS.ProcessEnv;

function cli(args: string[], entry = commandPath, overrides: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, ["--import", loader, entry, ...args], {
      cwd: projectPath, env: { ...env, ...overrides }, timeout: 10000,
    }, (error, stdout, stderr) => {
      resolve({ code: error ? Number((error as NodeJS.ErrnoException & { code?: number }).code) || 1 : 0, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-cli-"));
  await fs.writeFile(path.join(projectPath, "auth.ts"), 'export function validateToken(token: string) { return token.length > 0; }\n');
  await fs.writeFile(path.join(projectPath, "app.ts"), 'import { validateToken } from "./auth.js";\nexport const valid = validateToken("example");\n');
  requests = 0;
  upstreamFails = false;
  failureStatus = 503;
  upstream = createServer(async (request, response) => {
    requests++;
    const buffers = [];
    for await (const chunk of request) buffers.push(chunk);
    const body = JSON.parse(Buffer.concat(buffers).toString());
    response.writeHead(upstreamFails ? failureStatus : 200, {
      "content-type": "application/json",
      ...(upstreamFails && failureStatus === 429 ? { "Retry-After": "60" } : {}),
    });
    response.end(JSON.stringify(upstreamFails ? { error: { message: "Unavailable" } } : request.url?.endsWith(":batchEmbedContents")
      ? { embeddings: body.requests.map(() => ({ values: [1, 0, 0] })) }
      : { embedding: { values: [1, 0, 0] } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  env = {
    ...process.env, PWD: projectPath, SCYTHE_CONTEXT_DEFAULT_PROJECT: projectPath,
    SCYTHE_CONTEXT_INDEX_DIR: ".scythe-context", SCYTHE_CONTEXT_STRUCTURE_EXTRACTOR: "regex",
    GEMINI_API_KEY: "test-key", GEMINI_MODEL: "test-model", GEMINI_OUTPUT_DIMENSIONALITY: "3",
    GEMINI_AUTH_MODE: "bearer", GEMINI_REQUEST_TIMEOUT_MS: "500",
    GEMINI_BASE_URL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
  };
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
  await fs.rm(projectPath, { recursive: true, force: true });
});

async function index() {
  const result = await cli(["index", "--json"]);
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).status).toBe("metadata_indexed");
}

describe("CLI real process workflow", () => {
  it("exposes a long rate-limit delay and resumable progress through CLI and MCP without poisoning batch support", async () => {
    upstreamFails = true;
    failureStatus = 429;
    const command = await cli(["index", "--embeddings", "--json"]);
    expect(command.code).toBe(1);
    const failed = JSON.parse(command.stdout);
    expect(failed.error).toMatchObject({ reason: "rate_limited", retryAfterMs: 60000, attempts: 1 });
    expect(failed.embeddingProgress).toMatchObject({ embeddedChunks: 0, remainingChunks: 2 });
    expect(failed.providerCapabilities.batchEmbedding).toBe("unknown");
    expect(requests).toBe(1);
    const client = new Client({ name: "index-rate-limit", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", loader, mcpPath], cwd: projectPath,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)), stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "repo_reindex", arguments: { dry_run: false, index_embeddings: true } });
      expect(result.isError).toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      expect(payload.error).toEqual(failed.error);
      expect(payload.embeddingCoverage).toMatchObject({ embeddings: 0, missingChunks: 2 });
      expect(payload.providerCapabilities.lastErrorReason).toBe("rate_limited");
      expect(requests).toBe(2);
    } finally { await client.close(); }
    upstreamFails = false;
    const resumed = await cli(["index", "--embeddings", "--json"]);
    expect(resumed.code).toBe(0);
    expect(JSON.parse(resumed.stdout).embeddings.stats.embeddedChunks).toBe(2);
    expect(JSON.parse((await cli(["status"])).stdout).embeddingCoverage.missingChunks).toBe(0);
  }, 20_000);

  it("creates, resumes and refreshes vectors incrementally and preserves metadata after provider failure", async () => {
    const first = await cli(["index", "--embeddings", "--max-embedding-chunks=1", "--json"]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout).embeddings.stats.embeddedChunks).toBe(1);
    const partial = JSON.parse((await cli(["status"])).stdout);
    expect(partial.embeddingCoverage).toMatchObject({ embeddings: 1, missingChunks: 1, chunks: 2 });
    const resumed = await cli(["index", "--embeddings", "--json"]);
    expect(JSON.parse(resumed.stdout).embeddings.stats.embeddedChunks).toBe(1);
    const beforeReuse = requests;
    const reused = await cli(["index", "--embeddings", "--json"]);
    expect(JSON.parse(reused.stdout).embeddings.stats.embeddedChunks).toBe(0);
    expect(requests).toBe(beforeReuse);

    await fs.writeFile(path.join(projectPath, "auth.ts"), 'export function validateToken(token: string) { return token.startsWith("changed"); }\n');
    expect(JSON.parse((await cli(["status"])).stdout).freshness.status).toBe("stale");
    upstreamFails = true;
    const interrupted = await cli(["index", "--embeddings", "--json"]);
    expect(interrupted.code).toBe(1);
    const failed = JSON.parse(interrupted.stdout);
    expect(failed.status).toBe("embedding_unavailable");
    expect(failed.error).toMatchObject({ httpStatus: 503, reason: "http_error", retryable: true, attempts: 3 });
    expect(failed.embeddingProgress).toMatchObject({ embeddedChunks: 0, remainingChunks: 1 });
    expect(failed.embeddingCoverage).toMatchObject({ embeddings: 1, missingChunks: 1 });
    expect(failed.providerCapabilities.batchEmbedding).toBe("supported");
    const afterFailure = JSON.parse((await cli(["status"])).stdout);
    expect(afterFailure.freshness.status).toBe("fresh");
    expect(afterFailure.embeddingCoverage).toMatchObject({ embeddings: 1, missingChunks: 1 });
    const local = await cli(["search", "validateToken", "--json"]);
    expect(local.code).toBe(0);
    expect(JSON.parse(local.stdout).results.some((result: { path: string }) => result.path === "auth.ts")).toBe(true);
    upstreamFails = false;
    const refreshed = await cli(["index", "--embeddings", "--json"]);
    expect(JSON.parse(refreshed.stdout).embeddings.stats.embeddedChunks).toBe(1);

    await fs.rm(path.join(projectPath, "auth.ts"));
    const beforeDeletion = requests;
    const deleted = await cli(["index", "--embeddings", "--json"]);
    expect(JSON.parse(deleted.stdout).embeddings.stats.embeddedChunks).toBe(0);
    expect(requests).toBe(beforeDeletion);
    expect(JSON.parse((await cli(["status"])).stdout).embeddingCoverage).toMatchObject({ embeddings: 1, missingChunks: 0, chunks: 1 });

    const changed = { GEMINI_BASE_URL: `${env.GEMINI_BASE_URL}/different-endpoint` };
    const beforeNewEndpoint = requests;
    const noVectors = await cli(["search", "validateToken", "--mode=hybrid", "--json"], commandPath, changed);
    expect(JSON.parse(noVectors.stdout).effectiveMode).toBe("keyword");
    expect(requests).toBe(beforeNewEndpoint);
    const newEndpoint = await cli(["index", "--embeddings", "--json"], commandPath, changed);
    expect(newEndpoint.code).toBe(0);
    expect(JSON.parse(newEndpoint.stdout).embeddings.stats.embeddedChunks).toBe(1);
    const semantic = await cli(["search", "validateToken", "--mode=semantic", "--json"], commandPath, changed);
    expect(semantic.code).toBe(0);
    expect(JSON.parse(semantic.stdout).results.map((result: { path: string }) => result.path)).toEqual(["app.ts"]);
  }, 20_000); // This lifecycle intentionally starts multiple real CLI processes.

  it("reports absent or incompatible vectors without sending a query", async () => {
    await index();
    const hybrid = await cli(["context", "validateToken", "--mode=hybrid", "--json"]);
    expect(hybrid.code).toBe(0);
    expect(JSON.parse(hybrid.stdout).effectiveMode).toBe("keyword");
    expect(JSON.parse(hybrid.stdout).fallback.error.message).toContain("No code embeddings");
    const semantic = await cli(["search", "validateToken", "--mode=semantic", "--json"]);
    expect(semantic.code).toBe(1);
    expect(JSON.parse(semantic.stdout).status).toBe("embedding_unavailable");
    expect(requests).toBe(0);
    expect((await cli(["index", "--embeddings"])).code).toBe(0);
    const before = requests;
    for (const changed of [{ GEMINI_MODEL: "different-model" }, { GEMINI_OUTPUT_DIMENSIONALITY: "4" }]) {
      const status = JSON.parse((await cli(["status", "--json"], commandPath, changed)).stdout);
      expect(status.embeddingCoverage).toMatchObject({ embeddings: 0, missingChunks: 2 });
      const incompatible = await cli(["context", "validateToken", "--mode=hybrid", "--json"], commandPath, changed);
      expect(JSON.parse(incompatible.stdout).effectiveMode).toBe("keyword");
      expect(requests).toBe(before);
    }
  });

  it("shows help without loading invalid runtime config on either entrypoint", async () => {
    const help = await cli([], commandPath, { GEMINI_REQUEST_TIMEOUT_MS: "bad" });
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("scythe-context search");
    const legacy = await cli(["--version"], mcpPath, { GEMINI_REQUEST_TIMEOUT_MS: "bad" });
    expect(legacy.code).toBe(0);
    expect(legacy.stdout.trim()).toBe(PACKAGE_VERSION);
    expect(requests).toBe(0);
  });

  it("previews, indexes, searches and traces imports locally with a provider configured", async () => {
    const preview = await cli(["index", "--dry-run", "--json"]);
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.stdout).dryRun).toBe(true);
    await expect(fs.access(path.join(projectPath, ".scythe-context"))).rejects.toThrow();
    await index();
    const status = await cli(["status", "--json"]);
    expect(JSON.parse(status.stdout).freshness.status).toBe("fresh");
    const search = await cli(["search", "validateToken"]);
    expect(search.code).toBe(0);
    expect(search.stdout).toContain("auth.ts:1-");
    expect(search.stdout).toContain("Mode: keyword");
    expect(search.stdout).not.toContain("export function");
    const context = await cli(["context", "validateToken", "--format", "compact", "--json"]);
    expect(context.code).toBe(0);
    const payload = JSON.parse(context.stdout);
    expect(payload.effectiveMode).toBe("keyword");
    expect(payload.primaryResults.some((result: { path: string; snippet: string }) => result.path === "auth.ts" && result.snippet.includes("export function"))).toBe(true);
    const related = await cli(["related", "auth.ts", "--json"]);
    expect(JSON.parse(related.stdout).importedBy).toContain("app.ts:1");
    const doctor = await cli(["doctor", "--json"]);
    expect(doctor.code).toBe(0);
    expect(JSON.parse(doctor.stdout).status).not.toBe("error");
    const empty = await cli(["search", "nonexistentIdentifierQzx", "--json"]);
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout).results).toEqual([]);
    expect(requests).toBe(0);
  });

  it("reports missing indexes and invalid options with nonzero exits before making requests", async () => {
    const missing = await cli(["search", "validateToken", "--json"]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).status).toBe("index_missing");
    for (const args of [["search", "validateToken", "--max-results=0"], ["index", "--format=paths"], ["search", "validateToken", "--mode=invalid"]]) {
      const invalid = await cli([...args, "--json"]);
      expect(invalid.code).toBe(1);
      expect(JSON.parse(invalid.stderr).status).toBe("error");
    }
    expect(requests).toBe(0);
  });

  it("saves JSON for later reads and resolves explicit project paths", async () => {
    await index();
    const output = path.join(projectPath, "saved result.json");
    const result = await cli(["context", "validateToken", "--project", projectPath, "--output", output, "--json"], commandPath, { SCYTHE_CONTEXT_DEFAULT_PROJECT: path.join(projectPath, "other") });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).outputPath).toBe(output);
    const payload = JSON.parse(await fs.readFile(output, "utf8"));
    expect(payload.primaryResults.some((match: { path: string }) => match.path === "auth.ts")).toBe(true);
    expect(payload.projectPath).toBe(projectPath);
    expect(requests).toBe(0);
  });

  it("preserves no-argument MCP stdio startup, schemas, and shared lookup results", async () => {
    const client = new Client({ name: "cli-parity-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath, args: ["--import", loader, mcpPath], cwd: projectPath,
      env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(7);
      const schema = tools.tools.find((tool) => tool.name === "repo_context_pack")!.inputSchema;
      expect(schema.properties?.mode).toMatchObject({ default: "hybrid" });
      expect(schema.properties?.response_mode).toMatchObject({ default: "paths_only" });
      await client.callTool({ name: "repo_reindex", arguments: { dry_run: false } });
      const result = await client.callTool({ name: "repo_context_pack", arguments: { query: "validateToken", mode: "keyword" } });
      expect(result.isError).not.toBe(true);
      const payload = JSON.parse((result.content as Array<{ text: string }>)[0].text);
      const command = await cli(["context", "validateToken", "--json"]);
      expect(command.code).toBe(0);
      expect(JSON.parse(command.stdout)).toEqual(payload);
      expect(requests).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("uses the same explicit embedding and fallback behavior through CLI", async () => {
    const indexed = await cli(["index", "--embeddings", "--json"]);
    expect(indexed.code).toBe(0);
    expect(JSON.parse(indexed.stdout).status).toBe("metadata_and_embeddings_indexed");
    expect(requests).toBeGreaterThan(0);
    const before = requests;
    const semantic = await cli(["search", "validateToken", "--mode=semantic", "--json"]);
    expect(semantic.code).toBe(0);
    expect(JSON.parse(semantic.stdout).effectiveMode).toBe("semantic");
    expect(requests).toBe(before + 1);
    upstreamFails = true;
    const hybrid = await cli(["context", "validateToken", "--mode=hybrid"]);
    expect(hybrid.code).toBe(0);
    expect(hybrid.stdout).toContain("Fallback: hybrid -> keyword");
    expect(hybrid.stdout).toContain("auth.ts:1-");
    const failed = await cli(["context", "validateToken", "--mode=semantic", "--json"]);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout).status).toBe("embedding_unavailable");
  });
});
