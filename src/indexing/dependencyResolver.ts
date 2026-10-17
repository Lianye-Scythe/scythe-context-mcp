import path from "node:path";
import { cppPath } from "./cpp.js";
import { extractFileGraph, resolveDependencyPath, type ExtractedDependency } from "./symbolGraph.js";

export type DependencyResolver = (fromPath: string, dependency: ExtractedDependency) => string[];

function inside(file: string, directory: string): boolean {
  return directory === "." ? file !== ".." && !file.startsWith("../") && !path.posix.isAbsolute(file) : file.startsWith(`${directory}/`);
}

function uniqueCandidate(candidates: string[], activePaths: ReadonlySet<string>): string[] {
  const matches = [...new Set(candidates.filter((candidate) => activePaths.has(candidate)))];
  return matches.length === 1 ? matches : [];
}

function pythonModule(stem: string, activePaths: ReadonlySet<string>): string[] {
  return uniqueCandidate([`${stem}.py`, path.posix.join(stem, "__init__.py")], activePaths);
}

function pythonDependencies(fromPath: string, dependency: ExtractedDependency, activePaths: ReadonlySet<string>): string[] {
  const { specifier } = dependency;
  const relative = /^(\.+)(.*)$/.exec(specifier);
  let stems: string[];
  if (relative) {
    const packageDir = path.posix.dirname(fromPath);
    // Relative imports need an identifiable package; do not guess a sys.path.
    let packageRoot = packageDir;
    while (path.posix.dirname(packageRoot) !== packageRoot && activePaths.has(path.posix.join(path.posix.dirname(packageRoot), "__init__.py"))) {
      packageRoot = path.posix.dirname(packageRoot);
    }
    const levels = relative[1].length;
    const parent = path.posix.join(packageDir, ...Array<string>(levels - 1).fill(".."));
    if (!activePaths.has(path.posix.join(packageDir, "__init__.py")) || !(parent === packageRoot || inside(parent, packageRoot))) return [];
    stems = [path.posix.join(parent, ...relative[2].split(".").filter(Boolean))];
  } else {
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(specifier)) return [];
    const modulePath = specifier.replace(/\./g, "/");
    stems = [modulePath, `src/${modulePath}`];
  }
  const matches = stems.map((stem) => {
    const base = pythonModule(stem, activePaths);
    const children = dependency.kind === "python_from" && !activePaths.has(`${stem}.py`)
      ? (dependency.importedNames ?? []).flatMap((name) => name === "*" ? [] : pythonModule(path.posix.join(stem, name), activePaths))
      : [];
    return [...new Set([...base, ...children])];
  }).filter((paths) => paths.length > 0);
  // Both flat and src layouts providing the same module is ambiguous.
  return matches.length === 1 ? matches[0] : [];
}

interface GoModule { directory: string; name?: string }

function goDependencies(fromPath: string, specifier: string, modules: GoModule[], packages: ReadonlyMap<string, string[]>): string[] {
  const owner = modules.find((module) => inside(fromPath, module.directory));
  if (!owner?.name || (specifier !== owner.name && !specifier.startsWith(`${owner.name}/`))) return [];
  const suffix = specifier === owner.name ? "" : specifier.slice(owner.name.length + 1);
  if (suffix && suffix.split("/").some((part) => !part || part === "." || part === "..")) return [];
  const directory = path.posix.join(owner.directory, suffix);
  if (modules.find((module) => inside(`${directory}/_`, module.directory)) !== owner) return [];
  return packages.get(directory) ?? [];
}

function rustDependencies(fromPath: string, dependency: ExtractedDependency, activePaths: ReadonlySet<string>, manifests: string[], rootSymbols: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  const { specifier } = dependency;
  const filename = path.posix.basename(fromPath);
  const directory = path.posix.dirname(fromPath);
  const manifest = manifests.find((file) => inside(fromPath, path.posix.dirname(file)));
  const crateDir = manifest ? path.posix.join(path.posix.dirname(manifest), "src") : undefined;
  const rootModule = filename === "mod.rs" || directory === crateDir && /^(?:lib|main)\.rs$/.test(filename);
  const moduleDir = rootModule ? directory : fromPath.slice(0, -3);
  if (dependency.kind === "rust_module") {
    const stem = path.posix.join(moduleDir, specifier);
    return uniqueCandidate([`${stem}.rs`, `${stem}/mod.rs`], activePaths);
  }
  if (!crateDir || !inside(fromPath, crateDir) || inside(fromPath, `${crateDir}/bin`)) return [];
  if (!activePaths.has(`${crateDir}/lib.rs`) && !activePaths.has(`${crateDir}/main.rs`)) return [];
  const parts = specifier.split("::");
  let base: string;
  if (parts[0] === "crate") { base = crateDir; parts.shift(); }
  else if (parts[0] === "self") { base = moduleDir; parts.shift(); }
  else if (parts[0] === "super") {
    base = moduleDir;
    while (parts[0] === "super") {
      if (base === crateDir) return [];
      base = path.posix.dirname(base);
      parts.shift();
    }
  } else return [];
  if (parts.at(-1) === "*") parts.pop();
  // A use may end with a symbol, not a module: find its nearest file module.
  for (let count = parts.length; count > 0; count--) {
    const stem = path.posix.join(base, ...parts.slice(0, count));
    const candidates = [`${stem}.rs`, `${stem}/mod.rs`].filter((file) => activePaths.has(file));
    if (candidates.length > 0) return candidates.length === 1 ? candidates : [];
  }
  if (base !== crateDir) return uniqueCandidate([`${base}.rs`, `${base}/mod.rs`], activePaths);
  const roots = [`${crateDir}/lib.rs`, `${crateDir}/main.rs`];
  return uniqueCandidate(parts.length === 0 ? roots : roots.filter((file) => parts.length === 1 && rootSymbols.get(file)?.has(parts[0])), activePaths);
}

export function createDependencyResolver(activePaths: ReadonlySet<string>, manifests: ReadonlyMap<string, string>): DependencyResolver {
  const modules: GoModule[] = [...activePaths].filter((file) => path.posix.basename(file) === "go.mod").map((file) => {
    const match = /^\s*module\s+(?:"([^"\n]+)"|`([^`\n]+)`|([^\s]+))\s*(?:\/\/[^\n]*)?$/m.exec(manifests.get(file) ?? "");
    return { directory: path.posix.dirname(file), name: match?.[1] ?? match?.[2] ?? match?.[3] };
  }).sort((a, b) => (b.directory === "." ? 0 : b.directory.length) - (a.directory === "." ? 0 : a.directory.length));
  const packages = new Map<string, string[]>();
  for (const file of activePaths) {
    if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
    const directory = path.posix.dirname(file);
    const files = packages.get(directory) ?? [];
    files.push(file);
    packages.set(directory, files);
  }
  for (const files of packages.values()) files.sort();
  const rustManifests = [...activePaths].filter((file) => path.posix.basename(file) === "Cargo.toml").sort((a, b) => b.length - a.length);
  const rootSymbols = new Map([...manifests].filter(([file]) => file.endsWith(".rs"))
    .map(([file, content]) => [file, new Set(extractFileGraph(file, content).symbols.map((symbol) => symbol.name))]));
  return (fromPath, dependency) => {
    if (dependency.kind === "unresolved") return [];
    if (cppPath.test(fromPath)) {
      if (dependency.kind !== "cpp_include" || /[\\:\x00-\x1f]|^\//.test(dependency.specifier)) return [];
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), dependency.specifier));
      return target !== ".." && !target.startsWith("../") && activePaths.has(target) ? [target] : [];
    }
    if (/\.cs$/i.test(fromPath)) return [];
    if (/\.csproj$/i.test(fromPath)) {
      const reference = dependency.specifier.replace(/\\/g, "/");
      if (!/\.csproj$/i.test(reference) || /[$@]\(|[*?;:%]|^\//.test(reference)) return [];
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), reference));
      if (target === ".." || target.startsWith("../") || !activePaths.has(target)) return [];
      return [target];
    }

    if (fromPath.endsWith(".py")) return pythonDependencies(fromPath, dependency, activePaths);
    if (fromPath.endsWith(".go")) return goDependencies(fromPath, dependency.specifier, modules, packages);
    if (fromPath.endsWith(".rs")) return rustDependencies(fromPath, dependency, activePaths, rustManifests, rootSymbols);
    const resolved = resolveDependencyPath(fromPath, dependency.specifier, activePaths);
    return resolved ? [resolved] : [];
  };
}
