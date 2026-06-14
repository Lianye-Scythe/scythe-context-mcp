import type { AppConfig } from "../config.js";
import { createExperimentalTreeSitterStructureExtractor } from "./experimental/treeSitterStructure.js";
import { regexStructureExtractor } from "./structureExtractor.js";
import type { CodeStructureExtractor } from "./structureExtractor.js";

export async function createConfiguredStructureExtractor(config: AppConfig["structure"]): Promise<CodeStructureExtractor> {
  if (config.extractorMode !== "tree-sitter") return regexStructureExtractor;
  return createExperimentalTreeSitterStructureExtractor({ grammarDir: config.treeSitterGrammarDir });
}
