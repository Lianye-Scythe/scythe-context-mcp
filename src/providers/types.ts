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

