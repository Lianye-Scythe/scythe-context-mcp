import { describe, expect, it } from "vitest";
import { fuseRrf, metrics } from "./hybrid-fusion-benchmark.mjs";

const semantic = (path: string, distance = 0.1) => ({ path, startLine: 1, endLine: 3, distance, snippet: path, matchType: "semantic" });
const keyword = (path: string, score = -1) => ({ path, startLine: 1, endLine: 3, score, snippet: path, matchType: "keyword" });

describe("benchmark-only RRF", () => {
  it("promotes cross-channel agreement and ignores raw score scales", () => {
    const a = fuseRrf([semantic("vector.ts"), semantic("both.ts")], [keyword("both.ts"), keyword("lexical.ts")], 8);
    const b = fuseRrf([semantic("vector.ts", 100), semantic("both.ts", 1000)], [keyword("both.ts", -10000), keyword("lexical.ts", -1000)], 8);
    expect(a.map((item) => [item.path, item.score])).toEqual(b.map((item) => [item.path, item.score]));
    expect(a[0].path).toBe("both.ts");
    expect(a[0].score).toBeCloseTo(1 / 62 + 1 / 61);
    expect(a[0].matchTypes).toEqual(["semantic", "keyword"]);
    expect(a[0].distance).toBe(0.1);
    expect(a[0].keywordScore).toBe(-1);
  });

  it("does not double-count the same chunk within a channel, and breaks ties deterministically", () => {
    const results = fuseRrf([semantic("z.ts"), semantic("z.ts")], [keyword("a.ts")], 8);
    expect(results.map((item) => item.path)).toEqual(["a.ts", "z.ts"]);
    expect(results[0].score).toBe(results[1].score);
    expect(fuseRrf([], [keyword("a.ts"), keyword("b.ts")], 1)).toHaveLength(1);
    expect(fuseRrf([], [], 8)).toEqual([]);
    expect(() => fuseRrf([], [], 8, 0)).toThrow("positive integer");
  });

  it("keeps separate chunks from the same file and uses the longer shared snippet", () => {
    const second = { ...semantic("a.ts"), startLine: 4, endLine: 6 };
    const results = fuseRrf([semantic("a.ts"), second], [{ ...keyword("a.ts"), snippet: "longer keyword snippet" }], 8);
    expect(results).toHaveLength(2);
    expect(results[0].snippet).toBe("longer keyword snippet");
    expect(results[1].startLine).toBe(4);
  });

  it("measures file ranks without counting repeated chunks as separate files", () => {
    expect(metrics([semantic("a.ts"), semantic("a.ts"), semantic("b.ts")], ["b.ts"])).toEqual({
      paths: ["a.ts", "b.ts"], hit1: 0, hit3: 1, hit5: 1, mrr: 0.5,
    });
    expect(metrics([], ["missing.ts"]).mrr).toBe(0);
  });
});
