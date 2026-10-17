import path from "node:path";
import type { ExtractedDependency, ExtractedFileGraph, ExtractedSymbol, SymbolKind } from "./symbolGraph.js";

function lineLookup(content: string): (offset: number) => number {
  const starts = [0, ...Array.from(content.matchAll(/\n/g), (match) => match.index + 1)];
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle; else high = middle;
    }
    return low + 1;
  };
}

const blank = (text: string) => text.replace(/[^\n\r]/g, " ");

interface Token { value: string; start: number; end: number }
interface Scope { kind: "namespace" | "type" | "other"; name?: string; typeKind?: SymbolKind }
const identifier = /^@?[A-Za-z_][\w]*$/;
const modifiers = /^(?:(?:public|private|protected|internal|static|abstract|sealed|partial|virtual|override|async|extern|unsafe|new|readonly)\s+)*/;

export function extractCSharpGraph(content: string): ExtractedFileGraph {
  const masked = content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|("{3,})[\s\S]*?\1|@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'/g, blank).replace(/^[ \t]*#[^\n]*/gm, blank);
  const tokens: Token[] = Array.from(masked.matchAll(/@?[A-Za-z_][\w]*|=>|::|[^\s]/g),
    (match) => ({ value: match[0], start: match.index, end: match.index + match[0].length }));
  const lineAt = lineLookup(content);
  const symbols: ExtractedSymbol[] = [];
  const symbolKeys = new Set<string>();
  const dependencies: ExtractedDependency[] = [];
  const scopes: Scope[] = [];
  let fileNamespace = "";
  let memberStart = 0;
  const signature = (start: number, end: number) => {
    const leading = masked.slice(start, end).search(/\S/);
    return content.slice(start + Math.max(0, leading), end).trim().replace(/\s+/g, " ").slice(0, 240);
  };
  const add = (name: string, kind: SymbolKind, token: Token, start: number, end: number, exported: boolean) => {
    const symbol = { name: name.replace(/^@/, ""), kind, line: lineAt(token.start), signature: signature(start, end), exported };
    const key = `${symbol.name}:${kind}:${symbol.line}`;
    if (!symbolKeys.has(key)) { symbols.push(symbol); symbolKeys.add(key); }
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const scope = scopes.at(-1);
    const declarationScope = !scope || scope.kind === "namespace" || scope.kind === "type";
    const namespaceScope = !scope || scope.kind === "namespace";
    if (token.value === "using" && namespaceScope) {
      let semicolon = index + 1;
      while (semicolon < tokens.length && tokens[semicolon].value !== ";") semicolon++;
      if (semicolon < tokens.length) {
        const directive = masked.slice(token.end, tokens[semicolon].start).trim();
        const match = /^(?:static\s+)?(?:@?[A-Za-z_]\w*\s*=\s*)?((?:global\s*::\s*)?@?[A-Za-z_]\w*(?:\s*\.\s*@?[A-Za-z_]\w*)*)\s*$/.exec(directive);
        if (match) {
          dependencies.push({ specifier: match[1].replace(/\s/g, ""), line: lineAt(token.start), kind: "unresolved" });
          index = semicolon;
          memberStart = tokens[semicolon].end;
          continue;
        }
      }
    }
    if (token.value === "namespace" && namespaceScope) {
      let end = index + 1;
      while (end < tokens.length && (identifier.test(tokens[end].value) || tokens[end].value === ".")) end++;
      const name = tokens.slice(index + 1, end).map((item) => item.value.replace(/^@/, "")).join("");
      if (name && [";", "{"].includes(tokens[end]?.value)) {
        const parent = [...scopes].reverse().find((item) => item.kind === "namespace")?.name ?? fileNamespace;
        const fullName = parent ? `${parent}.${name}` : name;
        add(fullName, "namespace", token, token.start, tokens[end].start, false);
        if (tokens[end].value === "{") scopes.push({ kind: "namespace", name: fullName }); else fileNamespace = fullName;
        memberStart = tokens[end].end;
        index = end;
        continue;
      }
    }
    if (declarationScope && ["class", "interface", "struct", "enum", "record"].includes(token.value)) {
      const nameIndex = token.value === "record" && ["class", "struct"].includes(tokens[index + 1]?.value) ? index + 2 : index + 1;
      const name = tokens[nameIndex];
      if (name && identifier.test(name.value)) {
        let end = nameIndex + 1;
        let parentheses = 0;
        for (; end < tokens.length; end++) {
          if (tokens[end].value === "(") parentheses++;
          if (tokens[end].value === ")") parentheses--;
          if (parentheses === 0 && ["{", ";"].includes(tokens[end].value)) break;
        }
        if (end < tokens.length) {
          const prefix = masked.slice(memberStart, token.start);
          add(name.value, token.value as SymbolKind, name, memberStart, tokens[end].start, /\bpublic\b/.test(prefix));
          if (tokens[end].value === "{") scopes.push({ kind: "type", name: name.value, typeKind: token.value as SymbolKind });
          index = end;
          memberStart = tokens[end].end;
          continue;
        }
      }
    }
    if (token.value === "(" && scope?.kind === "type" && scope.typeKind !== "enum") {
      const header = masked.slice(memberStart, token.start).replace(/\[[^\]]*\]/g, " ").trim();
      let nameIndex = index - 1;
      if (tokens[nameIndex]?.value === ">") {
        let genericDepth = 1;
        while (--nameIndex >= 0) {
          if (tokens[nameIndex].value === ">") genericDepth++;
          if (tokens[nameIndex].value === "<" && --genericDepth === 0) { nameIndex--; break; }
        }
      }
      const name = tokens[nameIndex];
      const prefix = name ? masked.slice(memberStart, name.start).replace(/\[[^\]]*\]/g, " ").trim().replace(modifiers, "").trim() : "";
      const constructor = name?.value === scope.name && prefix === "";
      const returnType = /^[A-Za-z_@][\w@.:\s<>,?\[\]*]*$/.test(prefix) && !/\b(?:return|throw|new|delegate|event|operator)\b/.test(prefix);
      if (name && identifier.test(name.value) && !/[=;{}]/.test(header) && (constructor || returnType)) {
        let end = index + 1;
        let depth = 1;
        for (; end < tokens.length; end++) {
          if (tokens[end].value === "(") depth++;
          if (tokens[end].value === ")" && --depth === 0) break;
        }
        let body = end + 1;
        if (tokens[body]?.value === "where" || constructor && tokens[body]?.value === ":") {
          while (body < tokens.length && !["{", "=>", ";"].includes(tokens[body].value)) body++;
        }
        if (end < tokens.length && ["{", "=>", ";"].includes(tokens[body]?.value)) {
          add(name.value, "method", name, memberStart, tokens[end].end,
            /\bpublic\b/.test(header) || scope.typeKind === "interface" && !/\b(?:private|protected|internal)\b/.test(header));
          index = end;
          continue;
        }
      }
    }
    if (token.value === "{") { scopes.push({ kind: "other" }); memberStart = token.end; }
    if (token.value === "}") { scopes.pop(); memberStart = token.end; }
    if (token.value === ";") memberStart = token.end;
  }
  return { symbols, dependencies };
}

function xmlText(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (entity) => {
    const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
    if (named[entity]) return named[entity];
    const code = Number.parseInt(entity.slice(entity.startsWith("&#x") ? 3 : 2, -1), entity.startsWith("&#x") ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function extractCSharpProjectGraph(content: string): ExtractedFileGraph {
  const masked = content.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, blank);
  const lineAt = lineLookup(content);
  const conditions: boolean[] = [];
  const dependencies: ExtractedDependency[] = [];
  const removed = new Set<string>();
  for (const tag of masked.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    if (tag[1]) { conditions.pop(); continue; }
    const name = tag[2].split(":").at(-1)!;
    const attributes = new Map(Array.from(tag[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g),
      (attribute) => [attribute[1], xmlText(attribute[2] ?? attribute[3])]));
    const conditional = conditions.at(-1) === true || attributes.has("Condition") || ["Choose", "When", "Otherwise", "Target"].includes(name);
    if (name === "ProjectReference") {
      const include = attributes.get("Include");
      if (include) dependencies.push({ specifier: include, line: lineAt(tag.index), ...(conditional ? { kind: "unresolved" as const } : {}) });
      const remove = attributes.get("Remove");
      if (remove) removed.add(path.posix.normalize(remove.replace(/\\/g, "/")));
    }
    if (!/\/\s*$/.test(tag[3])) conditions.push(conditional);
  }
  return { symbols: [], dependencies: dependencies.map((dependency) => removed.has(path.posix.normalize(dependency.specifier.replace(/\\/g, "/"))) ? { ...dependency, kind: "unresolved" } : dependency) };
}
