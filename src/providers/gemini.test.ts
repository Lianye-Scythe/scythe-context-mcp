import { describe, expect, it } from "vitest";
import { buildGeminiEndpoint, normalizeGeminiBaseUrl } from "./gemini.js";

describe("Gemini URL compatibility", () => {
  it.each([
    ["https://proxy.example.com", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1beta", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1beta/", "https://proxy.example.com/v1beta"],
    ["https://proxy.example.com/v1", "https://proxy.example.com/v1"],
    ["https://proxy.example.com/gemini", "https://proxy.example.com/gemini/v1beta"],
    ["https://proxy.example.com/gemini/v1beta/", "https://proxy.example.com/gemini/v1beta"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeGeminiBaseUrl(input)).toBe(expected);
  });

  it("builds embedding endpoints without duplicating v1beta or models prefixes", () => {
    expect(buildGeminiEndpoint("https://proxy.example.com/", "gemini-embedding-2", "embedContent").toString()).toBe(
      "https://proxy.example.com/v1beta/models/gemini-embedding-2:embedContent",
    );
    expect(buildGeminiEndpoint("https://proxy.example.com/v1beta/", "models/gemini-embedding-2", "batchEmbedContents").toString()).toBe(
      "https://proxy.example.com/v1beta/models/gemini-embedding-2:batchEmbedContents",
    );
  });
});
