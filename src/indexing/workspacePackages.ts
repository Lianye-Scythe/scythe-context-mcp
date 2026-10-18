import path from "node:path";

type Manifest = Record<string, unknown>;
export type WorkspaceResolver = (from: string, specifier: string, mode?: "source" | "config") => string | undefined;

interface IndexedPackage {
  directory: string;
  data?: Manifest;
}

interface PackageSpecifier {
  name: string;
  subpath: string;
}

interface ExportSelection {
  value: unknown;
  capture?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Retain the same supported segment syntax for specifiers, targets and captures.
function hasSupportedSegments(value: string): boolean {
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/[^\\%?#:\x00-\x20]+)*$/i.test(value)
    && !value.split("/").some((part) => part === "." || part === ".." || part === "node_modules");
}

function parsePackageSpecifier(specifier: string): PackageSpecifier | undefined {
  if (!hasSupportedSegments(specifier)) return undefined;
  const segments = specifier.split("/");
  const nameLength = specifier.startsWith("@") ? 2 : 1;
  const name = segments.slice(0, nameLength).join("/");
  const remaining = segments.slice(nameLength);
  return { name, subpath: remaining.length ? `./${remaining.join("/")}` : "." };
}

function readIndexedPackages(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): IndexedPackage[] {
  return [...active].filter((file) => path.posix.basename(file) === "package.json").map((file) => {
    let data: unknown;
    try {
      data = JSON.parse(sources.get(file) ?? "");
    } catch {
      // Invalid nearest manifests must remain package boundaries.
    }
    return { directory: path.posix.dirname(file), data: isRecord(data) ? data : undefined };
  }).sort((a, b) => b.directory.length - a.directory.length);
}

function declaresWorkspaceDependency(manifest: Manifest, name: string): boolean {
  const declarations: unknown[] = [];
  for (const key of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const group = manifest[key];
    if (isRecord(group) && name in group) declarations.push(group[name]);
  }
  return declarations.length > 0
    && declarations.every((value) => typeof value === "string" && /^workspace:(?:\*|\^|~)$/.test(value));
}

function findWorkspacePackage(owner: IndexedPackage, name: string, packages: IndexedPackage[]): IndexedPackage | undefined {
  if (!owner.data) return undefined;
  if (owner.data.name === name) return owner;
  if (!declaresWorkspaceDependency(owner.data, name)) return undefined;
  const candidates = packages.filter((item) => item.data?.name === name);
  return candidates.length === 1 ? candidates[0] : undefined;
}

function indexedExportTarget(pkg: IndexedPackage, target: string, active: ReadonlySet<string>): string | undefined {
  if (!target.startsWith("./") || !hasSupportedSegments(target.slice(2))) return undefined;
  const file = path.posix.join(pkg.directory, target);
  return active.has(file) ? file : undefined;
}

function selectPackageExport(exports: unknown, subpath: string): ExportSelection | undefined {
  if (!isRecord(exports) || !Object.keys(exports).some((key) => key.startsWith("."))) {
    return subpath === "." ? { value: exports } : undefined;
  }
  if (Object.keys(exports).some((key) => !key.startsWith("."))) return undefined;
  if (Object.hasOwn(exports, subpath)) return { value: exports[subpath] };

  const matches = Object.keys(exports).flatMap((key) => {
    const pieces = key.split("*");
    if (!key.startsWith("./") || pieces.length !== 2) return [];
    const [prefix, suffix] = pieces;
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix) || subpath.length < prefix.length + suffix.length) return [];
    return [{ key, prefix, suffix, capture: subpath.slice(prefix.length, subpath.length - suffix.length) }];
  }).sort((a, b) => b.prefix.length - a.prefix.length || b.suffix.length - a.suffix.length);
  const selected = matches[0];
  if (!selected || !selected.capture || !hasSupportedSegments(selected.capture)) return undefined;
  return { value: exports[selected.key], capture: selected.capture };
}

function collectExportTargets(
  pkg: IndexedPackage, value: unknown, active: ReadonlySet<string>, capture?: string, depth = 0,
): string[] | undefined {
  if (depth > 32) return undefined;
  if (typeof value === "string") {
    if (capture === undefined && value.includes("*")) return undefined;
    const target = capture === undefined ? value : value.replaceAll("*", capture);
    const file = indexedExportTarget(pkg, target, active);
    return file ? [file] : [];
  }
  // Arrays, null blockers and unrecognized branches must not become fallback guesses.
  if (!isRecord(value) || !Object.keys(value).length
    || Object.keys(value).some((key) => key.startsWith(".") || /^\d+$/.test(key))) return undefined;
  const branches = Object.values(value).map((branch) => collectExportTargets(pkg, branch, active, capture, depth + 1));
  const targets: string[] = [];
  for (const branch of branches) {
    if (branch === undefined) return undefined;
    targets.push(...branch);
  }
  return targets;
}

/** Indexed workspace: links are navigation hints, not an installed package graph. */
export function createWorkspaceResolver(active: ReadonlySet<string>, sources: ReadonlyMap<string, string>): WorkspaceResolver {
  const packages = readIndexedPackages(active, sources);
  return (from, specifier, mode = "source") => {
    const parsed = parsePackageSpecifier(specifier);
    if (!parsed) return undefined;
    const owner = packages.find((item) => item.directory === "." || from.startsWith(`${item.directory}/`));
    if (!owner) return undefined;
    const pkg = findWorkspacePackage(owner, parsed.name, packages);
    if (!pkg?.data) return undefined;

    if (pkg.data.exports === undefined) {
      // Explicit config subpaths are common for workspace-only tsconfig packages.
      if (mode !== "config" || parsed.subpath === ".") return undefined;
      return indexedExportTarget(pkg, parsed.subpath, active);
    }
    const selection = selectPackageExport(pkg.data.exports, parsed.subpath);
    if (!selection) return undefined;
    // Without import/require/platform context, accept only one indexed target
    // across all branches. Missing generated output is never synthesized.
    const targets = collectExportTargets(pkg, selection.value, active, selection.capture);
    if (targets === undefined) return undefined;
    const unique = [...new Set(targets)];
    return unique.length === 1 ? unique[0] : undefined;
  };
}
