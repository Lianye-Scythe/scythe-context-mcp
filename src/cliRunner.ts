import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "./config.js";
import { CLI_OPERATIONS, type CliCommand } from "./cli.js";
import { createOperations } from "./core/operations.js";

type OperationCommand = Extract<CliCommand, { kind: "operation" }>;
type Payload = Record<string, unknown>;

function records(value: unknown): Payload[] {
  return Array.isArray(value) ? value as Payload[] : [];
}

function location(result: Payload): string {
  const file = result.path ?? result.sourcePath;
  return `${file}${result.startLine === undefined ? "" : `:${result.startLine}-${result.endLine}`}`;
}

function failed(payload: Payload): boolean {
  return ["index_missing", "embedding_unavailable", "embedding_probe_failed", "error"].includes(String(payload.status));
}

export function renderCliResult(command: OperationCommand, payload: Payload): string {
  if (command.json || (command.command !== "search" && command.command !== "context") || failed(payload)) {
    return JSON.stringify(payload, null, 2);
  }
  const lines = [`Project: ${payload.projectPath}`, `Mode: ${payload.effectiveMode}`];
  if (payload.fallback) {
    const fallback = payload.fallback as Payload;
    const error = fallback.error as Payload;
    lines.push(`Fallback: ${fallback.fromMode} -> ${fallback.toMode}: ${error.message}`);
  }
  const results = records(payload.primaryResults ?? payload.results);
  for (const result of results) {
    lines.push(location(result));
    if (result.matchReason) lines.push(`  ${result.matchReason}`);
    if (result.snippet) lines.push(String(result.snippet));
    if (result.snippetTruncated) lines.push("  [snippet truncated]");
  }
  if (results.length === 0) lines.push("No matches.");
  for (const related of records(payload.relatedFiles)) lines.push(`Related: ${related.sourcePath} (${related.role})`);
  for (const snippet of records(payload.relatedSnippets)) {
    lines.push(`Related snippet: ${location(snippet)}`, String(snippet.snippet));
    if (snippet.snippetTruncated) lines.push("  [snippet truncated]");
  }
  for (const suggested of (payload.suggestedPaths as string[] | undefined) ?? []) lines.push(`Suggested: ${suggested}`);
  if (payload.suggestedPathsTruncated) lines.push(`Additional suggested paths omitted: ${payload.suggestedPathsTruncated}`);
  return lines.join("\n");
}

export async function runCliOperation(command: OperationCommand, config: AppConfig): Promise<{ text: string; exitCode: number }> {
  const operations = createOperations(config);
  const payload = await operations[CLI_OPERATIONS[command.command]].run(command.input);
  const exitCode = failed(payload) ? 1 : 0;
  if (command.output) {
    const outputPath = path.resolve(command.output);
    await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return {
      text: command.json ? JSON.stringify({ outputPath, status: payload.status, exitCode }) : `Saved JSON: ${outputPath}`,
      exitCode,
    };
  }
  return { text: renderCliResult(command, payload), exitCode };
}
