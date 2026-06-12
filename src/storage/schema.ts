import type { Database } from "better-sqlite3";
import { loadSqliteVec } from "./sqliteVec.js";

export interface StorageSchemaOptions {
  vectorDimensions: number;
}

export interface FileRecordInput {
  projectPath: string;
  path: string;
  mtimeMs: number;
  size: number;
  hash: string;
}

export interface ChunkRecordInput {
  fileId: number;
  startLine: number;
  endLine: number;
  language?: string | null;
  title?: string | null;
  text: string;
  hash: string;
}

export interface EmbeddingSetInput {
  provider: string;
  baseUrlHash: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingRecordInput {
  chunkId: number;
  embeddingSetId: number;
}

export function vectorTableName(dimensions: number): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error("Vector dimensions must be a positive integer");
  }
  return `vec_embeddings_${dimensions}`;
}

export function initializeStorageSchema(db: Database, options: StorageSchemaOptions): void {
  loadSqliteVec(db);
  db.pragma("foreign_keys = ON");
  if (db.name !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }

  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      applied_at text not null default (datetime('now'))
    );

    create table if not exists files (
      id integer primary key,
      project_path text not null,
      path text not null,
      mtime_ms real not null,
      size integer not null,
      hash text not null,
      unique(project_path, path)
    );

    create table if not exists chunks (
      id integer primary key,
      file_id integer not null references files(id) on delete cascade,
      start_line integer not null,
      end_line integer not null,
      language text,
      title text,
      text text not null,
      hash text not null,
      unique(file_id, start_line, end_line, hash)
    );

    create table if not exists embedding_sets (
      id integer primary key,
      provider text not null,
      base_url_hash text not null,
      model text not null,
      dimensions integer not null,
      created_at text not null default (datetime('now')),
      unique(provider, base_url_hash, model, dimensions)
    );

    create table if not exists embeddings (
      id integer primary key,
      chunk_id integer not null references chunks(id) on delete cascade,
      embedding_set_id integer not null references embedding_sets(id) on delete cascade,
      created_at text not null default (datetime('now')),
      unique(chunk_id, embedding_set_id)
    );

    insert or ignore into schema_migrations(version) values (1);
  `);

  const tableName = vectorTableName(options.vectorDimensions);
  db.exec(`create virtual table if not exists ${tableName} using vec0(embedding float[${options.vectorDimensions}]);`);
}

export function upsertFile(db: Database, input: FileRecordInput): number {
  db.prepare(`
    insert into files(project_path, path, mtime_ms, size, hash)
    values (@projectPath, @path, @mtimeMs, @size, @hash)
    on conflict(project_path, path) do update set
      mtime_ms = excluded.mtime_ms,
      size = excluded.size,
      hash = excluded.hash
  `).run(input);

  const row = db
    .prepare("select id from files where project_path = ? and path = ?")
    .get(input.projectPath, input.path) as { id: number };
  return row.id;
}

export function insertChunk(db: Database, input: ChunkRecordInput): number {
  db.prepare(`
    insert or ignore into chunks(file_id, start_line, end_line, language, title, text, hash)
    values (@fileId, @startLine, @endLine, @language, @title, @text, @hash)
  `).run({
    ...input,
    language: input.language ?? null,
    title: input.title ?? null,
  });

  const row = db
    .prepare("select id from chunks where file_id = ? and start_line = ? and end_line = ? and hash = ?")
    .get(input.fileId, input.startLine, input.endLine, input.hash) as { id: number };
  return row.id;
}

export function getOrCreateEmbeddingSet(db: Database, input: EmbeddingSetInput): number {
  db.prepare(`
    insert or ignore into embedding_sets(provider, base_url_hash, model, dimensions)
    values (@provider, @baseUrlHash, @model, @dimensions)
  `).run(input);

  const row = db
    .prepare(`
      select id from embedding_sets
      where provider = ? and base_url_hash = ? and model = ? and dimensions = ?
    `)
    .get(input.provider, input.baseUrlHash, input.model, input.dimensions) as { id: number };
  return row.id;
}

export function getOrCreateEmbeddingRecord(db: Database, input: EmbeddingRecordInput): number {
  db.prepare(`
    insert or ignore into embeddings(chunk_id, embedding_set_id)
    values (@chunkId, @embeddingSetId)
  `).run(input);

  const row = db
    .prepare("select id from embeddings where chunk_id = ? and embedding_set_id = ?")
    .get(input.chunkId, input.embeddingSetId) as { id: number };
  return row.id;
}
