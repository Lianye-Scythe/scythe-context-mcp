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
  vi.useRealTimers();
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
  it("backs off document requests and respects Retry-After without delaying query fallback", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("limited", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ embedding: { values: [1, 0, 0] } })));
    vi.stubGlobal("fetch", fetch);
    const pending = new GeminiEmbeddingProvider(baseConfig).embed({ kind: "document", text: "public source" });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).vector).toEqual([1, 0, 0]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors HTTP-date Retry-After and stops instead of retrying before a long delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
    const fetch = vi.fn(async () => new Response("limited secret-key", {
      status: 429, headers: { "Retry-After": "Sun, 18 Oct 2026 00:01:00 GMT" },
    }));
    vi.stubGlobal("fetch", fetch);
    await expect(new GeminiEmbeddingProvider(baseConfig).embed({ kind: "document", text: "source" })).rejects.toMatchObject({
      reason: "rate_limited", retryAfterMs: 60000, attempts: 1, bodySnippet: "limited [REDACTED]",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("limits retries and classifies transient batch failures without declaring them unsupported", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("busy", { status: 503, headers: { "Retry-After": "invalid" } }));
    vi.stubGlobal("fetch", fetch);
    const pending = new GeminiEmbeddingProvider(baseConfig).embedBatch([{ kind: "document", text: "source" }]);
    const assertion = expect(pending).rejects.toMatchObject({ status: 503, attempts: 3, retryable: true, batchUnsupported: false });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("bounds cumulative Retry-After waits and redacts network failure details", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("busy", { status: 429, headers: { "Retry-After": "6" } }));
    vi.stubGlobal("fetch", fetch);
    const provider = new GeminiEmbeddingProvider(baseConfig);
    const pending = provider.embed({ kind: "document", text: "source" });
    const assertion = expect(pending).rejects.toMatchObject({ attempts: 2, retryAfterMs: 6000 });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockRejectedValue(new TypeError("fetch failed https://host/?key=secret-key"));
    const network = provider.embed({ kind: "document", text: "source" });
    const networkAssertion = expect(network).rejects.toMatchObject({
      reason: "network", attempts: 3, message: "Gemini embedding network request failed",
    });
    await vi.runAllTimersAsync();
    await networkAssertion;
  });

  it.each([401, 403, 404, 405, 501])("does not retry permanent batch HTTP %s errors", async (status) => {
    const fetch = vi.fn(async () => new Response("denied", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(new GeminiEmbeddingProvider(baseConfig).embedBatch([{ kind: "document", text: "source" }])).rejects.toMatchObject({
      status, attempts: 1, batchUnsupported: [404, 405, 501].includes(status),
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["query", false],
    ["query", true],
    ["batch", false],
    ["batch", true],
    ["document", true],
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
    const input = { kind: kind === "document" ? "document" as const : "query" as const, text: "hello" };
    const request = kind === "batch" ? provider.embedBatch([input]) : provider.embed(input);
    await expect(request).rejects.toMatchObject({
      name: "GeminiEmbeddingError",
      message: "Gemini embedding request timed out after 250 ms",
      retryable: true,
    });
    expect(requests).toBe(kind === "document" ? 3 : 1);
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
