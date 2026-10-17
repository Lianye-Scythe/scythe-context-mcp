import type { ExtractedDependency } from "./symbolGraph.js";

// Preserve line numbers while removing comments. Quoted Go import paths survive.
function withoutComments(content: string): string {
  return content.replace(/"(?:\\.|[^"\\])*"|`[^`]*`|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (text) =>
    text.startsWith("/") ? text.replace(/[^\n]/g, " ") : text,
  );
}

function pythonImports(content: string): ExtractedDependency[] {
  const dependencies: ExtractedDependency[] = [];
  const masked = content.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|#[^\n]*/g,
    (text) => text.replace(/[^\n]/g, " "));
  const lines = masked.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (!/^\s*(?:from|import)\s/.test(line)) continue;
    const lineNumber = index + 1;
    while ((line.includes("(") && !line.includes(")") || /\\\s*$/.test(line)) && index + 1 < lines.length) {
      line = line.replace(/\\\s*$/, "") + " " + lines[++index].replace(/#.*/, "");
    }
    const from = /^\s*from\s+([.\w]+)\s+import\s+([\s\S]+)$/.exec(line);
    if (from) {
      const importedNames = from[2].replace(/[()]/g, "").split(",")
        .map((name) => name.trim().split(/\s+as\s+/)[0]).filter((name) => /^(?:\*|[A-Za-z_]\w*)$/.test(name));
      dependencies.push({ specifier: from[1], line: lineNumber, kind: "python_from", importedNames });
    } else {
      for (const entry of line.replace(/^\s*import\s+/, "").split(",")) {
        const specifier = entry.trim().split(/\s+as\s+/)[0];
        if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(specifier)) dependencies.push({ specifier, line: lineNumber });
      }
    }
  }
  return dependencies;
}

function goImports(content: string): ExtractedDependency[] {
  const dependencies: ExtractedDependency[] = [];
  const lines = withoutComments(content).replace(/`[^`]*`/g, (text) => text.includes("\n") ? text.replace(/[^\n]/g, " ") : text).split(/\r?\n/);
  let inBlock = false;
  for (const [index, line] of lines.entries()) {
    const start = /^\s*import\b\s*([\s\S]*)$/.exec(line);
    if (!start && !inBlock) continue;
    let entry = start ? start[1] : line;
    if (start && entry.trimStart().startsWith("(")) {
      inBlock = true;
      entry = entry.trimStart().slice(1);
    }
    const pattern = /(?:^|[;\s])(?:[A-Za-z_]\w*\s+|\.\s+)?["`]([^"`\r\n]+)["`]/g;
    for (const match of entry.matchAll(pattern)) dependencies.push({ specifier: match[1], line: index + 1 });
    if (entry.includes(")")) inBlock = false;
  }
  return dependencies;
}

function splitUseEntries(text: string): string[] {
  const entries: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "{") depth++;
    if (text[index] === "}") depth--;
    if (text[index] === "," && depth === 0) { entries.push(text.slice(start, index)); start = index + 1; }
  }
  entries.push(text.slice(start));
  return entries.filter((entry) => entry.trim());
}

function expandUse(text: string, prefix = ""): string[] {
  return splitUseEntries(text).flatMap((entry) => {
    entry = entry.trim();
    const brace = entry.indexOf("{");
    if (brace >= 0) {
      if (!entry.endsWith("}")) return [];
      return expandUse(entry.slice(brace + 1, -1), prefix + entry.slice(0, brace).replace(/\s/g, ""));
    }
    const leaf = entry.split(/\s+as\s+/)[0].replace(/\s/g, "");
    const specifier = leaf === "self" && prefix ? prefix.replace(/::$/, "") : prefix + leaf;
    return /^(?:::)?(?:[A-Za-z_]\w*::)*(?:[A-Za-z_]\w*|\*)$/.test(specifier) ? [specifier] : [];
  });
}

function rustImports(content: string): ExtractedDependency[] {
  const masked = withoutComments(content)
    .replace(/r(#{0,255})"[\s\S]*?"\1/g, (text) => text.replace(/[^\n]/g, " "))
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'/g, (text) => text.replace(/[^\n]/g, " "));
  const lines = masked.split(/\r?\n/);
  const dependencies: ExtractedDependency[] = [];
  let depth = 0;
  let customPath = false;
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (/^\s*#\s*\[\s*(?:path\b|cfg_attr\b)/.test(line)) customPath = true;
    line = line.replace(/^\s*(?:#\[[^\]]*\]\s*)+/, "");
    const module = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/.exec(line);
    if (module) dependencies.push({ specifier: module[1], line: index + 1, kind: depth === 0 && !customPath ? "rust_module" : "unresolved" });
    const use = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\s\S]*)$/.exec(line);
    if (use) {
      const lineNumber = index + 1;
      let statement = use[1];
      while (!statement.includes(";") && index + 1 < lines.length) statement += " " + lines[++index];
      statement = statement.split(";")[0];
      for (const specifier of expandUse(statement)) dependencies.push({ specifier, line: lineNumber, ...(depth > 0 ? { kind: "unresolved" as const } : {}) });
      continue;
    }
    depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
    if (line.trim() && !/^\s*#/.test(line)) customPath = false;
  }
  return dependencies;
}

export function extractLanguageImports(relativePath: string, content: string): ExtractedDependency[] | undefined {
  if (relativePath.endsWith(".py")) return pythonImports(content);
  if (relativePath.endsWith(".go")) return goImports(content);
  if (relativePath.endsWith(".rs")) return rustImports(content);
  return undefined;
}
