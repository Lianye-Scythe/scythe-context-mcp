import fs from "node:fs/promises";
import { localConfigParents, localConfigReferences } from "./typescriptPaths.js";
import { createWorkspaceResolver } from "./workspacePackages.js";
import { rustTargetRoots } from "./rustTargets.js";
import type { FileCandidate } from "./types.js";

/** Read indexed configs/roots as text; never execute project modules or configuration. */
export async function readResolutionSources(files: FileCandidate[]): Promise<Map<string, string>> {
  const byPath = new Map(files.map((file) => [file.relativePath, file.absolutePath]));
  const active = new Set(byPath.keys());
  const sources = new Map<string, string>();
  const packageFiles = [...active].filter((file) => /(?:^|\/)package\.json$/.test(file));
  for (let offset = 0; offset < packageFiles.length; offset += 32) {
    for (const [file, text] of await Promise.all(packageFiles.slice(offset, offset + 32).map(async (file) => [file, await fs.readFile(byPath.get(file)!, "utf8")] as const))) sources.set(file, text);
  }
  const workspace = createWorkspaceResolver(active, sources);
  let pending = [...active].filter((file) => /(?:^|\/)(?:go\.mod|Cargo\.toml|(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json)$/.test(file));
  const configs = new Set(pending.filter((file) => file.endsWith(".json")));
  while (pending.length) {
    const entries: Array<readonly [string, string]> = [];
    for (let offset = 0; offset < pending.length; offset += 32) {
      entries.push(...await Promise.all(pending.slice(offset, offset + 32).map(async (file) => [file, await fs.readFile(byPath.get(file)!, "utf8")] as const)));
    }
    for (const [file, text] of entries) sources.set(file, text);
    const parents = entries.flatMap(([file, text]) => configs.has(file)
      ? [...(localConfigParents(file, text, active, workspace) ?? []), ...(localConfigReferences(file, text, active) ?? [])] : []);
    for (const parent of parents) configs.add(parent);
    pending = [...new Set(parents)].filter((file) => !sources.has(file));
  }
  for (const target of rustTargetRoots(active, sources)) sources.set(target.root, await fs.readFile(byPath.get(target.root)!, "utf8"));
  return sources;
}
