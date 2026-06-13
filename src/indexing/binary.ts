import { TextDecoder } from "node:util";

export function isProbablyBinary(buffer: Uint8Array): boolean {
  if (buffer.length === 0) return false;
  if (buffer.includes(0)) return true;

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer, { stream: true });
    return false;
  } catch {
    return true;
  }
}
