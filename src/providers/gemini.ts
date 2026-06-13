import type { AppConfig } from "../config.js";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "./types.js";

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
}

export class GeminiEmbeddingError extends Error {
  readonly status?: number;
  readonly bodySnippet?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number; bodySnippet?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "GeminiEmbeddingError";
    this.status = options.status;
    this.bodySnippet = options.bodySnippet;
    this.retryable = options.retryable ?? false;
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
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function safeSnippet(text: string, secret?: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const redacted = secret ? collapsed.split(secret).join("[REDACTED]") : collapsed;
  return redacted.length > 1000 ? `${redacted.slice(0, 1000)}...` : redacted;
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
    });

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
    });

    const vectors = this.extractVectors(response);
    if (vectors.length !== inputs.length) {
      throw new Error(`Gemini returned ${vectors.length} embeddings for ${inputs.length} inputs`);
    }

    return vectors.map((vector) => ({
      vector,
      model: this.config.model,
      dimensions: vector.length,
    }));
  }

  private async post(method: "embedContent" | "batchEmbedContents", body: unknown): Promise<GeminiEmbeddingResponse> {
    if (!this.config.apiKey) {
      throw new GeminiEmbeddingError("GEMINI_API_KEY is required for embedding calls");
    }

    let url: URL;
    try {
      url = buildGeminiEndpoint(this.config.baseUrl, this.config.model, method);
    } catch (error) {
      throw new GeminiEmbeddingError(
        `Invalid GEMINI_BASE_URL: ${error instanceof Error ? error.message : String(error)}`,
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

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new GeminiEmbeddingError(`Gemini embedding request failed with HTTP ${response.status}`, {
        status: response.status,
        bodySnippet: safeSnippet(text, this.config.apiKey),
        retryable: isRetryableStatus(response.status),
      });
    }

    try {
      return JSON.parse(text) as GeminiEmbeddingResponse;
    } catch {
      throw new GeminiEmbeddingError("Gemini embedding response was not valid JSON", {
        bodySnippet: safeSnippet(text, this.config.apiKey),
      });
    }
  }

  private extractSingleVector(response: GeminiEmbeddingResponse): number[] {
    const vector = response.embedding?.values || response.embeddings?.[0]?.values;
    if (!vector || vector.length === 0) {
      throw new Error("Gemini response did not include an embedding vector");
    }
    return vector;
  }

  private extractVectors(response: GeminiEmbeddingResponse): number[][] {
    const vectors = response.embeddings?.map((embedding) => embedding.values || []) || [];
    if (vectors.some((vector) => vector.length === 0)) {
      throw new Error("Gemini batch response included an empty embedding vector");
    }
    return vectors;
  }
}
