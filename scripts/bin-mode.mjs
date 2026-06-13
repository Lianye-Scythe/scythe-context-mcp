#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] || "ensure";
const binPath = path.resolve("dist/index.js");

if (!fs.existsSync(binPath)) {
  console.error(`Missing bin entrypoint: ${binPath}`);
  process.exit(1);
}

if (mode === "ensure") {
  fs.chmodSync(binPath, 0o755);
  process.exit(0);
}

if (mode === "check") {
  const stat = fs.statSync(binPath);
  if ((stat.mode & 0o111) === 0) {
    console.error(`Bin entrypoint is not executable: ${binPath}`);
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown mode: ${mode}`);
process.exit(1);
