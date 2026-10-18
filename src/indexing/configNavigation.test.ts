import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { persistentReindexMetadata } from "./indexWriter.js";
import { readRelatedFiles } from "./relatedFiles.js";

const directories: string[] = [];
async function project(files: Record<string, string>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-config-navigation-"));
  directories.push(directory);
  for (const [file, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), content);
  }
  return directory;
}
const index = (projectPath: string) => persistentReindexMetadata({ projectPath, indexDirName: ".scythe-context", vectorDimensions: 3 });
const related = (dbPath: string, filePath: string) => readRelatedFiles({ dbPath, filePath, maxResults: 30 });
function chunkIds(dbPath: string, file: string) {
  const db = new Database(dbPath, { readonly: true });
  try { return db.prepare("select chunks.id from chunks join files on files.id=chunks.file_id where files.path=? order by chunks.id").all(file); }
  finally { db.close(); }
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("configuration-driven local navigation", () => {
  it("refreshes declared workspace exports and config inheritance after manifest-only edits", async () => {
    const directory = await project({
      "apps/web/package.json": JSON.stringify({ dependencies: { "@repo/ui": "workspace:*" }, devDependencies: { "@repo/tsconfig": "workspace:*" } }),
      "packages/ui/package.json": JSON.stringify({ name: "@repo/ui", exports: { "./button": "./src/button.ts" } }),
      "tooling/tsconfig/package.json": JSON.stringify({ name: "@repo/tsconfig" }),
      "tooling/tsconfig/base.jsonc": '{"extends":"./defaults.json","compilerOptions":{"strict":true}}',
      "tooling/tsconfig/defaults.json": '{}',
      "apps/web/tsconfig.json": '{"extends":"@repo/tsconfig/base.jsonc","compilerOptions":{"paths":{"~/*":["./src/*"]}}}',
      "apps/web/src/main.ts": 'import "@repo/ui/button";\nimport "~/local";',
      "apps/web/src/local.ts": 'export const local = true;',
      "packages/ui/src/button.ts": 'export const button = true;',
      "packages/ui/src/other.ts": 'export const other = true;',
    });
    const first = await index(directory);
    const ids = chunkIds(first.dbPath, "apps/web/src/main.ts");
    expect(related(first.dbPath, "apps/web/src/main.ts").imports.map((item) => item.resolvedPath)).toEqual(["packages/ui/src/button.ts", "apps/web/src/local.ts"]);
    expect(related(first.dbPath, "packages/ui/src/button.ts").importedBy.some((item) => item.path === "apps/web/src/main.ts")).toBe(true);
    await fs.writeFile(path.join(directory, "packages/ui/package.json"), JSON.stringify({ name: "@repo/ui", exports: { "./button": "./src/other.ts" } }));
    await index(directory);
    expect(related(first.dbPath, "apps/web/src/main.ts").imports[0].resolvedPath).toBe("packages/ui/src/other.ts");
    expect(related(first.dbPath, "packages/ui/src/button.ts").importedBy).toEqual([]);
    await fs.rm(path.join(directory, "packages/ui/src/other.ts"));
    await index(directory);
    expect(related(first.dbPath, "apps/web/src/main.ts").imports[0].resolvedPath).toBeNull();
    await fs.writeFile(path.join(directory, "apps/web/package.json"), '{}');
    await index(directory);
    expect(related(first.dbPath, "apps/web/src/main.ts").imports.map((item) => item.resolvedPath)).toEqual([null, null]);
    expect(chunkIds(first.dbPath, "apps/web/src/main.ts")).toEqual(ids);
  });

  it("reads referenced arbitrary config filenames and refreshes project selection without replacing source chunks", async () => {
    const directory = await project({
      "tsconfig.json": '{"files":[],"references":[{"path":"./config/app.jsonc"},{"path":"./config/node.json"}]}',
      "config/app.jsonc": '{"include":["../src"],"compilerOptions":{"paths":{"@/*":["../src/*"]}}}',
      "config/node.json": '{"files":["../vite.config.ts"],"compilerOptions":{"paths":{"@/*":["../tools/*"]}}}',
      "src/main.ts": 'import "@/value";',
      "src/value.ts": 'export const value = 1;',
      "tools/value.ts": 'export const value = 2;',
      "vite.config.ts": 'import "@/value";',
    });
    const first = await index(directory);
    const ids = chunkIds(first.dbPath, "src/main.ts");
    expect(related(first.dbPath, "src/main.ts").imports[0].resolvedPath).toBe("src/value.ts");
    expect(related(first.dbPath, "vite.config.ts").imports[0].resolvedPath).toBe("tools/value.ts");
    await fs.writeFile(path.join(directory, "config/app.jsonc"), '{"include":["../src"],"compilerOptions":{"paths":{"@/*":["../tools/*"]}}}');
    await index(directory);
    expect(related(first.dbPath, "src/main.ts").imports[0].resolvedPath).toBe("tools/value.ts");
    await fs.rm(path.join(directory, "config/node.json"));
    await index(directory);
    expect(related(first.dbPath, "src/main.ts").imports[0].resolvedPath).toBeNull();
    expect(chunkIds(first.dbPath, "src/main.ts")).toEqual(ids);
  });

  it("loads arbitrary relative parent JSONC files and refreshes aliases when only config changes", async () => {
    const directory = await project({
      "tsconfig.json": '{"extends":"./config/base.jsonc"}',
      "config/base.jsonc": '{// comment\n"extends":"./defaults","compilerOptions":{"paths":{"@/*":["../src/*"]},},}',
      "config/defaults.json": '{"compilerOptions":{"strict":true}}',
      "src/main.ts": 'import { auth } from "@/auth";\n',
      "src/auth.ts": "export const auth = true;\n",
      "other/auth.ts": "export const auth = false;\n",
    });
    const first = await index(directory);
    const ids = chunkIds(first.dbPath, "src/main.ts");
    expect(related(first.dbPath, "src/main.ts").imports).toEqual([{ specifier: "@/auth", line: 1, resolvedPath: "src/auth.ts" }]);
    await fs.writeFile(path.join(directory, "config/base.jsonc"), '{"compilerOptions":{"paths":{"@/*":["../other/*"]}}}');
    await index(directory);
    expect(related(first.dbPath, "src/main.ts").imports[0].resolvedPath).toBe("other/auth.ts");
    expect(chunkIds(first.dbPath, "src/main.ts")).toEqual(ids);
    await fs.rm(path.join(directory, "other/auth.ts"));
    await index(directory);
    expect(related(first.dbPath, "src/main.ts").imports[0].resolvedPath).toBeNull();
    expect(chunkIds(first.dbPath, "src/main.ts")).toEqual(ids);
  });

  it("reads custom Rust root symbols and refreshes root context after a Cargo-only change", async () => {
    const directory = await project({
      "Cargo.toml": '[package]\nname="tool"\nedition="2024"\n[[bin]]\nname="tool"\npath="cmd/tool/entry.rs"',
      "cmd/tool/entry.rs": "mod flags;\npub fn main() {}\n",
      "cmd/tool/flags/mod.rs": "use super::main;\n",
      "cmd/other.rs": "pub fn other() {}\n",
    });
    const first = await index(directory);
    const ids = chunkIds(first.dbPath, "cmd/tool/entry.rs");
    expect(related(first.dbPath, "cmd/tool/entry.rs").imports[0].resolvedPath).toBe("cmd/tool/flags/mod.rs");
    expect(related(first.dbPath, "cmd/tool/flags/mod.rs").imports[0].resolvedPath).toBe("cmd/tool/entry.rs");
    await fs.writeFile(path.join(directory, "Cargo.toml"), '[package]\nname="tool"\nedition="2024"\n[[bin]]\nname="other"\npath="cmd/other.rs"');
    await index(directory);
    expect(related(first.dbPath, "cmd/tool/entry.rs").imports[0].resolvedPath).toBeNull();
    expect(related(first.dbPath, "cmd/tool/flags/mod.rs").imports[0].resolvedPath).toBeNull();
    expect(chunkIds(first.dbPath, "cmd/tool/entry.rs")).toEqual(ids);
  });

  it("does not read an ignored parent config or link ignored targets", async () => {
    const directory = await project({
      ".gitignore": "private.json\nsecret.ts\n",
      "tsconfig.json": '{"extends":"./private"}',
      "private.json": '{"compilerOptions":{"paths":{"alias":["secret"]}}}',
      "secret.ts": "export const value = 1;",
      "app.ts": 'import "alias";',
    });
    const result = await index(directory);
    expect(related(result.dbPath, "app.ts").imports[0].resolvedPath).toBeNull();
    const db = new Database(result.dbPath, { readonly: true });
    try { expect(db.prepare("select path from files where path in ('private.json','secret.ts')").all()).toEqual([]); }
    finally { db.close(); }
  });
});
