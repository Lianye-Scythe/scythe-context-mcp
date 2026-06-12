import { describe, expect, it } from "vitest";
import { mergeHybridResults } from "./hybridSearch.js";

describe("mergeHybridResults", () => {
  it("boosts results that match both semantic and keyword searches", () => {
    const results = mergeHybridResults(
      [
        {
          path: "semantic-only.ts",
          startLine: 1,
          endLine: 2,
          distance: 0.1,
          snippet: "semantic",
          matchType: "semantic",
        },
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          distance: 0.5,
          snippet: "both semantic",
          matchType: "semantic",
        },
      ],
      [
        {
          path: "both.ts",
          startLine: 10,
          endLine: 12,
          score: -1,
          snippet: "both keyword",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results[0].path).toBe("both.ts");
    expect(results[0].matchTypes).toEqual(["semantic", "keyword"]);
  });

  it("keeps keyword-only results for exact symbol matches", () => {
    const results = mergeHybridResults(
      [],
      [
        {
          path: "payment.ts",
          startLine: 1,
          endLine: 1,
          score: -10,
          snippet: "processPayment",
          matchType: "keyword",
        },
      ],
      5,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({ path: "payment.ts", matchTypes: ["keyword"] }));
  });
});
