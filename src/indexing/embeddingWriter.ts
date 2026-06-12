import Database from "better-sqlite3";
import { sha256Hex } from "./hash.js";
import type { EmbeddingProvider, EmbeddingRequest, EmbeddingResult } from "../providers/types.js";
import {
  getOrCreateEmbeddingRecord,
  getOrCreateEmbeddingSet,
  initializeStorageSchema,
  vectorTableName,
} from "../storage/schema.js";
import { vectorToFloat32Buffer } from "../storage/sqliteVec.js";

export interface EmbeddingIndexOptions {
  dbPath: string;
  providerName: string;
  providerBaseUrl: string;
  model: string;
  dimensions: number;
  batchSize: number;
  maxChunks?: number;
  provider: EmbeddingProvider;
}

export interface EmbeddingIndexResult {
  status: "embeddings_indexed";
  dbPath: string;
  embeddingSetId: number;
  dimensions: number;
  stats: {
    pendingChunks: number;
    embeddedChunks: number;
    skippedChunks: number;
    batches: number;
    batchFallbacks: number;
  };
}

interface PendingChunk {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  title: string | null;
  text: string;
}

function chunkTitle(chunk: PendingChunk): string {
  return chunk.title || `${chunk.path}:${chunk.startLine}-${chunk.endLine}`;
}

function toEmbeddingRequest(chunk: PendingChunk): EmbeddingRequest {
  return {
    kind: "document",
    title: chunkTitle(chunk),
    text: chunk.text,
  };
}

function chunkArray<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }
  return batches;
}

async function embedWithFallback(
  provider: EmbeddingProvider,
  requests: EmbeddingRequest[],
): Promise<{ results: EmbeddingResult[]; usedFallback: boolean }> {
  try {
    return { results: await provider.embedBatch(requests), usedFallback: false };
  } catch (error) {
    const results: EmbeddingResult[] = [];
    for (const request of requests) {
      results.push(await provider.embed(request));
    }
    return { results, usedFallback: true };
  }
}

export async function indexMissingEmbeddings(options: EmbeddingIndexOptions): Promise<EmbeddingIndexResult> {
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    throw new Error("batchSize must be a positive integer");
  }

  const db = new Database(options.dbPath);
  let embeddedChunks = 0;
  let batchFallbacks = 0;
  let batches = 0;

  try {
    initializeStorageSchema(db, { vectorDimensions: options.dimensions });
    const embeddingSetId = getOrCreateEmbeddingSet(db, {
      provider: options.providerName,
      baseUrlHash: sha256Hex(options.providerBaseUrl),
      model: options.model,
      dimensions: options.dimensions,
    });

    const limitSql = options.maxChunks ? "limit @maxChunks" : "";
    const pendingChunks = db
      .prepare(`
        select chunks.id, files.path, chunks.start_line as startLine, chunks.end_line as endLine,
               chunks.title, chunks.text
        from chunks
        join files on files.id = chunks.file_id
        left join embeddings
          on embeddings.chunk_id = chunks.id
         and embeddings.embedding_set_id = @embeddingSetId
        where embeddings.id is null
        order by files.path, chunks.start_line
        ${limitSql}
      `)
      .all({ embeddingSetId, maxChunks: options.maxChunks }) as PendingChunk[];

    const insertVector = db.prepare(`insert or replace into ${vectorTableName(options.dimensions)}(rowid, embedding) values (?, ?)`);
    const writeEmbedding = db.transaction((chunkId: number, vector: number[]) => {
      const embeddingId = getOrCreateEmbeddingRecord(db, { chunkId, embeddingSetId });
      insertVector.run(BigInt(embeddingId), vectorToFloat32Buffer(vector, options.dimensions));
    });

    for (const batch of chunkArray(pendingChunks, options.batchSize)) {
      batches += 1;
      const { results, usedFallback } = await embedWithFallback(
        options.provider,
        batch.map((chunk) => toEmbeddingRequest(chunk)),
      );
      if (usedFallback) batchFallbacks += 1;

      for (let index = 0; index < batch.length; index += 1) {
        const chunk = batch[index];
        const result = results[index];
        if (result.dimensions !== options.dimensions) {
          throw new Error(`Embedding dimensions mismatch for chunk ${chunk.id}: expected ${options.dimensions}, got ${result.dimensions}`);
        }
        writeEmbedding(chunk.id, result.vector);
        embeddedChunks += 1;
      }
    }

    return {
      status: "embeddings_indexed",
      dbPath: options.dbPath,
      embeddingSetId,
      dimensions: options.dimensions,
      stats: {
        pendingChunks: pendingChunks.length,
        embeddedChunks,
        skippedChunks: 0,
        batches,
        batchFallbacks,
      },
    };
  } finally {
    db.close();
  }
}
