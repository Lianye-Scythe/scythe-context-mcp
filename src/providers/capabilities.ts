import fs from "node:fs";
import path from "node:path";
import { sha256Hex } from "../indexing/hash.js";
import type { AppConfig } from "../config.js";

export type CapabilitySupport = "supported" | "unsupported" | "unknown";

export interface ProviderCapabilityKey {
  provider: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  authMode: AppConfig["gemini"]["authMode"];
}

export interface ProviderCapabilityRecord extends ProviderCapabilityKey {
  key: string;
  baseUrlHash: string;
  batchEmbedding: CapabilitySupport;
  outputDimensionality: CapabilitySupport;
  lastProbeAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastErrorType?: string;
  lastHttpStatus?: number;
  lastRetryable?: boolean;
}

export type ProviderCapabilityUpdate = Partial<
  Pick<
    ProviderCapabilityRecord,
    | "batchEmbedding"
    | "outputDimensionality"
    | "lastProbeAt"
    | "lastSuccessAt"
    | "lastFailureAt"
    | "lastErrorType"
    | "lastHttpStatus"
    | "lastRetryable"
  >
>;

interface ProviderCapabilityFile {
  version: 1;
  records: ProviderCapabilityRecord[];
}

export function providerCapabilitiesPath(indexPath: string): string {
  return path.join(indexPath, "provider-capabilities.json");
}

export function providerCapabilityKey(input: ProviderCapabilityKey): string {
  return [
    input.provider,
    sha256Hex(input.baseUrl),
    input.model,
    String(input.dimensions),
    input.authMode,
  ].join(":");
}

function normalizeRecord(input: ProviderCapabilityRecord): ProviderCapabilityRecord {
  return {
    ...input,
    key: providerCapabilityKey(input),
    baseUrlHash: sha256Hex(input.baseUrl),
  };
}

function emptyFile(): ProviderCapabilityFile {
  return { version: 1, records: [] };
}

export function readProviderCapabilities(indexPath: string): ProviderCapabilityRecord[] {
  const filePath = providerCapabilitiesPath(indexPath);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ProviderCapabilityFile>;
    if (parsed.version !== 1 || !Array.isArray(parsed.records)) return [];
    return parsed.records.map((record) => normalizeRecord(record));
  } catch {
    return [];
  }
}

export function findProviderCapability(
  indexPath: string,
  key: ProviderCapabilityKey,
): ProviderCapabilityRecord | undefined {
  const recordKey = providerCapabilityKey(key);
  return readProviderCapabilities(indexPath).find((record) => record.key === recordKey);
}

export function writeProviderCapability(indexPath: string, record: ProviderCapabilityRecord): ProviderCapabilityRecord {
  fs.mkdirSync(indexPath, { recursive: true });
  const filePath = providerCapabilitiesPath(indexPath);
  const data: ProviderCapabilityFile = fs.existsSync(filePath)
    ? (() => {
        try {
          const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<ProviderCapabilityFile>;
          return parsed.version === 1 && Array.isArray(parsed.records)
            ? { version: 1, records: parsed.records }
            : emptyFile();
        } catch {
          return emptyFile();
        }
      })()
    : emptyFile();

  const normalized = normalizeRecord(record);
  const records = data.records.filter((item) => normalizeRecord(item).key !== normalized.key);
  records.push(normalized);
  records.sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model) || a.key.localeCompare(b.key));
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, records }, null, 2)}\n`);
  return normalized;
}

export function updateProviderCapability(
  indexPath: string,
  key: ProviderCapabilityKey,
  update: ProviderCapabilityUpdate,
): ProviderCapabilityRecord {
  const existing = findProviderCapability(indexPath, key);
  return writeProviderCapability(indexPath, {
    ...key,
    key: providerCapabilityKey(key),
    baseUrlHash: sha256Hex(key.baseUrl),
    batchEmbedding: existing?.batchEmbedding ?? "unknown",
    outputDimensionality: existing?.outputDimensionality ?? "unknown",
    ...existing,
    ...update,
  });
}

export function providerCapabilityInput(options: {
  provider: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  authMode: AppConfig["gemini"]["authMode"];
}): ProviderCapabilityKey {
  return {
    provider: options.provider,
    baseUrl: options.baseUrl,
    model: options.model,
    dimensions: options.dimensions,
    authMode: options.authMode,
  };
}
