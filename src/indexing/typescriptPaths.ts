import path from "node:path";
import { createWorkspaceResolver, type WorkspaceResolver } from "./workspacePackages.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const contained = (value: string) => value !== ".." && !value.startsWith("../") && !path.posix.isAbsolute(value) && !/[\x00-\x1f:]/.test(value);
const join = (base: string, value: string) => {
  const normalized = value.replace(/\\/g, "/");
  if (path.posix.isAbsolute(normalized) || /[\x00-\x1f:]|\$\{/.test(normalized)) return undefined;
  const target = path.posix.normalize(path.posix.join(base, normalized));
  return contained(target) ? target : undefined;
};

export function parseJsonConfig(content: string): Record<string, unknown> | undefined {
  try {
    const withoutComments = content.replace(/^\uFEFF/, "").replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
      (token) => token.startsWith('"') ? token : token.replace(/[^\r\n]/g, " "));
    const value: unknown = JSON.parse(withoutComments.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, (token) => token.startsWith('"') ? token : ""));
    return object(value) ? value : undefined;
  } catch { return undefined; }
}

export function localConfigParents(file: string, content: string, activePaths: ReadonlySet<string>, workspace?: WorkspaceResolver): string[] | undefined {
  const config = parseJsonConfig(content);
  if (!config) return undefined;
  if (config.extends === undefined) return [];
  const parents = Array.isArray(config.extends) ? config.extends : [config.extends];
  const result: string[] = [];
  for (const parent of parents) {
    if (typeof parent !== "string") return undefined;
    if (!parent.startsWith(".")) {
      const target = workspace?.(file, parent, "config");
      if (!target) return undefined;
      result.push(target);
      continue;
    }
    const stem = join(path.posix.dirname(file), parent);
    if (!stem) return undefined;
    const target = [stem, `${stem}.json`, `${stem}/tsconfig.json`].find((candidate) => activePaths.has(candidate));
    if (!target) return undefined;
    result.push(target);
  }
  return result;
}

export function localConfigReferences(file: string, content: string, active: ReadonlySet<string>): string[] | undefined {
  const raw = parseJsonConfig(content);
  if (!raw) return undefined;
  if (raw.references === undefined) return [];
  if (!Array.isArray(raw.references) || raw.references.length > 256) return undefined;
  const result: string[] = [];
  for (const reference of raw.references) {
    if (!object(reference) || typeof reference.path !== "string") return undefined;
    const stem = join(path.posix.dirname(file), reference.path);
    const target = stem === undefined ? undefined : [`${stem}/tsconfig.json`, stem].find((candidate) => active.has(candidate));
    if (!target) return undefined;
    result.push(target);
  }
  return result;
}

interface Selection {
  directory: string;
  patterns: string[];
}

interface Config {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  pathsDirectory?: string;
  files?: Selection;
  include?: Selection;
  exclude?: Selection;
}

type ConfigLoader = (file: string, visiting?: Set<string>) => Config | undefined;
type AliasResolution = { matched: false } | { matched: true; target: string | undefined };

interface AliasMatch {
  targets: string[];
  capture: string;
  priority: number;
}

function isPathMappings(value: unknown): value is Record<string, string[]> {
  return object(value) && Object.entries(value).every(([pattern, targets]) => pattern.split("*").length <= 2
    && Array.isArray(targets) && targets.every((target) => typeof target === "string"
      && target.split("*").length <= (pattern.includes("*") ? 2 : 1)));
}

function isFilePatterns(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((pattern) => typeof pattern === "string"
    && !/[\\:{}()!\[\]\x00-\x1f]|^\//.test(pattern));
}

function applyConfigOverrides(file: string, raw: Record<string, unknown>, inherited: Config): Config | undefined {
  if (raw.compilerOptions !== undefined && !object(raw.compilerOptions)) return undefined;
  const options = object(raw.compilerOptions) ? raw.compilerOptions : {};
  const config = { ...inherited };
  if (options.baseUrl !== undefined) {
    if (typeof options.baseUrl !== "string") return undefined;
    const baseUrl = join(path.posix.dirname(file), options.baseUrl);
    if (baseUrl === undefined) return undefined;
    config.baseUrl = baseUrl;
  }
  if (options.paths !== undefined) {
    if (!isPathMappings(options.paths)) return undefined;
    config.paths = options.paths;
    config.pathsDirectory = path.posix.dirname(file);
  }
  for (const key of ["files", "include", "exclude"] as const) {
    const patterns = raw[key];
    if (patterns === undefined) continue;
    if (!isFilePatterns(patterns)) return undefined;
    config[key] = { directory: path.posix.dirname(file), patterns };
  }
  return config;
}

function selected(from: string, config: Config): boolean | undefined {
  const matches = (selection: Selection | undefined) => selection?.patterns.some((pattern) => {
    pattern = pattern.replace(/^(?:\.\/)+/, "").replace(/\/$/, "") || ".";
    const relative = path.posix.relative(selection.directory, from);
    if (pattern.includes("*") || pattern.includes("?")) return path.posix.matchesGlob(relative, pattern);
    return relative === pattern || relative.startsWith(`${pattern.replace(/\/$/, "")}/`)
      || pattern === "." && relative !== ".." && !relative.startsWith("../");
  });
  if (config.files?.patterns.some((file) => path.posix.join(config.files!.directory, file) === from)) return true;
  if (matches(config.exclude)) return false;
  if (!config.files && !config.include) return undefined;
  return !!matches(config.include);
}

function localModule(stem: string, activePaths: ReadonlySet<string>): string | undefined {
  let candidates: string[];
  const extension = path.posix.extname(stem);
  if ([".js", ".jsx"].includes(extension)) {
    const base = stem.slice(0, -extension.length);
    candidates = [`${base}.ts`, `${base}.tsx`, `${base}.d.ts`, stem];
  } else if ([".mjs", ".cjs"].includes(extension)) {
    const base = stem.slice(0, -extension.length), ts = extension === ".mjs" ? ".mts" : ".cts";
    candidates = [`${base}${ts}`, `${base}.d${ts}`, stem];
  } else if (extension) candidates = [stem];
  else {
    const extensions = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];
    candidates = [...extensions.map((ext) => stem + ext), ...extensions.map((ext) => `${stem}/index${ext}`)];
  }
  return candidates.find((candidate) => activePaths.has(candidate));
}

function createConfigLoader(activePaths: ReadonlySet<string>, sources: ReadonlyMap<string, string>, workspace: WorkspaceResolver): ConfigLoader {
  const cache = new Map<string, Config | undefined>();
  const load: ConfigLoader = (file, visiting = new Set<string>()) => {
    if (visiting.has(file) || visiting.size >= 64) return undefined;
    if (cache.has(file)) return cache.get(file);
    const text = sources.get(file);
    const raw = text === undefined ? undefined : parseJsonConfig(text);
    const parents = text === undefined ? undefined : localConfigParents(file, text, activePaths, workspace);
    if (!raw || !parents) {
      cache.set(file, undefined);
      return undefined;
    }
    const next = new Set(visiting).add(file);
    let config: Config = {};
    for (const parent of parents) {
      const inherited = load(parent, next);
      if (!inherited) {
        cache.set(file, undefined);
        return undefined;
      }
      config = { ...config, ...inherited };
    }
    const resolved = applyConfigOverrides(file, raw, config);
    cache.set(file, resolved);
    return resolved;
  };
  return load;
}

function createDefaultConfigLookup(activePaths: ReadonlySet<string>): (from: string) => string | undefined {
  const defaults = [...activePaths].filter((file) => /(?:^|\/)(?:tsconfig|jsconfig)\.json$/.test(file))
    .sort((a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b));
  const owners = new Map<string, string | undefined>();
  return (from) => {
    const directory = path.posix.dirname(from);
    if (!owners.has(directory)) {
      const ancestors = defaults.filter((file) => {
        const parent = path.posix.dirname(file);
        return parent === "." || from.startsWith(`${parent}/`);
      });
      const nearest = ancestors[0];
      const sibling = nearest ? ancestors.find((file) => path.posix.dirname(file) === path.posix.dirname(nearest)
        && path.posix.basename(file) === "tsconfig.json") : undefined;
      owners.set(directory, sibling ?? nearest);
    }
    return owners.get(directory);
  };
}

function createProjectSelector(activePaths: ReadonlySet<string>, sources: ReadonlyMap<string, string>, load: ConfigLoader) {
  const collectMatchingProjects = (file: string, from: string, visiting = new Set<string>(), explicit = false, budget = { remaining: 512 }): Config[] | undefined => {
    if (--budget.remaining < 0 || visiting.has(file) || visiting.size >= 64) return undefined;
    const config = load(file);
    const references = localConfigReferences(file, sources.get(file) ?? "", activePaths);
    if (!config || !references) return undefined;
    const membership = selected(from, config);
    if (membership === undefined && (explicit || references.length > 0)) return undefined;
    if (!references.length) return membership === false ? [] : [config];
    const next = new Set(visiting).add(file);
    const branches = references.map((reference) => collectMatchingProjects(reference, from, next, true, budget));
    const matches: Config[] = [];
    for (const branch of branches) {
      if (branch === undefined) return undefined;
      matches.push(...branch);
    }
    if (membership) matches.push(config);
    return [...new Set(matches)];
  };
  const selectedOwners = new Map<string, Config | undefined>();
  return (owner: string, from: string): Config | undefined => {
    if (!selectedOwners.has(from)) {
      const matches = collectMatchingProjects(owner, from);
      selectedOwners.set(from, matches?.length === 1 ? matches[0] : undefined);
    }
    return selectedOwners.get(from);
  };
}

function resolveAlias(specifier: string, config: Config, activePaths: ReadonlySet<string>): AliasResolution {
  const patterns = Object.entries(config.paths ?? {}).flatMap(([pattern, targets]): AliasMatch[] => {
    const pieces = pattern.split("*");
    if (pieces.length === 1) {
      return pattern === specifier ? [{ targets, capture: "", priority: Infinity }] : [];
    }
    const [prefix, suffix] = pieces;
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) return [];
    return [{ targets, capture: specifier.slice(prefix.length, specifier.length - suffix.length), priority: prefix.length }];
  }).sort((a, b) => b.priority - a.priority);
  if (!patterns.length) return { matched: false };
  if (patterns.length > 1 && patterns[0].priority === patterns[1].priority) return { matched: true, target: undefined };

  const match = patterns[0];
  for (const target of match.targets) {
    const stem = join(config.baseUrl ?? config.pathsDirectory ?? ".", target.replace("*", match.capture));
    const resolved = stem === undefined ? undefined : localModule(stem, activePaths);
    if (resolved) return { matched: true, target: resolved };
  }
  return { matched: true, target: undefined };
}

/** Local source navigation only; does not execute or emulate the complete TS compiler. */
export function createTypeScriptResolver(activePaths: ReadonlySet<string>, sources: ReadonlyMap<string, string>): (from: string, specifier: string) => string[] {
  const workspace = createWorkspaceResolver(activePaths, sources);
  const loadConfig = createConfigLoader(activePaths, sources, workspace);
  const findDefaultConfig = createDefaultConfigLookup(activePaths);
  const selectProject = createProjectSelector(activePaths, sources, loadConfig);
  return (from, specifier) => {
    if (!/\.(?:[cm]?[jt]sx?)$/.test(from) || specifier.startsWith(".") || /[\\:\x00-\x1f]|^\//.test(specifier) || specifier.split("/").some((part) => part === "." || part === "..")) return [];
    const owner = findDefaultConfig(from);
    const config = owner ? selectProject(owner, from) : undefined;
    // An unknown project context must not bypass aliases through workspace exports.
    if (owner && !config) return [];
    if (config) {
      const alias = resolveAlias(specifier, config, activePaths);
      // A selected alias blocks all later fallbacks, even when its target is missing.
      if (alias.matched) return alias.target ? [alias.target] : [];
      const stem = config.baseUrl === undefined ? undefined : join(config.baseUrl, specifier);
      const resolved = stem === undefined ? undefined : localModule(stem, activePaths);
      if (resolved) return [resolved];
    }
    const target = workspace(from, specifier);
    return target ? [target] : [];
  };
}
