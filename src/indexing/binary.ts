import { TextDecoder } from "node:util";

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function isProbablyBinary(buffer: Uint8Array): boolean {
  if (buffer.length === 0) return false;
  if (buffer.includes(0)) return true;

  try {
    utf8Decoder.decode(buffer);
    return false;
  } catch {
    return true;
  }
}

