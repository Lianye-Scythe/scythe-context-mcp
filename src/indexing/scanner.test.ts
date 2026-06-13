import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanProject } from "./scanner.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-scanner-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("scanProject", () => {
  it("respects .gitignore, file size limits, and binary detection", async () => {
    await fs.writeFile(path.join(tempDir, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(tempDir, "index.ts"), "export const ok = true;\n");
    await fs.writeFile(path.join(tempDir, "package-lock.json"), "{}\n");
    await fs.writeFile(path.join(tempDir, "ignored.txt"), "ignore me\n");
    await fs.writeFile(path.join(tempDir, "large.txt"), "x".repeat(128));
    await fs.writeFile(path.join(tempDir, "binary.bin"), Buffer.from([0, 1, 2, 3]));

    const result = await scanProject(tempDir, { maxFileBytes: 64 });

    expect(result.files.map((file) => file.relativePath)).toEqual([".gitignore", "index.ts"]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relativePath: "ignored.txt", reason: "ignored" }),
        expect.objectContaining({ relativePath: "large.txt", reason: "too_large" }),
        expect.objectContaining({ relativePath: "binary.bin", reason: "binary" }),
      ]),
    );
  });

  it("does not treat a UTF-8 file as binary when the scan prefix ends mid-character", async () => {
    await fs.writeFile(path.join(tempDir, "README.zh-CN.md"), `${"简体中文说明".repeat(900)}\n`);

    const result = await scanProject(tempDir, { maxFileBytes: 64 * 1024 });

    expect(result.files.map((file) => file.relativePath)).toContain("README.zh-CN.md");
    expect(result.skipped).not.toContainEqual(expect.objectContaining({ relativePath: "README.zh-CN.md", reason: "binary" }));
  });
});
