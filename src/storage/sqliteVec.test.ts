import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { loadSqliteVec, vectorToFloat32Buffer } from "./sqliteVec.js";

describe("sqlite-vec integration", () => {
  it("loads sqlite-vec and performs a 1536-dimensional nearest-neighbor query", () => {
    const db = new Database(":memory:");
    try {
      expect(loadSqliteVec(db)).toMatch(/^v?\d+\.\d+\.\d+/);
      db.exec("create virtual table vec_chunks using vec0(embedding float[1536]);");

      const insert = db.prepare("insert into vec_chunks(rowid, embedding) values (?, ?)");
      insert.run(1n, vectorToFloat32Buffer(new Array(1536).fill(0.1), 1536));
      insert.run(2n, vectorToFloat32Buffer(new Array(1536).fill(0.2), 1536));

      const query = vectorToFloat32Buffer(new Array(1536).fill(0.12), 1536);
      const rows = db
        .prepare("select rowid, distance from vec_chunks where embedding match ? order by distance limit 2")
        .all(query) as Array<{ rowid: number; distance: number }>;

      expect(rows.map((row) => row.rowid)).toEqual([1, 2]);
      expect(rows[0].distance).toBeLessThan(rows[1].distance);
    } finally {
      db.close();
    }
  });

  it("validates vector dimensions before storage", () => {
    expect(() => vectorToFloat32Buffer([1, 2, 3], 1536)).toThrow(/1536/);
    expect(() => vectorToFloat32Buffer([1, Number.NaN], 2)).toThrow(/non-finite/);
  });
});
