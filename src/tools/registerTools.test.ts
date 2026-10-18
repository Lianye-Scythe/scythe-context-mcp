import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { registerTools } from "./registerTools.js";

let projectPath: string;
let client: Client;
let mcp: McpServer;
let upstream: Server;
let requests: number;
let respondWithVectors: boolean;
let responseVector: number[];

async function callTool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: { project_path: projectPath, ...args } });
  expect(result.isError).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(content[0].type).toBe("text");
  return JSON.parse(content[0].text!);
}

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-tools-"));
  await fs.writeFile(path.join(projectPath, "auth.ts"), "export function validateToken(token: string) { return token.length > 0; }\n");
  requests = 0;
  respondWithVectors = false;
  responseVector = [1, 0, 0];
  upstream = createServer((request, response) => {
    requests += 1;
    if (respondWithVectors) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(request.url?.endsWith(":batchEmbedContents")
        ? { embeddings: [{ values: responseVector }] }
        : { embedding: { values: responseVector } }));
    }
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const config = loadConfig();
  config.defaultProjectPath = projectPath;
  config.indexDirName = ".scythe-context";
  config.structure = { extractorMode: "regex" };
  config.gemini = {
    apiKey: "test-key",
    baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    model: "test-model",
    outputDimensionality: 3,
    authMode: "bearer",
    apiKeyHeader: "x-goog-api-key",
    apiKeyQueryParam: "key",
    requestTimeoutMs: 250,
  };
  mcp = new McpServer({ name: "test-scythe", version: "1.0.0" });
  registerTools(mcp, config);
  client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const indexed = await callTool("repo_reindex", { dry_run: false, index_embeddings: false });
  expect(indexed.status).toBe("metadata_indexed");
});

afterEach(async () => {
  await client?.close();
  await mcp?.close();
  if (upstream) {
    const closed = new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    upstream.closeAllConnections();
    await closed;
  }
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

async function primeVectors() {
  respondWithVectors = true;
  await callTool("repo_reindex", { dry_run: false, index_embeddings: true, max_embedding_chunks: 1 });
  respondWithVectors = false;
  requests = 0;
}

describe("MCP search tool integration", () => {
  it.each(["repo_context_pack", "repo_semantic_search"])("%s reports a missing index before contacting the provider", async (name) => {
    const missingProject = path.join(projectPath, "missing");
    const payload = await callTool(name, { project_path: missingProject, query: "validateToken" });
    expect(payload.status).toBe("index_missing");
    expect(payload.projectPath).toBe(missingProject);
    expect(payload).not.toHaveProperty("fallback");
    expect(requests).toBe(0);
  });

  it.each([
    ["repo_context_pack", "hybrid"],
    ["repo_context_pack", "semantic"],
    ["repo_semantic_search", "hybrid"],
    ["repo_semantic_search", "semantic"],
  ])("%s preserves %s behavior on embedding dimension mismatch", async (name, mode) => {
    await primeVectors();
    respondWithVectors = true;
    responseVector = [1, 0];
    const payload = await callTool(name, { query: "validateToken", mode });
    const expectedError = { type: "Error", message: "Query embedding dimensions mismatch: expected 3, got 2", retryable: false };
    if (mode === "hybrid") {
      expect(payload.effectiveMode).toBe("keyword");
      expect(payload.fallback).toMatchObject({ reason: "embedding_unavailable", fromMode: "hybrid", toMode: "keyword", error: expectedError });
      expect((payload.primaryResults ?? payload.results)[0].path).toBe("auth.ts");
    } else {
      expect(payload.status).toBe("embedding_unavailable");
      expect(payload.error).toMatchObject(expectedError);
      expect(payload).not.toHaveProperty("fallback");
      expect(payload).not.toHaveProperty("primaryResults");
      expect(payload).not.toHaveProperty("results");
    }
    expect(requests).toBe(1);
  });
  it.each([
    ["repo_context_pack", "hybrid"],
    ["repo_context_pack", "semantic"],
    ["repo_semantic_search", "hybrid"],
    ["repo_semantic_search", "semantic"],
  ])("%s retains successful %s search with indexed vectors", async (name, mode) => {
    respondWithVectors = true;
    const indexed = await callTool("repo_reindex", { dry_run: false, index_embeddings: true, max_embedding_chunks: 1 });
    expect(indexed.status).toBe("metadata_and_embeddings_indexed");
    const beforeSearch = requests;
    const payload = await callTool(name, { query: "validateToken", mode });
    expect(payload.effectiveMode).toBe(mode);
    expect(payload).not.toHaveProperty("fallback");
    expect((payload.primaryResults ?? payload.results)[0].path).toBe("auth.ts");
    expect(requests).toBe(beforeSearch + 1);
  });

  it.each(["repo_context_pack", "repo_semantic_search"])("%s searches metadata locally without contacting a configured provider", async (name) => {
    const payload = await callTool(name, { query: "validateToken", mode: "keyword" });
    expect(payload.mode).toBe("keyword");
    expect(payload.effectiveMode).toBe("keyword");
    expect(payload).not.toHaveProperty("fallback");
    const results = payload.primaryResults ?? payload.results;
    expect(results[0].path).toBe("auth.ts");
    expect(requests).toBe(0);
    if (name === "repo_context_pack") {
      expect(payload.responseMode).toBe("paths_only");
      expect(results[0]).not.toHaveProperty("snippet");
    }
  });

  it.each(["compact", "snippets"])("retains explicit %s context pack output", async (response_mode) => {
    const payload = await callTool("repo_context_pack", { query: "validateToken", mode: "keyword", response_mode });
    expect(payload.responseMode).toBe(response_mode);
    expect(payload.primaryResults[0].snippet).toContain("validateToken");
    expect(requests).toBe(0);
  });

  it.each(["repo_context_pack", "repo_semantic_search"])("%s retains default hybrid mode and falls back locally after timeout", async (name) => {
    await primeVectors();
    const payload = await callTool(name, { query: "validateToken" });
    expect(payload.mode).toBe("hybrid");
    expect(payload.effectiveMode).toBe("keyword");
    expect(payload.fallback).toMatchObject({
      reason: "embedding_unavailable",
      error: { message: "Gemini embedding request timed out after 250 ms", retryable: true },
    });
    expect((payload.primaryResults ?? payload.results)[0].path).toBe("auth.ts");
    expect(requests).toBe(1);
  });

  it.each(["repo_context_pack", "repo_semantic_search"])("%s reports semantic timeout without keyword fallback", async (name) => {
    await primeVectors();
    const payload = await callTool(name, { query: "validateToken", mode: "semantic" });
    expect(payload.status).toBe("embedding_unavailable");
    expect(payload.error.retryable).toBe(true);
    expect(payload).not.toHaveProperty("fallback");
    expect(payload).not.toHaveProperty("primaryResults");
    expect(payload).not.toHaveProperty("results");
    expect(requests).toBe(1);
  });
});
