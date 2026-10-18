import Database from "better-sqlite3";
import { sha256Hex } from "./hash.js";
import { EmbeddingProviderError, type EmbeddingProvider, type EmbeddingRequest, type EmbeddingResult } from "../providers/types.js";
import type { ProviderCapabilityRecord } from "../providers/capabilities.js";
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
  capabilities?: Pick<ProviderCapabilityRecord, "batchEmbedding" | "batchEmbeddingVerified">;
  onCapabilitiesUpdated?: (update: Pick<ProviderCapabilityRecord, "batchEmbedding" | "batchEmbeddingVerified">) => void;
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

export class EmbeddingIndexError extends Error {
  constructor(readonly providerError: unknown, readonly progress: { pendingChunks: number; embeddedChunks: number; remainingChunks: number }) {
    super(providerError instanceof Error ? providerError.message : "Embedding indexing failed", { cause: providerError });
    this.name = "EmbeddingIndexError";
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
  let pendingCount = 0;

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

    pendingCount = pendingChunks.length;
    const vectorTable = vectorTableName(options.dimensions);
    const deleteVector = db.prepare(`delete from ${vectorTable} where rowid = ?`);
    const insertVector = db.prepare(`insert into ${vectorTable}(rowid, embedding) values (?, ?)`);
    const writeEmbedding = db.transaction((chunkId: number, vector: number[]) => {
      const embeddingId = getOrCreateEmbeddingRecord(db, { chunkId, embeddingSetId });
      deleteVector.run(BigInt(embeddingId));
      insertVector.run(BigInt(embeddingId), vectorToFloat32Buffer(vector, options.dimensions));
    });

    const persist = (chunk: PendingChunk, result: EmbeddingResult) => {
      if (result.dimensions !== options.dimensions) {
        throw new Error(`Embedding dimensions mismatch for chunk ${chunk.id}: expected ${options.dimensions}, got ${result.dimensions}`);
      }
      writeEmbedding(chunk.id, result.vector);
      embeddedChunks += 1;
    };
    // Legacy unsupported observations could have been caused by any transient error.
    let skipBatch = options.capabilities?.batchEmbedding === "unsupported" && options.capabilities.batchEmbeddingVerified === true;
    let verifyUnsupported = false;
    for (const batch of chunkArray(pendingChunks, options.batchSize)) {
      batches += 1;
      if (!skipBatch) {
        let results: EmbeddingResult[];
        try {
          results = await options.provider.embedBatch(batch.map(toEmbeddingRequest));
        } catch (error) {
          if (!(error instanceof EmbeddingProviderError) || !error.batchUnsupported) throw error;
          skipBatch = true;
          verifyUnsupported = true;
          results = [];
        }
        if (!skipBatch) {
          if (results.length !== batch.length) throw new Error("Embedding batch result count mismatch");
          results.forEach((result, index) => persist(batch[index], result));
          options.onCapabilitiesUpdated?.({ batchEmbedding: "supported", batchEmbeddingVerified: true });
          continue;
        }
      }
      batchFallbacks += 1;
      for (const chunk of batch) {
        // Persist each successful single result before making the next remote call.
        persist(chunk, await options.provider.embed(toEmbeddingRequest(chunk)));
        if (verifyUnsupported) {
          options.onCapabilitiesUpdated?.({ batchEmbedding: "unsupported", batchEmbeddingVerified: true });
          verifyUnsupported = false;
        }
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
  } catch (error) {
    throw new EmbeddingIndexError(error, { pendingChunks: pendingCount, embeddedChunks, remainingChunks: pendingCount - embeddedChunks });
  } finally {
    db.close();
  }
}
