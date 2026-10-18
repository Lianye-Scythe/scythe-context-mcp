import { DEFAULT_GEMINI_REQUEST_TIMEOUT_MS, type AppConfig } from "../config.js";
import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingRequest, type EmbeddingResult } from "./types.js";

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
}

export class GeminiEmbeddingError extends EmbeddingProviderError {
  constructor(message: string, options: ConstructorParameters<typeof EmbeddingProviderError>[1] = {}) {
    super(message, options);
    this.name = "GeminiEmbeddingError";
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function normalizeGeminiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const lastPart = pathParts.at(-1);
  if (lastPart !== "v1" && lastPart !== "v1beta") {
    pathParts.push("v1beta");
  }
  url.pathname = `/${pathParts.join("/")}`;
  url.search = "";
  url.hash = "";
  return trimTrailingSlash(url.toString());
}

function modelResource(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

export function buildGeminiEndpoint(baseUrl: string, model: string, method: "embedContent" | "batchEmbedContents"): URL {
  return new URL(`${normalizeGeminiBaseUrl(baseUrl)}/${modelResource(model)}:${method}`);
}

function formatEmbeddingText(input: EmbeddingRequest): string {
  if (input.kind === "query") {
    return `task: code retrieval | query: ${input.text}`;
  }
  return `title: ${input.title || "none"} | text: ${input.text}`;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || [500, 502, 503, 504].includes(status);
}

function safeSnippet(text: string, secret?: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const redacted = secret ? collapsed.split(secret).join("[REDACTED]") : collapsed;
  return redacted.length > 1000 ? `${redacted.slice(0, 1000)}...` : redacted;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? delay : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private readonly config: AppConfig["gemini"];

  constructor(config: AppConfig["gemini"]) {
    this.config = config;
  }

  async embed(input: EmbeddingRequest): Promise<EmbeddingResult> {
    const response = await this.post("embedContent", {
      model: modelResource(this.config.model),
      content: { parts: [{ text: formatEmbeddingText(input) }] },
      ...(this.config.outputDimensionality
        ? { output_dimensionality: this.config.outputDimensionality }
        : {}),
    }, input.kind === "document");

    const vector = this.extractSingleVector(response);
    return {
      vector,
      model: this.config.model,
      dimensions: vector.length,
    };
  }

  async embedBatch(inputs: EmbeddingRequest[]): Promise<EmbeddingResult[]> {
    if (inputs.length === 0) return [];

    const response = await this.post("batchEmbedContents", {
      requests: inputs.map((input) => ({
        model: modelResource(this.config.model),
        content: { parts: [{ text: formatEmbeddingText(input) }] },
        ...(this.config.outputDimensionality
          ? { output_dimensionality: this.config.outputDimensionality }
          : {}),
      })),
    }, inputs.every((input) => input.kind === "document"));

    const vectors = this.extractVectors(response);
    if (vectors.length !== inputs.length) {
      throw new GeminiEmbeddingError(`Gemini returned ${vectors.length} embeddings for ${inputs.length} inputs`, { reason: "invalid_response" });
    }

    return vectors.map((vector) => ({
      vector,
      model: this.config.model,
      dimensions: vector.length,
    }));
  }

  private async post(method: "embedContent" | "batchEmbedContents", body: unknown, retry = false): Promise<GeminiEmbeddingResponse> {
    let waitedMs = 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.postOnce(method, body);
      } catch (error) {
        if (!(error instanceof GeminiEmbeddingError)) throw error;
        error.attempts = attempt;
        const delay = Math.max(500 * 2 ** (attempt - 1) + Math.random() * 250, error.retryAfterMs ?? 0);
        // Do not retry earlier than a long Retry-After, or turn an interactive job into an unbounded wait.
        if (!retry || !error.retryable || attempt >= 3 || waitedMs + delay > 10_000) throw error;
        await new Promise((resolve) => setTimeout(resolve, delay));
        waitedMs += delay;
      }
    }
  }

  private async postOnce(method: "embedContent" | "batchEmbedContents", body: unknown): Promise<GeminiEmbeddingResponse> {
    if (!this.config.apiKey) {
      throw new GeminiEmbeddingError("GEMINI_API_KEY is required for embedding calls", { reason: "configuration" });
    }

    let url: URL;
    try {
      url = buildGeminiEndpoint(this.config.baseUrl, this.config.model, method);
    } catch (error) {
      throw new GeminiEmbeddingError(
        `Invalid GEMINI_BASE_URL: ${error instanceof Error ? error.message : String(error)}`, { reason: "configuration" },
      );
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };

    if (this.config.authMode === "bearer") {
      headers.authorization = `Bearer ${this.config.apiKey}`;
    } else if (this.config.authMode === "query") {
      url.searchParams.set(this.config.apiKeyQueryParam, this.config.apiKey);
    } else {
      headers[this.config.apiKeyHeader] = this.config.apiKey;
    }

    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_GEMINI_REQUEST_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      text = await response.text();
    } catch (error) {
      if (signal.aborted) {
        throw new GeminiEmbeddingError(`Gemini embedding request timed out after ${timeoutMs} ms`, {
          retryable: true,
          reason: "timeout",
        });
      }
      throw new GeminiEmbeddingError("Gemini embedding network request failed", { retryable: true, reason: "network" });
    }
    if (!response.ok) {
      const batchUnsupported = method === "batchEmbedContents" && [404, 405, 501].includes(response.status);
      throw new GeminiEmbeddingError(`Gemini embedding request failed with HTTP ${response.status}`, {
        status: response.status,
        bodySnippet: safeSnippet(text, this.config.apiKey),
        retryable: !batchUnsupported && isRetryableStatus(response.status),
        retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
        reason: response.status === 429 ? "rate_limited" : "http_error",
        batchUnsupported,
      });
    }

    try {
      return JSON.parse(text) as GeminiEmbeddingResponse;
    } catch {
      throw new GeminiEmbeddingError("Gemini embedding response was not valid JSON", {
        bodySnippet: safeSnippet(text, this.config.apiKey),
        reason: "invalid_response",
      });
    }
  }

  private extractSingleVector(response: GeminiEmbeddingResponse): number[] {
    const vector = response.embedding?.values || response.embeddings?.[0]?.values;
    if (!vector || vector.length === 0) {
      throw new GeminiEmbeddingError("Gemini response did not include an embedding vector", { reason: "invalid_response" });
    }
    return vector;
  }

  private extractVectors(response: GeminiEmbeddingResponse): number[][] {
    const vectors = response.embeddings?.map((embedding) => embedding.values || []) || [];
    if (vectors.some((vector) => vector.length === 0)) {
      throw new GeminiEmbeddingError("Gemini batch response included an empty embedding vector", { reason: "invalid_response" });
    }
    return vectors;
  }
}
