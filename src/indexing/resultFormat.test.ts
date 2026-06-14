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
    const formatted = formatSearchResults("load user", [
      { path: "src/user.ts", startLine: 1, endLine: 2, matchTypes: ["keyword"] },
    ]);

    expect(formatted.results[0]).toEqual(
      expect.objectContaining({
        grepKeywords: expect.arrayContaining(["load", "user", "src"]),
        matchReason: "keyword/path match",
      }),
    );
    expect(formatted.summary).toEqual({ maxContextChars: null, usedContextChars: 0, estimatedTokens: 0, truncatedResults: 0 });
  });

  it("enforces a total snippet character budget", () => {
    const formatted = formatSearchResults(
      "load user",
      [
        { path: "src/a.ts", startLine: 1, endLine: 2, snippet: "12345" },
        { path: "src/b.ts", startLine: 3, endLine: 4, snippet: "abcdefghijklmnopqrstuvwxyz" },
      ],
      { maxContextChars: 20 },
    );

    expect(formatted.results[0].snippet).toBe("12345");
    expect(formatted.results[1].snippet).toContain("[truncated]");
    expect(formatted.results[1].snippetTruncated).toBe(true);
    expect(formatted.summary.maxContextChars).toBe(20);
    expect(formatted.summary.usedContextChars).toBeLessThanOrEqual(20);
    expect(formatted.summary.estimatedTokens).toBeGreaterThan(0);
    expect(formatted.summary.truncatedResults).toBe(1);
  });
});
