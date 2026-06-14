#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

function printHelp() {
  console.log(`Usage: node scripts/release-notes.mjs <x.y.z>

Prints the CHANGELOG.md section for a released version.
`);
}

function headingFor(version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^## \\[${escapedVersion}\\][^\\n]*\\n`, "m");
}

function extractReleaseNotes(version) {
  const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  const heading = headingFor(version);
  const match = heading.exec(changelog);
  if (!match) throw new Error(`CHANGELOG.md does not contain a section for ${version}`);

  const start = match.index + match[0].length;
  const rest = changelog.slice(start);
  const nextHeading = /^## \[/m.exec(rest);
  const body = (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
  if (!body) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return body.replace(/^### /gm, "## ");
}

function main() {
  const version = process.argv[2];
  if (!version || version === "--help" || version === "-h") {
    printHelp();
    process.exit(version ? 0 : 1);
  }
  process.stdout.write(`${extractReleaseNotes(version)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
