import { describe, expect, it } from "vitest";
import { buildContextPack } from "./contextPack.js";

describe("buildContextPack", () => {
  it("packs primary snippets, related metadata, and suggested paths", () => {
    const pack = buildContextPack(
      "load service",
      [
        {
          path: "src/service.ts",
          startLine: 1,
          endLine: 10,
          snippet: "export function loadService() {}\n".repeat(8),
          matchTypes: ["semantic", "keyword"],
        },
      ],
      [
        {
          path: "src/service.ts",
          symbols: [
            { name: "loadService", kind: "function", line: 1, signature: "export function loadService()", exported: true },
            { name: "helper", kind: "function", line: 5, signature: "function helper()", exported: false },
          ],
          imports: [
            { specifier: "./repo", resolvedPath: "src/repo.ts", line: 1 },
            { specifier: "./types", resolvedPath: "src/types.ts", line: 2 },
          ],
          importedBy: [{ path: "src/controller.ts", specifier: "./service", line: 3 }],
        },
      ],
      {
        maxContextChars: 80,
        maxRelatedFiles: 1,
        maxRelatedItems: 1,
      },
    );

    expect(pack.primaryResults).toHaveLength(1);
    expect(pack.primaryResults[0].snippetTruncated).toBe(true);
    expect(pack.relatedFiles).toEqual([
      {
        sourcePath: "src/service.ts",
        symbols: [expect.objectContaining({ name: "loadService" })],
        imports: [expect.objectContaining({ resolvedPath: "src/repo.ts" })],
        importedBy: [expect.objectContaining({ path: "src/controller.ts" })],
      },
    ]);
    expect(pack.suggestedPaths).toEqual(["src/service.ts", "src/repo.ts", "src/controller.ts"]);
    expect(pack.context).toEqual(
      expect.objectContaining({
        maxContextChars: 80,
        primaryResultCount: 1,
        relatedFileCount: 1,
        truncatedResults: 1,
      }),
    );
  });

  it("keeps multi-hop related nodes with depth and via metadata", () => {
    const pack = buildContextPack(
      "load service",
      [{ path: "src/controller.ts", startLine: 1, endLine: 5, snippet: "call loadService()" }],
      [
        {
          path: "src/controller.ts",
          depth: 0,
          via: null,
          symbols: [],
          imports: [{ specifier: "./service", resolvedPath: "src/service.ts", line: 1 }],
          importedBy: [],
        },
        {
          path: "src/service.ts",
          depth: 1,
          via: "src/controller.ts",
          symbols: [{ name: "loadService", kind: "function", line: 1, signature: "export function loadService()", exported: true }],
          imports: [{ specifier: "./repo", resolvedPath: "src/repo.ts", line: 2 }],
          importedBy: [{ path: "src/controller.ts", specifier: "./service", line: 1 }],
        },
      ],
      {
        maxContextChars: 200,
        maxRelatedFiles: 4,
        maxRelatedItems: 4,
      },
    );

    expect(pack.relatedFiles).toEqual([
      expect.objectContaining({ sourcePath: "src/controller.ts", depth: 0, via: null }),
      expect.objectContaining({ sourcePath: "src/service.ts", depth: 1, via: "src/controller.ts" }),
    ]);
    expect(pack.suggestedPaths).toEqual(["src/controller.ts", "src/service.ts", "src/repo.ts"]);
    expect(pack.context.relatedFileCount).toBe(2);
  });
});
