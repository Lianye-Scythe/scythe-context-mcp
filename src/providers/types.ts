export interface EmbeddingRequest {
  text: string;
  title?: string;
  kind: "query" | "document";
}

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dimensions: number;
}

export interface EmbeddingProvider {
  embed(input: EmbeddingRequest): Promise<EmbeddingResult>;
  embedBatch(inputs: EmbeddingRequest[]): Promise<EmbeddingResult[]>;
}

export class EmbeddingProviderError extends Error {
  readonly status?: number;
  readonly bodySnippet?: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly reason: string;
  readonly batchUnsupported: boolean;
  attempts = 1;

  constructor(message: string, options: {
    status?: number; bodySnippet?: string; retryable?: boolean; retryAfterMs?: number;
    reason?: string; batchUnsupported?: boolean;
  } = {}) {
    super(message);
    this.name = "EmbeddingProviderError";
    this.status = options.status;
    this.bodySnippet = options.bodySnippet;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.reason = options.reason ?? "provider_error";
    this.batchUnsupported = options.batchUnsupported ?? false;
  }
}

