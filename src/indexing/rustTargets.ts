import path from "node:path";
import { extractFileGraph, type ExtractedDependency } from "./symbolGraph.js";

export interface RustTarget {
  manifest: string;
  root: string;
  directory: string;
}

interface TargetDefinition {
  path?: string;
  hasPath: boolean;
}

interface CargoManifest {
  lib?: TargetDefinition;
  bins: TargetDefinition[];
  autolib?: boolean;
  autobins?: boolean;
  edition?: string;
  workspaceEdition?: string;
  inheritedEdition: boolean;
  hasWorkspace: boolean;
}

const separateTargetDirectories = ["tests", "examples", "benches", "src/bin"];
const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
const inside = (file: string, directory: string) => directory === "." ? file !== ".." && !file.startsWith("../") : file.startsWith(`${directory}/`);

function literal(value: string): string | undefined {
  if (/^'[^'\r\n]*'$/.test(value)) return value.slice(1, -1);
  try {
    const decoded: unknown = JSON.parse(value);
    return typeof decoded === "string" ? decoded : undefined;
  } catch {
    return undefined;
  }
}

const cargoText = (content: string) => content.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^'\r\n]*'|#[^\n]*/g,
  (token) => token.startsWith('"""') || token.startsWith("'''") || token.startsWith("#") ? blank(token) : token);
const hasWorkspace = (content: string) => /^\s*\[workspace(?:\]|\.)/m.test(content);
const manifestPaths = (active: ReadonlySet<string>) => [...active]
  .filter((file) => path.posix.basename(file) === "Cargo.toml").sort((a, b) => b.length - a.length);

function parseCargoManifest(content: string): CargoManifest {
  const config: CargoManifest = { bins: [], inheritedEdition: false, hasWorkspace: hasWorkspace(content) };
  let section = "";
  let current: TargetDefinition | undefined;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      section = line;
      current = undefined;
      if (line === "[lib]") {
        current = { hasPath: false };
        config.lib = current;
      }
      if (line === "[[bin]]") {
        current = { hasPath: false };
        config.bins.push(current);
      }
      continue;
    }
    const entry = /^(path|autolib|autobins|edition|edition\.workspace)\s*=\s*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, value] = entry;
    if (current && key === "path") {
      current.path = current.hasPath ? undefined : literal(value);
      current.hasPath = true;
    }
    if (section === "[package]") {
      if (key === "autolib" || key === "autobins") config[key] = value === "true" ? true : value === "false" ? false : undefined;
      if (key === "edition") config.edition = literal(value);
      if (key === "edition.workspace") config.inheritedEdition = value === "true";
    }
    if (section === "[workspace.package]" && key === "edition") config.workspaceEdition = literal(value);
  }
  return config;
}

function inheritedWorkspaceEdition(manifest: string, manifests: string[], sources: ReadonlyMap<string, string>): string | undefined {
  const ancestors = manifests.filter((file) => file !== manifest && inside(manifest, path.posix.dirname(file)));
  for (const ancestor of ancestors) {
    const content = cargoText(sources.get(ancestor) ?? "");
    if (!hasWorkspace(content)) continue;
    let inPackage = false;
    let edition: string | undefined;
    for (const line of content.split(/\r?\n/)) {
      if (line.trim().startsWith("[")) inPackage = line.trim() === "[workspace.package]";
      const match = inPackage ? /^\s*edition\s*=\s*(.*?)\s*$/.exec(line) : null;
      if (match) edition = literal(match[1]);
    }
    return edition;
  }
  return undefined;
}

function targetPaths(config: CargoManifest, edition: string): string[] {
  const { lib, bins, autolib, autobins } = config;
  const auto = edition !== "2015" || !lib && bins.length === 0;
  const roots: string[] = [];
  if (lib?.hasPath) {
    if (lib.path !== undefined) roots.push(lib.path);
  } else if (lib || (autolib ?? auto)) roots.push("src/lib.rs");
  if (autobins ?? auto) roots.push("src/main.rs");
  for (const bin of bins) {
    if (bin.hasPath && bin.path !== undefined) roots.push(bin.path);
  }
  return roots;
}

export function rustTargetRoots(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): RustTarget[] {
  const manifests = manifestPaths(active);
  const result: RustTarget[] = [];
  for (const manifest of manifests) {
    const directory = path.posix.dirname(manifest);
    const config = parseCargoManifest(cargoText(sources.get(manifest) ?? ""));
    let workspaceEdition = config.workspaceEdition;
    if (config.inheritedEdition && workspaceEdition === undefined && !config.hasWorkspace) {
      workspaceEdition = inheritedWorkspaceEdition(manifest, manifests, sources);
    }
    const edition = config.edition ?? (config.inheritedEdition ? workspaceEdition : undefined) ?? "2015";
    for (const value of targetPaths(config, edition)) {
      if (/^[\/\\]|[\x00-\x1f:*?]/.test(value)) continue;
      const root = path.posix.normalize(path.posix.join(directory, value.replace(/\\/g, "/")));
      if (!root.endsWith(".rs") || !inside(root, directory) || !active.has(root)) continue;
      if (manifests.find((candidate) => inside(root, path.posix.dirname(candidate))) !== manifest) continue;
      if (!result.some((target) => target.manifest === manifest && target.root === root)) {
        result.push({ manifest, root, directory: path.posix.dirname(root) });
      }
    }
  }
  return result;
}

function moduleDirectory(from: string, root?: string): string {
  return from === root || path.posix.basename(from) === "mod.rs" ? path.posix.dirname(from) : from.slice(0, -3);
}

function uniqueModule(candidates: string[], active: ReadonlySet<string>): string[] {
  const matches = [...new Set(candidates.filter((file) => active.has(file)))];
  return matches.length === 1 ? matches : [];
}

function targetContexts(from: string, targets: RustTarget[], manifests: string[]): RustTarget[] {
  const owner = manifests.find((file) => inside(from, path.posix.dirname(file)));
  const exact = targets.filter((target) => target.manifest === owner && target.root === from);
  let candidates = targets.filter((target) => target.manifest === owner && inside(from, target.directory));
  const packageDir = owner ? path.posix.dirname(owner) : ".";
  const inSeparateTarget = (file: string) => separateTargetDirectories.some((part) => inside(file, path.posix.join(packageDir, part)));
  // Nonstandard test/example/bin roots need explicit support, not library-root guesses.
  if (!exact.length && inSeparateTarget(from)) candidates = candidates.filter((target) => inSeparateTarget(target.root));
  const depthOf = (target: RustTarget) => target.directory === "." ? 0 : target.directory.split("/").length;
  const depth = Math.max(-1, ...candidates.map(depthOf));
  return exact.length ? exact : candidates.filter((target) => depthOf(target) === depth);
}

function resolveAnchoredUse(
  from: string, specifier: string, target: RustTarget, active: ReadonlySet<string>, rootSymbols: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const parts = specifier.split("::");
  let base: string;
  if (parts[0] === "crate") {
    base = target.directory;
    parts.shift();
  } else if (parts[0] === "self") {
    base = moduleDirectory(from, target.root);
    parts.shift();
  } else if (parts[0] === "super") {
    base = moduleDirectory(from, target.root);
    while (parts[0] === "super") {
      if (base === target.directory || !inside(`${base}/_`, target.directory)) return [];
      base = path.posix.dirname(base);
      parts.shift();
    }
  } else return [];
  if (parts.at(-1) === "*") parts.pop();
  for (let count = parts.length; count > 0; count--) {
    const stem = path.posix.join(base, ...parts.slice(0, count));
    const candidates = [`${stem}.rs`, `${stem}/mod.rs`].filter((file) => active.has(file));
    if (candidates.length) return uniqueModule(candidates, active);
  }
  if (base !== target.directory) return uniqueModule([`${base}.rs`, `${base}/mod.rs`], active);
  const refersToRoot = parts.length === 0 || parts.length === 1 && rootSymbols.get(target.root)?.has(parts[0]);
  return refersToRoot ? [target.root] : [];
}

export function createRustResolver(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): (from: string, dependency: ExtractedDependency) => string[] {
  const targets = rustTargetRoots(active, sources);
  const manifests = manifestPaths(active);
  const rootSymbols = new Map(targets.map((target) => [target.root, new Set(extractFileGraph(target.root, sources.get(target.root) ?? "").symbols.map((symbol) => symbol.name))]));
  const contexts = new Map<string, RustTarget[]>();
  return (from, dependency) => {
    if (dependency.kind === "rust_module") {
      const root = targets.find((target) => target.root === from)?.root;
      const base = moduleDirectory(from, root);
      return uniqueModule([`${base}/${dependency.specifier}.rs`, `${base}/${dependency.specifier}/mod.rs`].map((file) => path.posix.normalize(file)), active);
    }
    let candidates = contexts.get(from);
    if (candidates === undefined) {
      candidates = targetContexts(from, targets, manifests);
      contexts.set(from, candidates);
    }
    const resolutions = candidates.map((target) => resolveAnchoredUse(from, dependency.specifier, target, active, rootSymbols));
    if (!resolutions.length || resolutions.some((files) => files.length !== 1)) return [];
    return new Set(resolutions.map((files) => files[0])).size === 1 ? resolutions[0] : [];
  };
}
