import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildGeminiEndpoint, GeminiEmbeddingError, GeminiEmbeddingProvider, normalizeGeminiBaseUrl } from "./gemini.js";

const baseConfig = {
  apiKey: "secret-key",
  baseUrl: "https://proxy.example.com",
  model: "gemini-embedding-2",
  outputDimensionality: 1536,
  authMode: "x-goog-api-key" as const,
  apiKeyHeader: "x-goog-api-key",
  apiKeyQueryParam: "key",
};

const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    const closed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  }
});

describe("Gemini URL compatibility", () => {
  it.each([
    ["https://proxy.example.com", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1beta", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1beta/", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1", "https://proxy.example.com/v1"],
    ["https://proxy.example.com/gemini", "https://proxy.example.com/gemini/v1beta"],
    ["https://proxy.example.com/gemini/v1beta/", "https://proxy.example.com/gemini/v1beta"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeGeminiBaseUrl(input)).toBe(expected);
  });

  it("builds embedding endpoints without duplicating v1beta or models prefixes", () => {
    expect(buildGeminiEndpoint("https://proxy.example.com/", "gemini-embedding-2", "embedContent").toString()).toBe(
      "https://proxy.example.com/v1beta/models/gemini-embedding-2:embedContent",
    );
    expect(buildGeminiEndpoint("https://proxy.example.com/v1beta/", "models/gemini-embedding-2", "batchEmbedContents").toString()).toBe(
      "https://proxy.example.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
  });
});

describe("GeminiEmbeddingProvider diagnostics", () => {
  it.each([
    ["query", false],
    ["query", true],
    ["batch", false],
    ["batch", true],
  ] as const)("times out a stalled %s request (headers sent: %s)", async (kind, sendHeaders) => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      if (sendHeaders) {
        response.writeHead(200, { "content-type": "application/json" });
        response.write('{"embedding":');
      }
      // Leave the response open to verify both connection and body deadlines.
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const provider = new GeminiEmbeddingProvider({
      ...baseConfig,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      requestTimeoutMs: 250,
    });
    const input = { kind: "query" as const, text: "hello" };
    const request = kind === "batch" ? provider.embedBatch([input]) : provider.embed(input);
    await expect(request).rejects.toMatchObject({
      name: "GeminiEmbeddingError",
      message: "Gemini embedding request timed out after 250 ms",
      retryable: true,
    });
    expect(requests).toBe(1);
  });

  it("redacts secrets and marks retryable HTTP failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream failed for secret-key", { status: 429 })),
    );

    const provider = new GeminiEmbeddingProvider(baseConfig);
    await expect(provider.embed({ kind: "query", text: "hello" })).rejects.toMatchObject({
      name: "GeminiEmbeddingError",
      message: "Gemini embedding request failed with HTTP 429",
      status: 429,
      retryable: true,
      bodySnippet: "upstream failed for [REDACTED]",
    });
  });

  it("wraps non-JSON responses with a diagnostic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200 })),
    );

    const provider = new GeminiEmbeddingProvider(baseConfig);
    await expect(provider.embed({ kind: "query", text: "hello" })).rejects.toBeInstanceOf(GeminiEmbeddingError);
    await expect(provider.embed({ kind: "query", text: "hello" })).rejects.toMatchObject({
      message: "Gemini embedding response was not valid JSON",
      bodySnippet: "<html>not json</html>",
    });
  });

  it("wraps invalid base URLs with a diagnostic error", async () => {
    const provider = new GeminiEmbeddingProvider({ ...baseConfig, baseUrl: "not a url" });

    await expect(provider.embed({ kind: "query", text: "hello" })).rejects.toMatchObject({
      name: "GeminiEmbeddingError",
      message: expect.stringContaining("Invalid GEMINI_BASE_URL"),
    });
  });
});
