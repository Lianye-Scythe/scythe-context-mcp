import { describe, expect, it } from "vitest";
import { formatSearchResults, grepKeywords, matchReason } from "./resultFormat.js";

describe("result formatting", () => {
  it("builds grep keywords from query and path", () => {
    expect(grepKeywords("find processPayment logging", { path: "src/payment-service.ts" })).toEqual([
      "find",
      "processPayment",
      "logging",
      "src",
      "payment",
      "service",
    ]);
  });

  it("describes semantic and keyword match reasons", () => {
    expect(matchReason({ path: "a", startLine: 1, endLine: 1, matchTypes: ["semantic", "keyword"] })).toBe(
      "semantic similarity plus keyword/path match",
    );
    expect(matchReason({ path: "a", startLine: 1, endLine: 1, distance: 0.123456 })).toBe(
      "semantic similarity distance 0.1235",
    );
  });

  it("adds formatting fields to results", () => {
    const results = formatSearchResults("load user", [
      { path: "src/user.ts", startLine: 1, endLine: 2, matchTypes: ["keyword"] },
    ]);

    expect(results[0]).toEqual(
      expect.objectContaining({
        grepKeywords: expect.arrayContaining(["load", "user", "src"]),
        matchReason: "keyword/path match",
      }),
    );
  });
});
