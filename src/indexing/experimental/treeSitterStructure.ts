import fs from "node:fs";
import path from "node:path";
import type { Language, Node, Parser } from "web-tree-sitter";
import { regexStructureExtractor } from "../structureExtractor.js";
import type { CodeStructureExtractor } from "../structureExtractor.js";
import type { ExtractedDependency, ExtractedFileGraph, ExtractedSymbol, SymbolKind } from "../symbolGraph.js";

const TREE_SITTER_CANDIDATE_EXTENSIONS = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;
const STRING_QUOTES = /^["'`]|["'`]$/g;

export interface ExperimentalTreeSitterExtractorOptions {
  grammarDir?: string;
}

export interface ExperimentalTreeSitterExtractor extends CodeStructureExtractor {
  readonly experimental: true;
  readonly parserAvailable: boolean;
  readonly loadedLanguages: readonly string[];
  readonly fallbackReason?: string;
}

export function isTreeSitterCandidatePath(relativePath: string): boolean {
  return TREE_SITTER_CANDIDATE_EXTENSIONS.test(relativePath);
}

type TreeSitterLanguageKey = "javascript" | "typescript" | "tsx";

interface LoadedTreeSitterRuntime {
  parser: Parser;
  languages: Partial<Record<TreeSitterLanguageKey, Language>>;
}

const grammarCandidates: Record<TreeSitterLanguageKey, string[]> = {
  javascript: ["tree-sitter-javascript.wasm", "javascript.wasm"],
  typescript: ["tree-sitter-typescript.wasm", "typescript.wasm"],
  tsx: ["tree-sitter-tsx.wasm", "tsx.wasm"],
};

function fallbackExtractor(reason?: string): ExperimentalTreeSitterExtractor {
  return {
    name: "tree-sitter-experimental",
    experimental: true,
    parserAvailable: false,
    loadedLanguages: [],
    fallbackReason: reason,
    extractFileGraph(relativePath, content) {
      return regexStructureExtractor.extractFileGraph(relativePath, content);
    },
  };
}

function findGrammarPath(grammarDir: string, language: TreeSitterLanguageKey): string | undefined {
  for (const candidate of grammarCandidates[language]) {
    const candidatePath = path.join(grammarDir, candidate);
    if (fs.existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
}

async function loadTreeSitterRuntime(options: ExperimentalTreeSitterExtractorOptions): Promise<LoadedTreeSitterRuntime | null> {
  if (!options.grammarDir) return null;
  if (!fs.existsSync(options.grammarDir)) return null;

  const treeSitter = await import("web-tree-sitter");
  await treeSitter.Parser.init();
  const languages: Partial<Record<TreeSitterLanguageKey, Language>> = {};
  for (const language of Object.keys(grammarCandidates) as TreeSitterLanguageKey[]) {
    const grammarPath = findGrammarPath(options.grammarDir, language);
    if (grammarPath) {
      languages[language] = await treeSitter.Language.load(grammarPath);
    }
  }
  return { parser: new treeSitter.Parser(), languages };
}

function languageForPath(relativePath: string): TreeSitterLanguageKey | undefined {
  if (/\.tsx$/.test(relativePath)) return "tsx";
  if (/\.(?:cts|mts|ts)$/.test(relativePath)) return "typescript";
  if (/\.(?:cjs|js|jsx|mjs)$/.test(relativePath)) return "javascript";
  return undefined;
}

function normalizeSignature(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 240);
}

function lineForNode(node: Node): number {
  return node.startPosition.row + 1;
}

function cleanStringLiteral(text: string): string {
  return text.trim().replace(STRING_QUOTES, "");
}

function symbolKey(symbol: ExtractedSymbol): string {
  return `${symbol.name}:${symbol.kind}:${symbol.line}`;
}

function dependencyKey(dependency: ExtractedDependency): string {
  return `${dependency.specifier}:${dependency.line}`;
}

function addUniqueSymbol(symbols: ExtractedSymbol[], symbol: ExtractedSymbol): void {
  const key = symbolKey(symbol);
  if (!symbols.some((existing) => symbolKey(existing) === key)) symbols.push(symbol);
}

function addUniqueDependency(dependencies: ExtractedDependency[], dependency: ExtractedDependency): void {
  const key = dependencyKey(dependency);
  if (!dependencies.some((existing) => dependencyKey(existing) === key)) dependencies.push(dependency);
}

function nodeName(node: Node): string | undefined {
  const name = node.childForFieldName("name");
  return name?.text;
}

function variableDeclarationKind(node: Node): SymbolKind {
  const declarationText = node.text.trimStart();
  return declarationText.startsWith("const") ? "const" : "variable";
}

function variableDeclaratorName(node: Node): string | undefined {
  const name = node.childForFieldName("name");
  if (!name || name.type !== "identifier") return undefined;
  return name.text;
}

function symbolsFromDeclaration(node: Node, exported: boolean): ExtractedSymbol[] {
  const declarationTypes: Record<string, SymbolKind> = {
    class_declaration: "class",
    enum_declaration: "enum",
    function_declaration: "function",
    generator_function_declaration: "function",
    interface_declaration: "interface",
    type_alias_declaration: "type",
  };
  const kind = declarationTypes[node.type];
  if (kind) {
    const name = nodeName(node);
    return name ? [{ name, kind, line: lineForNode(node), signature: normalizeSignature(node.text), exported }] : [];
  }

  if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
    const variableKind = variableDeclarationKind(node);
    return node.namedChildren
      .filter((child) => child.type === "variable_declarator")
      .flatMap((declarator) => {
        const name = variableDeclaratorName(declarator);
        return name
          ? [{ name, kind: variableKind, line: lineForNode(declarator), signature: normalizeSignature(node.text), exported }]
          : [];
      });
  }

  return [];
}

function sourceDependency(node: Node): ExtractedDependency | undefined {
  const source = node.childForFieldName("source");
  return source ? { specifier: cleanStringLiteral(source.text), line: lineForNode(source) } : undefined;
}

function requireDependencies(node: Node): ExtractedDependency[] {
  const dependencies: ExtractedDependency[] = [];
  for (const call of node.descendantsOfType("call_expression")) {
    if (call.childForFieldName("function")?.text !== "require") continue;
    const argument = call.childForFieldName("arguments")?.namedChildren[0];
    if (!argument || argument.type !== "string") continue;
    dependencies.push({ specifier: cleanStringLiteral(argument.text), line: lineForNode(argument) });
  }
  return dependencies;
}

function declarationChildForExport(node: Node): Node | undefined {
  return node.namedChildren.find((child) =>
    [
      "class_declaration",
      "enum_declaration",
      "function_declaration",
      "generator_function_declaration",
      "interface_declaration",
      "lexical_declaration",
      "type_alias_declaration",
      "variable_declaration",
    ].includes(child.type),
  );
}

export function extractGraphFromTree(root: Node): ExtractedFileGraph {
  const symbols: ExtractedSymbol[] = [];
  const dependencies: ExtractedDependency[] = [];

  for (const child of root.namedChildren) {
    const dependency = child.type === "import_statement" || child.type === "export_statement" ? sourceDependency(child) : undefined;
    if (dependency) addUniqueDependency(dependencies, dependency);
    for (const requireDependency of requireDependencies(child)) addUniqueDependency(dependencies, requireDependency);

    if (child.type === "export_statement") {
      const declaration = declarationChildForExport(child);
      for (const symbol of declaration ? symbolsFromDeclaration(declaration, true) : []) addUniqueSymbol(symbols, symbol);
      continue;
    }

    for (const symbol of symbolsFromDeclaration(child, false)) addUniqueSymbol(symbols, symbol);
  }

  return { symbols, dependencies };
}

export async function createExperimentalTreeSitterStructureExtractor(
  options: ExperimentalTreeSitterExtractorOptions = {},
): Promise<ExperimentalTreeSitterExtractor> {
  let runtime: LoadedTreeSitterRuntime | null;
  try {
    runtime = await loadTreeSitterRuntime(options);
  } catch {
    return fallbackExtractor("grammar_load_failed");
  }
  if (!runtime) return fallbackExtractor("missing_grammar_dir");
  const loadedLanguages = Object.keys(runtime.languages);
  if (loadedLanguages.length === 0) return fallbackExtractor("missing_grammar_wasm");

  return {
    name: "tree-sitter-experimental",
    experimental: true,
    parserAvailable: true,
    loadedLanguages,
    extractFileGraph(relativePath, content) {
      const languageKey = languageForPath(relativePath);
      const language = languageKey ? runtime.languages[languageKey] : undefined;
      if (!language) return regexStructureExtractor.extractFileGraph(relativePath, content);
      try {
        runtime.parser.setLanguage(language);
        const tree = runtime.parser.parse(content);
        if (!tree || tree.rootNode.hasError) return regexStructureExtractor.extractFileGraph(relativePath, content);
        return extractGraphFromTree(tree.rootNode);
      } catch {
        return regexStructureExtractor.extractFileGraph(relativePath, content);
      }
    },
  };
}
