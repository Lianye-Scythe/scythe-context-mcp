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
  path: string;
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

export interface SymbolRecordInput {
  fileId: number;
  name: string;
  kind: string;
  line: number;
  signature: string;
  exported: boolean;
}

export interface DependencyRecordInput {
  fileId: number;
  specifier: string;
  resolvedPath?: string | null;
  line: number;
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

    create virtual table if not exists chunk_fts using fts5(
      path,
      title,
      text,
      tokenize='trigram'
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

    create table if not exists file_symbols (
      id integer primary key,
      file_id integer not null references files(id) on delete cascade,
      name text not null,
      kind text not null,
      line integer not null,
      signature text not null,
      exported integer not null default 0
    );

    create index if not exists idx_file_symbols_name on file_symbols(name);
    create index if not exists idx_file_symbols_file_id on file_symbols(file_id);

    create table if not exists file_dependencies (
      id integer primary key,
      file_id integer not null references files(id) on delete cascade,
      specifier text not null,
      resolved_path text,
      line integer not null
    );

    create index if not exists idx_file_dependencies_file_id on file_dependencies(file_id);
    create index if not exists idx_file_dependencies_resolved_path on file_dependencies(resolved_path);

    insert or ignore into schema_migrations(version) values (1);
    insert or ignore into schema_migrations(version) values (2);
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
  db.prepare("delete from chunk_fts where rowid = ?").run(row.id);
  db.prepare("insert into chunk_fts(rowid, path, title, text) values (?, ?, ?, ?)").run(
    row.id,
    input.path,
    input.title ?? "",
    input.text,
  );
  return row.id;
}

export function deleteChunksForFile(db: Database, fileId: number): void {
  const rows = db.prepare("select id from chunks where file_id = ?").all(fileId) as Array<{ id: number }>;
  for (const row of rows) {
    db.prepare("delete from chunk_fts where rowid = ?").run(row.id);
  }
  db.prepare("delete from chunks where file_id = ?").run(fileId);
}

export function rebuildChunkFtsForFile(db: Database, fileId: number, filePath: string): void {
  const rows = db.prepare("select id, title, text from chunks where file_id = ?").all(fileId) as Array<{
    id: number;
    title: string | null;
    text: string;
  }>;
  for (const row of rows) {
    db.prepare("delete from chunk_fts where rowid = ?").run(row.id);
    db.prepare("insert into chunk_fts(rowid, path, title, text) values (?, ?, ?, ?)").run(
      row.id,
      filePath,
      row.title ?? "",
      row.text,
    );
  }
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

export function replaceSymbolGraphForFile(
  db: Database,
  fileId: number,
  symbols: SymbolRecordInput[],
  dependencies: DependencyRecordInput[],
): void {
  db.prepare("delete from file_symbols where file_id = ?").run(fileId);
  db.prepare("delete from file_dependencies where file_id = ?").run(fileId);

  const insertSymbol = db.prepare(`
    insert into file_symbols(file_id, name, kind, line, signature, exported)
    values (@fileId, @name, @kind, @line, @signature, @exported)
  `);
  for (const symbol of symbols) {
    insertSymbol.run({
      ...symbol,
      exported: symbol.exported ? 1 : 0,
    });
  }

  const insertDependency = db.prepare(`
    insert into file_dependencies(file_id, specifier, resolved_path, line)
    values (@fileId, @specifier, @resolvedPath, @line)
  `);
  for (const dependency of dependencies) {
    insertDependency.run({
      ...dependency,
      resolvedPath: dependency.resolvedPath ?? null,
    });
  }
}
