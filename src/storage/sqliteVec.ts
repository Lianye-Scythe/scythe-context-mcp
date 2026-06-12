import type { Database } from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export function loadSqliteVec(db: Database): string {
  sqliteVec.load(db);
  const row = db.prepare("select vec_version() as version").get() as { version: string };
  return row.version;
}

export function vectorToFloat32Buffer(vector: readonly number[], expectedDimensions: number): Buffer {
  if (vector.length !== expectedDimensions) {
    throw new Error(`Expected vector with ${expectedDimensions} dimensions, received ${vector.length}`);
  }

  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("Vector contains a non-finite value");
    }
  }

  return Buffer.from(new Float32Array(vector).buffer);
}

