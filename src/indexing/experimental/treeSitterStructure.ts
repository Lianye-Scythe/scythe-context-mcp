import { regexStructureExtractor } from "../structureExtractor.js";
import type { CodeStructureExtractor } from "../structureExtractor.js";

const TREE_SITTER_CANDIDATE_EXTENSIONS = /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/;

export interface ExperimentalTreeSitterExtractorOptions {
  enabled?: boolean;
}

export interface ExperimentalTreeSitterExtractor extends CodeStructureExtractor {
  readonly experimental: true;
  readonly parserAvailable: false;
}

export function isTreeSitterCandidatePath(relativePath: string): boolean {
  return TREE_SITTER_CANDIDATE_EXTENSIONS.test(relativePath);
}

export function createExperimentalTreeSitterStructureExtractor(
  _options: ExperimentalTreeSitterExtractorOptions = {},
): ExperimentalTreeSitterExtractor {
  return {
    name: "tree-sitter-experimental",
    experimental: true,
    parserAvailable: false,
    extractFileGraph(relativePath, content) {
      return regexStructureExtractor.extractFileGraph(relativePath, content);
    },
  };
}
