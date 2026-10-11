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
  it("keeps hidden files and the existing root-scoped built-in ignores", async () => {
    const files = [
      ".hidden/config.ts", "src/index.ts", "image.png", "package-lock.json",
      "node_modules/root.ts", ".git/config", ".scythe-context/data.txt", ".repo-beacon/data.txt",
      "dist/output.ts", "nested/image.png", "nested/package-lock.json", "nested/node_modules/kept.ts",
    ];
    for (const file of files) {
      await fs.mkdir(path.dirname(path.join(tempDir, file)), { recursive: true });
      await fs.writeFile(path.join(tempDir, file), "text\n");
    }
    const result = await scanProject(tempDir, { maxFileBytes: 1024 });
    expect(result.files.map((file) => file.relativePath)).toEqual([
      ".hidden/config.ts", "nested/image.png", "nested/node_modules/kept.ts", "nested/package-lock.json", "src/index.ts",
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("does not follow file or directory symlinks, including cycles and outside targets", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-outside-"));
    try {
      await fs.writeFile(path.join(outside, "outside.ts"), "export const outside = true;\n");
      await fs.writeFile(path.join(tempDir, "real.ts"), "export const real = true;\n");
      await fs.symlink(path.join(tempDir, "real.ts"), path.join(tempDir, "linked.ts"), "file");
      await fs.symlink(outside, path.join(tempDir, "outside"), "junction");
      await fs.symlink(tempDir, path.join(tempDir, "cycle"), "junction");
      const result = await scanProject(tempDir, { maxFileBytes: 1024 });
      expect(result.files.map((file) => file.relativePath)).toEqual(["real.ts"]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

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
