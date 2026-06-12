import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import ignore from "ignore";
import { isProbablyBinary } from "./binary.js";
import type { FileCandidate, IndexingLimits, ScanResult, SkippedFile } from "./types.js";

const BUILT_IN_IGNORES = [
  ".git/**",
  ".repo-beacon/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  ".next/**",
  ".turbo/**",
  "coverage/**",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.pdf",
  "*.zip",
  "*.gz",
  "*.tar",
  "*.7z",
  "*.woff",
  "*.woff2",
  "*.ttf",
];

async function loadGitignore(projectPath: string) {
  const matcher = ignore();
  try {
    const content = await fs.readFile(path.join(projectPath, ".gitignore"), "utf8");
    matcher.add(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  return matcher;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function hasBinaryHeader(absolutePath: string): Promise<boolean> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return isProbablyBinary(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

export async function scanProject(
  projectPath: string,
  limits: Pick<IndexingLimits, "maxFileBytes">,
): Promise<ScanResult> {
  const resolvedProjectPath = path.resolve(projectPath);
  const gitignore = await loadGitignore(resolvedProjectPath);
  const entries = await fg("**/*", {
    cwd: resolvedProjectPath,
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: BUILT_IN_IGNORES,
    unique: true,
  });

  const files: FileCandidate[] = [];
  const skipped: SkippedFile[] = [];

  for (const entry of entries.sort()) {
    const relativePath = toPosixPath(entry);
    if (gitignore.ignores(relativePath)) {
      skipped.push({ relativePath, reason: "ignored" });
      continue;
    }

    const absolutePath = path.resolve(resolvedProjectPath, relativePath);
    if (!absolutePath.startsWith(resolvedProjectPath + path.sep)) {
      skipped.push({ relativePath, reason: "outside_project" });
      continue;
    }

    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        skipped.push({ relativePath, reason: "not_file" });
        continue;
      }

      if (stat.size > limits.maxFileBytes) {
        skipped.push({
          relativePath,
          reason: "too_large",
          size: stat.size,
          detail: `size ${stat.size} exceeds maxFileBytes ${limits.maxFileBytes}`,
        });
        continue;
      }

      if (await hasBinaryHeader(absolutePath)) {
        skipped.push({ relativePath, reason: "binary", size: stat.size });
        continue;
      }

      files.push({
        relativePath,
        absolutePath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    } catch (error) {
      skipped.push({
        relativePath,
        reason: "read_error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { projectPath: resolvedProjectPath, files, skipped };
}
