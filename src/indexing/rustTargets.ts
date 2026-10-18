import path from "node:path";
import { extractFileGraph, type ExtractedDependency } from "./symbolGraph.js";

export interface RustTarget { manifest: string; root: string; directory: string }
const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
const inside = (file: string, directory: string) => directory === "." ? file !== ".." && !file.startsWith("../") : file.startsWith(`${directory}/`);
const literal = (value: string): string | undefined => {
  if (/^'[^'\r\n]*'$/.test(value)) return value.slice(1, -1);
  try { const decoded: unknown = JSON.parse(value); return typeof decoded === "string" ? decoded : undefined; } catch { return undefined; }
};
const cargoText = (content: string) => content.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'[^'\r\n]*'|#[^\n]*/g,
  (token) => token.startsWith('"""') || token.startsWith("'''") || token.startsWith("#") ? blank(token) : token);

export function rustTargetRoots(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): RustTarget[] {
  const manifests = [...active].filter((file) => path.posix.basename(file) === "Cargo.toml").sort((a, b) => b.length - a.length);
  const result: RustTarget[] = [];
  for (const manifest of manifests) {
    const directory = path.posix.dirname(manifest);
    const content = cargoText(sources.get(manifest) ?? "");
    const bins: Array<{ path?: string; hasPath: boolean }> = [];
    let lib: { path?: string; hasPath: boolean } | undefined;
    let section = "", current: typeof lib;
    let autolib: boolean | undefined, autobins: boolean | undefined, edition: string | undefined, workspaceEdition: string | undefined, inheritedEdition = false;
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith("[")) {
        section = line;
        current = undefined;
        if (line === "[lib]") current = lib = { hasPath: false };
        if (line === "[[bin]]") { current = { hasPath: false }; bins.push(current); }
        continue;
      }
      const entry = /^(path|autolib|autobins|edition|edition\.workspace)\s*=\s*(.*)$/.exec(line);
      if (!entry) continue;
      if (current && entry[1] === "path") { current.path = current.hasPath ? undefined : literal(entry[2]); current.hasPath = true; }
      if (section === "[package]") {
        if (entry[1] === "autolib") autolib = entry[2] === "true" ? true : entry[2] === "false" ? false : undefined;
        if (entry[1] === "autobins") autobins = entry[2] === "true" ? true : entry[2] === "false" ? false : undefined;
        if (entry[1] === "edition") edition = literal(entry[2]);
        if (entry[1] === "edition.workspace") inheritedEdition = entry[2] === "true";
      }
      if (section === "[workspace.package]" && entry[1] === "edition") workspaceEdition = literal(entry[2]);
    }
    if (inheritedEdition && workspaceEdition === undefined && !/^\s*\[workspace(?:\]|\.)/m.test(content)) {
      for (const ancestor of manifests.filter((file) => file !== manifest && inside(manifest, path.posix.dirname(file)))) {
        const parent = cargoText(sources.get(ancestor) ?? "");
        if (!/^\s*\[workspace(?:\]|\.)/m.test(parent)) continue;
        let inPackage = false;
        for (const line of parent.split(/\r?\n/)) {
          if (line.trim().startsWith("[")) inPackage = line.trim() === "[workspace.package]";
          const match = inPackage ? /^\s*edition\s*=\s*(.*?)\s*$/.exec(line) : null;
          if (match) workspaceEdition = literal(match[1]);
        }
        break;
      }
    }
    const auto = (edition ?? (inheritedEdition ? workspaceEdition : undefined) ?? "2015") !== "2015" || !lib && bins.length === 0;
    const roots: string[] = [];
    if (lib?.hasPath) { if (lib.path !== undefined) roots.push(lib.path); }
    else if (lib || (autolib ?? auto)) roots.push("src/lib.rs");
    if (autobins ?? auto) roots.push("src/main.rs");
    for (const bin of bins) if (bin.hasPath && bin.path !== undefined) roots.push(bin.path);
    for (const value of roots) {
      if (/^[\/\\]|[\x00-\x1f:*?]/.test(value)) continue;
      const root = path.posix.normalize(path.posix.join(directory, value.replace(/\\/g, "/")));
      if (!root.endsWith(".rs") || !inside(root, directory) || !active.has(root)) continue;
      if (manifests.find((candidate) => inside(root, path.posix.dirname(candidate))) !== manifest) continue;
      if (!result.some((target) => target.manifest === manifest && target.root === root)) result.push({ manifest, root, directory: path.posix.dirname(root) });
    }
  }
  return result;
}

export function createRustResolver(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): (from: string, dependency: ExtractedDependency) => string[] {
  const targets = rustTargetRoots(active, sources);
  const manifests = [...active].filter((file) => path.posix.basename(file) === "Cargo.toml").sort((a, b) => b.length - a.length);
  const rootSymbols = new Map(targets.map((target) => [target.root, new Set(extractFileGraph(target.root, sources.get(target.root) ?? "").symbols.map((symbol) => symbol.name))]));
  const contexts = new Map<string, RustTarget[]>();
  const unique = (candidates: string[]) => { const matches = [...new Set(candidates.filter((file) => active.has(file)))]; return matches.length === 1 ? matches : []; };
  return (from, dependency) => {
    const directory = path.posix.dirname(from);
    const moduleDirectory = (root?: string) => from === root || path.posix.basename(from) === "mod.rs" ? directory : from.slice(0, -3);
    if (dependency.kind === "rust_module") {
      const base = moduleDirectory(targets.find((target) => target.root === from)?.root);
      return unique([`${base}/${dependency.specifier}.rs`, `${base}/${dependency.specifier}/mod.rs`].map((file) => path.posix.normalize(file)));
    }
    if (!contexts.has(from)) {
      const owner = manifests.find((file) => inside(from, path.posix.dirname(file)));
      const exact = targets.filter((target) => target.manifest === owner && target.root === from);
      let candidates = targets.filter((target) => target.manifest === owner && inside(from, target.directory));
      const packageDir = owner ? path.posix.dirname(owner) : ".";
      // Nonstandard test/example/bin roots need explicit support, not library-root guesses.
      if (!exact.length && ["tests", "examples", "benches", "src/bin"].some((part) => inside(from, path.posix.join(packageDir, part)))) {
        candidates = candidates.filter((target) => ["tests", "examples", "benches", "src/bin"].some((part) => inside(target.root, path.posix.join(packageDir, part))));
      }
      const depth = Math.max(-1, ...candidates.map((target) => target.directory === "." ? 0 : target.directory.split("/").length));
      contexts.set(from, exact.length ? exact : candidates.filter((target) => (target.directory === "." ? 0 : target.directory.split("/").length) === depth));
    }
    const resolutions = contexts.get(from)!.map((target): string[] => {
      const parts = dependency.specifier.split("::");
      let base: string;
      if (parts[0] === "crate") { base = target.directory; parts.shift(); }
      else if (parts[0] === "self") { base = moduleDirectory(target.root); parts.shift(); }
      else if (parts[0] === "super") {
        base = moduleDirectory(target.root);
        while (parts[0] === "super") {
          if (base === target.directory || !inside(`${base}/_`, target.directory)) return [];
          base = path.posix.dirname(base); parts.shift();
        }
      } else return [];
      if (parts.at(-1) === "*") parts.pop();
      for (let count = parts.length; count > 0; count--) {
        const stem = path.posix.join(base, ...parts.slice(0, count));
        const candidates = [`${stem}.rs`, `${stem}/mod.rs`].filter((file) => active.has(file));
        if (candidates.length) return unique(candidates);
      }
      if (base !== target.directory) return unique([`${base}.rs`, `${base}/mod.rs`]);
      return parts.length === 0 || parts.length === 1 && rootSymbols.get(target.root)?.has(parts[0]) ? [target.root] : [];
    });
    if (!resolutions.length || resolutions.some((files) => files.length !== 1)) return [];
    return new Set(resolutions.map((files) => files[0])).size === 1 ? resolutions[0] : [];
  };
}
