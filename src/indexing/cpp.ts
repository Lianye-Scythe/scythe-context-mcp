import type { ExtractedDependency, ExtractedFileGraph, SymbolKind } from "./symbolGraph.js";

export const cppPath = /\.(?:cpp|cc|cxx|h|hpp|hh|hxx|ipp|tpp)$/i;
const blank = (text: string) => text.replace(/[^\r\n]/g, " ");
const identifier = /^[A-Za-z_]\w*$/;

/** Conservative source hints; no preprocessor, build configuration, or compiler execution. */
export function extractCppGraph(content: string): ExtractedFileGraph {
  let masked = content.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\([\s\S]*?\)\1"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\.|[^'\\])*'/g, blank);
  const starts = [0, ...Array.from(content.matchAll(/\n/g), (match) => match.index + 1)];
  const lineAt = (offset: number) => {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle; else high = middle;
    }
    return low + 1;
  };
  const dependencies: ExtractedDependency[] = [];
  const directives = /^[ \t]*#[^\n\\]*(?:\\(?:\r?\n|[^\n])[^\n\\]*)*/gm;
  const directiveStarts = new Set(Array.from(masked.matchAll(directives), (match) => match.index + match[0].indexOf("#")));
  for (const directive of content.matchAll(/^[ \t]*#[ \t]*include\b([^\r\n]*)/gm)) {
    const hash = directive.index + directive[0].indexOf("#");
    if (masked[hash] !== "#" || !directiveStarts.has(hash)) continue;
    const value = directive[1].replace(/"[^"\r\n]*"|<[^>\r\n]*>|\/\*.*?\*\/|\/\/.*$/g,
      (text) => text.startsWith("/*") || text.startsWith("//") ? " " : text).trim();
    const literal = /^(?:"([^"\r\n]+)"|<([^>\r\n]+)>)\s*$/.exec(value);
    dependencies.push({ specifier: literal?.[1] ?? literal?.[2] ?? value, line: lineAt(hash),
      kind: literal?.[1] ? "cpp_include" : "unresolved" });
  }
  masked = masked.replace(directives, blank);
  const tokens = Array.from(masked.matchAll(/[A-Za-z_]\w*|::|->|[^\s]/g),
    (match) => ({ value: match[0], start: match.index, end: match.index + match[0].length }));
  const symbols: ExtractedFileGraph["symbols"] = [];
  const scopes: Array<{ kind: "namespace" | "type" | "other"; name?: string }> = [];
  let memberStart = 0;
  const add = (name: string, kind: SymbolKind, index: number, end: number, start = memberStart) => {
    const leading = masked.slice(start, end).search(/\S/);
    const symbol = { name, kind, line: lineAt(tokens[index].start),
      signature: content.slice(start + Math.max(0, leading), end).trim().replace(/\s+/g, " ").slice(0, 240), exported: false };
    if (!symbols.some((item) => item.name === name && item.kind === kind && item.line === symbol.line)) symbols.push(symbol);
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const scope = scopes.at(-1);
    const declaration = !scope || scope.kind !== "other";
    if (declaration && token.value === "namespace" && tokens[index + 1]?.value === "{") {
      scopes.push({ kind: "namespace" });
      memberStart = tokens[++index].end;
      continue;
    }
    // Template parameters are not standalone class/struct declarations.
    if (declaration && token.value === "template" && tokens[index + 1]?.value === "<") {
      let depth = 1;
      index += 2;
      for (; index < tokens.length; index++) {
        if (tokens[index].value === "<") depth++;
        if (tokens[index].value === ">" && --depth === 0) break;
      }
      continue;
    }
    if (declaration && ["namespace", "class", "struct", "enum"].includes(token.value)) {
      const nameIndex = token.value === "enum" && ["class", "struct"].includes(tokens[index + 1]?.value) ? index + 2 : index + 1;
      const name = tokens[nameIndex];
      if (name && identifier.test(name.value)) {
        let end = nameIndex + 1;
        while (end < tokens.length && !["{", ";", "=", "(", ")"].includes(tokens[end].value)) end++;
        if (["{", ";"].includes(tokens[end]?.value)) {
          const nameText = token.value === "namespace" ? tokens.slice(nameIndex, end).map((item) => item.value).join("") : name.value;
          add(nameText, token.value as SymbolKind, nameIndex, tokens[end].start);
          if (tokens[end].value === "{") scopes.push({ kind: token.value === "namespace" ? "namespace" : "type", name: name.value });
          memberStart = tokens[end].end;
          index = end;
          continue;
        }
      }
    }
    if (declaration && token.value === "(" && identifier.test(tokens[index - 1]?.value ?? "")) {
      const nameIndex = index - 1;
      const name = tokens[nameIndex].value;
      const prefix = masked.slice(memberStart, tokens[nameIndex].start).trim();
      const constructor = scope?.kind === "type" && name === scope.name && /^(?:(?:explicit|constexpr|consteval|inline)\s+)*(?:~\s*)?$/.test(prefix);
      const qualifiedConstructor = /(?:^|\s)([A-Za-z_]\w*)\s*::\s*(~\s*)?$/.exec(prefix);
      const isConstructor = constructor || qualifiedConstructor?.[1] === name;
      const returnType = prefix.length > 0 && /^[\w\s:*&<>,.[\]]+$/.test(prefix) && !/\b(?:return|throw|new|delete|using|typedef|operator)\b/.test(prefix);
      if ((isConstructor || returnType) && !["if", "for", "while", "switch", "catch", "sizeof", "alignof", "decltype", "noexcept", "static_assert"].includes(name)) {
        let end = index + 1, depth = 1;
        for (; end < tokens.length; end++) {
          if (tokens[end].value === "(") depth++;
          if (tokens[end].value === ")" && --depth === 0) break;
        }
        let body = end + 1;
        while (["const", "volatile", "override", "final", "&", "constexpr", "noexcept"].includes(tokens[body]?.value)) {
          const qualifier = tokens[body++].value;
          if (qualifier === "noexcept" && tokens[body]?.value === "(") {
            let depth = 1;
            while (++body < tokens.length && depth) {
              if (tokens[body].value === "(") depth++;
              if (tokens[body].value === ")") depth--;
            }
          }
        }
        if (tokens[body]?.value === "->") while (body < tokens.length && !["{", ";"].includes(tokens[body].value)) body++;
        const defaulted = tokens[body]?.value === "=" && ["0", "default", "delete"].includes(tokens[body + 1]?.value) && tokens[body + 2]?.value === ";";
        if (["{", ";"].includes(tokens[body]?.value) || defaulted) {
          add(`${tokens[nameIndex - 1]?.value === "~" ? "~" : ""}${name}`, scope?.kind === "type" || /::\s*(?:~\s*)?$/.test(prefix) ? "method" : "function", nameIndex, tokens[end].end);
          index = end;
          continue;
        }
      }
    }
    if (token.value === "{") { scopes.push({ kind: "other" }); memberStart = token.end; }
    if (token.value === "}") { scopes.pop(); memberStart = token.end; }
    if (token.value === ";" || token.value === ":" && ["public", "private", "protected"].includes(tokens[index - 1]?.value)) memberStart = token.end;
  }
  return { symbols, dependencies };
}
