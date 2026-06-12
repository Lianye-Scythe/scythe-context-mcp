import { sha256Hex } from "./hash.js";
import type { IndexingLimits, TextChunk } from "./types.js";

const MAX_LINE_EXTENSION_CHARS = 240;

function lineEndIndex(text: string, startIndex: number): number {
  const nextNewline = text.indexOf("\n", startIndex);
  return nextNewline === -1 ? text.length : nextNewline + 1;
}

function chooseChunkEnd(text: string, targetEnd: number): number {
  if (targetEnd >= text.length) return text.length;
  const nextNewline = text.indexOf("\n", targetEnd);
  if (nextNewline !== -1 && nextNewline - targetEnd <= MAX_LINE_EXTENSION_CHARS) {
    return nextNewline + 1;
  }
  return targetEnd;
}

function countNewlines(text: string): number {
  return text.length === 0 ? 0 : (text.match(/\n/g) || []).length;
}

function findOverlapStart(text: string, chunkStart: number, chunkEnd: number, overlapChars: number): number {
  if (overlapChars <= 0) return chunkEnd;
  const approximateStart = Math.max(chunkStart, chunkEnd - overlapChars);
  const nextLineStart = lineEndIndex(text, approximateStart);
  return nextLineStart > chunkEnd ? approximateStart : nextLineStart;
}

export function chunkText(
  relativePath: string,
  text: string,
  limits: Pick<IndexingLimits, "targetChunkChars" | "chunkOverlapChars" | "maxChunksPerFile">,
): TextChunk[] {
  if (text.length === 0) {
    return [
      {
        relativePath,
        startLine: 1,
        endLine: 1,
        text: "",
        hash: sha256Hex(`${relativePath}\n1\n1\n`),
      },
    ];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let startLine = 1;

  while (start < text.length && chunks.length < limits.maxChunksPerFile) {
    const targetEnd = Math.min(text.length, start + limits.targetChunkChars);
    let end = chooseChunkEnd(text, targetEnd);
    if (end <= start) end = Math.min(text.length, start + limits.targetChunkChars);

    const chunkTextValue = text.slice(start, end);
    const lineSpan = Math.max(1, countNewlines(chunkTextValue) + (chunkTextValue.endsWith("\n") ? 0 : 1));
    const endLine = startLine + lineSpan - 1;

    chunks.push({
      relativePath,
      startLine,
      endLine,
      text: chunkTextValue,
      hash: sha256Hex(`${relativePath}\n${startLine}\n${endLine}\n${chunkTextValue}`),
    });

    if (end >= text.length) break;

    const nextStart = findOverlapStart(text, start, end, limits.chunkOverlapChars);
    const advancedStart = nextStart <= start ? end : nextStart;
    startLine += countNewlines(text.slice(start, advancedStart));
    start = advancedStart;
  }

  return chunks;
}
