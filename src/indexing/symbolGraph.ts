export type SymbolKind =
  | "class"
  | "const"
  | "enum"
  | "function"
  | "interface"
  | "module"
  | "struct"
  | "trait"
  | "type"
  | "variable";

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;
  exported: boolean;
}

export interface ExtractedDependency {
  specifier: string;
  line: number;
}

export interface ExtractedFileGraph {
  symbols: ExtractedSymbol[];
  dependencies: ExtractedDependency[];
}

interface SymbolPattern {
  kind: SymbolKind;
  regex: RegExp;
  nameGroup?: number;
  exportedGroup?: number;
}

const symbolPatterns: SymbolPattern[] = [
  { kind: "function", regex: /^(\s*export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "class", regex: /^(\s*export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "interface", regex: /^(\s*export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "type", regex: /^(\s*export\s+)?type\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "enum", regex: /^(\s*export\s+)?enum\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "const", regex: /^(\s*export\s+)?const\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 2, exportedGroup: 1 },
  { kind: "variable", regex: /^\s*(?:let|var)\s+([A-Za-z_$][\w$]*)\b/, nameGroup: 1 },
  { kind: "function", regex: /^\s*def\s+([A-Za-z_]\w*)\b/, nameGroup: 1 },
  { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)\b/, nameGroup: 1 },
  { kind: "function", regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\b/, nameGroup: 1 },
  { kind: "type", regex: /^\s*type\s+([A-Za-z_]\w*)\b/, nameGroup: 1 },
  { kind: "function", regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\b/, nameGroup: 1, exportedGroup: 0 },
  { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)\b/, nameGroup: 1, exportedGroup: 0 },
  { kind: "enum", regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)\b/, nameGroup: 1, exportedGroup: 0 },
  { kind: "trait", regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)\b/, nameGroup: 1, exportedGroup: 0 },
  { kind: "module", regex: /^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\b/, nameGroup: 1, exportedGroup: 0 },
];

const javascriptImportPatterns = [
  /\bimport\s+(?:[^'"`"]+\s+from\s+)?["'`]([^"'`]+)["'`]/g,
  /\bexport\s+[^"'`]+\s+from\s+["'`]([^"'`]+)["'`]/g,
  /\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
];

const pythonImportPatterns = [
  /\bfrom\s+([A-Za-z_][\w.]+)\s+import\b/g,
  /^\s*import\s+([A-Za-z_][\w.]+)/g,
];

const rustImportPatterns = [
  /^\s*use\s+([^;]+);/g,
  /^\s*mod\s+([A-Za-z_]\w*)\s*;/g,
];

const goImportPatterns = [/^\s*import\s+["`]([^"`]+)["`]/g, /^\s*["`]([^"`]+)["`]/g];

function dependencyPatternsForPath(relativePath: string): RegExp[] {
  if (/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/.test(relativePath)) return javascriptImportPatterns;
  if (/\.py$/.test(relativePath)) return pythonImportPatterns;
  if (/\.rs$/.test(relativePath)) return rustImportPatterns;
  if (/\.go$/.test(relativePath)) return goImportPatterns;
  return javascriptImportPatterns;
}

function normalizeSignature(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 240);
}

function addUnique<T>(items: T[], item: T, key: (value: T) => string): void {
  if (!items.some((existing) => key(existing) === key(item))) {
    items.push(item);
  }
}

function extractDependenciesFromLine(patterns: RegExp[], line: string, lineNumber: number): ExtractedDependency[] {
  const dependencies: ExtractedDependency[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line))) {
      const specifier = match[1]?.trim();
      if (specifier) {
        addUnique(dependencies, { specifier, line: lineNumber }, (dep) => `${dep.specifier}:${dep.line}`);
      }
    }
  }
  return dependencies;
}

export function extractFileGraph(relativePath: string, content: string): ExtractedFileGraph {
  const symbols: ExtractedSymbol[] = [];
  const dependencies: ExtractedDependency[] = [];
  const dependencyPatterns = dependencyPatternsForPath(relativePath);
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const pattern of symbolPatterns) {
      const match = pattern.regex.exec(line);
      if (!match) continue;

      const name = match[pattern.nameGroup ?? 1];
      if (!name) continue;
      addUnique(
        symbols,
        {
          name,
          kind: pattern.kind,
          line: lineNumber,
          signature: normalizeSignature(line),
          exported: pattern.exportedGroup === 0 ? /\bpub\b/.test(line) : Boolean(match[pattern.exportedGroup ?? -1]),
        },
        (symbol) => `${symbol.name}:${symbol.kind}:${symbol.line}`,
      );
      break;
    }

    for (const dependency of extractDependenciesFromLine(dependencyPatterns, line, lineNumber)) {
      addUnique(dependencies, dependency, (dep) => `${dep.specifier}:${dep.line}`);
    }
  });

  return { symbols, dependencies };
}

export function resolveDependencyPath(fromPath: string, specifier: string, activePaths: ReadonlySet<string>): string | null {
  if (!specifier.startsWith(".")) return null;

  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const normalized = new URL(specifier, `file:///${fromDir ? `${fromDir}/` : ""}`).pathname.replace(/^\/+/, "");
  const withoutRuntimeExtension = normalized.replace(/\.(?:js|jsx|mjs|cjs)$/, "");
  const candidates = [
    normalized,
    withoutRuntimeExtension,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    `${withoutRuntimeExtension}.mts`,
    `${withoutRuntimeExtension}.cts`,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    `${normalized}.js`,
    `${normalized}.jsx`,
    `${normalized}.mjs`,
    `${normalized}.cjs`,
    `${normalized}.py`,
    `${normalized}/index.ts`,
    `${normalized}/index.tsx`,
    `${normalized}/index.js`,
    `${normalized}/index.jsx`,
  ];

  return candidates.find((candidate) => activePaths.has(candidate)) ?? null;
}
