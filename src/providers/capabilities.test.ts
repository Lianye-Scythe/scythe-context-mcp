import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findProviderCapability,
  providerCapabilitiesPath,
  providerCapabilityInput,
  readProviderCapabilities,
  updateProviderCapability,
} from "./capabilities.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scythe-context-capabilities-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

const key = providerCapabilityInput({
  provider: "gemini",
  baseUrl: "https://proxy.example.com/v1beta",
  model: "gemini-embedding-2",
  dimensions: 1536,
  authMode: "bearer",
});

describe("provider capability cache", () => {
  it("writes and finds capability records without storing API keys", async () => {
    updateProviderCapability(tempDir, key, {
      batchEmbedding: "unsupported",
      outputDimensionality: "supported",
      lastSuccessAt: "2026-06-14T00:00:00.000Z",
    });

    const found = findProviderCapability(tempDir, key);
    expect(found).toEqual(
      expect.objectContaining({
        provider: "gemini",
        model: "gemini-embedding-2",
        dimensions: 1536,
        authMode: "bearer",
        batchEmbedding: "unsupported",
        outputDimensionality: "supported",
      }),
    );
    expect(found?.baseUrlHash).toHaveLength(64);

    const serialized = await fs.readFile(providerCapabilitiesPath(tempDir), "utf8");
    expect(serialized).toContain("https://proxy.example.com/v1beta");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("apiKey");
  });

  it("merges updates with an existing record", () => {
    updateProviderCapability(tempDir, key, { batchEmbedding: "unsupported" });
    updateProviderCapability(tempDir, key, { outputDimensionality: "supported" });

    const records = readProviderCapabilities(tempDir);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(
      expect.objectContaining({
        batchEmbedding: "unsupported",
        outputDimensionality: "supported",
      }),
    );
  });

  it("ignores missing or corrupt cache files", async () => {
    expect(readProviderCapabilities(tempDir)).toEqual([]);

    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(providerCapabilitiesPath(tempDir), "{bad json");

    expect(readProviderCapabilities(tempDir)).toEqual([]);
  });
});
