#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] || "ensure";
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const binPaths = [...new Set(Object.values(packageJson.bin))].map((file) => path.resolve(file));

if (mode !== "ensure" && mode !== "check") {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

for (const binPath of binPaths) {
  if (!fs.existsSync(binPath)) {
    console.error(`Missing bin entrypoint: ${binPath}`);
    process.exit(1);
  }

  if (mode === "ensure") {
    fs.chmodSync(binPath, 0o755);
  } else if ((fs.statSync(binPath).mode & 0o111) === 0) {
    console.error(`Bin entrypoint is not executable: ${binPath}`);
    process.exit(1);
  }
}
