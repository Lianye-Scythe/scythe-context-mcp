import type { SymbolKind } from "../symbolGraph.js";

export interface ExpectedFixtureSymbol {
  name: string;
  kind: SymbolKind;
  exported?: boolean;
}

export interface StructureExtractionFixture {
  id: string;
  relativePath: string;
  content: string;
  expectedSymbols: ExpectedFixtureSymbol[];
  expectedDependencies: string[];
  notes?: string;
}

export const structureExtractionFixtures: StructureExtractionFixture[] = [
  {
    id: "typescript-exports-and-imports",
    relativePath: "src/service.ts",
    content: `
import { readFile } from "node:fs/promises";
import type { AppConfig } from "../config";
export { helper } from "./helper";
export interface ServiceOptions { enabled: boolean }
export type ServiceName = string;
export class Service {}
export async function runService() {}
export const createService = () => new Service();
const localValue = readFile;
`,
    expectedSymbols: [
      { name: "ServiceOptions", kind: "interface", exported: true },
      { name: "ServiceName", kind: "type", exported: true },
      { name: "Service", kind: "class", exported: true },
      { name: "runService", kind: "function", exported: true },
      { name: "createService", kind: "const", exported: true },
      { name: "localValue", kind: "const", exported: false },
    ],
    expectedDependencies: ["node:fs/promises", "../config", "./helper"],
  },
  {
    id: "commonjs-require",
    relativePath: "src/legacy.cjs",
    content: `
const fs = require("node:fs");
const helper = require("./helper");
function runLegacy() {}
module.exports = { runLegacy };
`,
    expectedSymbols: [
      { name: "fs", kind: "const", exported: false },
      { name: "helper", kind: "const", exported: false },
      { name: "runLegacy", kind: "function", exported: false },
    ],
    expectedDependencies: ["node:fs", "./helper"],
  },
  {
    id: "nested-declarations",
    relativePath: "src/nested.ts",
    content: `
export function outer() {
  function inner() {
    return true;
  }
  return inner();
}
`,
    expectedSymbols: [{ name: "outer", kind: "function", exported: true }],
    expectedDependencies: [],
    notes: "A future tree-sitter extractor should avoid treating nested helpers as file-level symbols.",
  },
];

