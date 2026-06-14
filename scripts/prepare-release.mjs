#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

function printHelp() {
  console.log(`Usage: npm run release:prepare -- <patch|minor|major|x.y.z>

Prepares a release commit by updating package.json, package-lock.json, and CHANGELOG.md.
It does not commit, tag, push, publish to npm, or create a GitHub Release.
`);
}

function readPackageVersion() {
  return JSON.parse(fs.readFileSync("package.json", "utf8")).version;
}

function assertCleanWorktree() {
  const status = execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim();
  if (status) {
    throw new Error("Release preparation requires a clean worktree. Commit or stash current changes first.");
  }
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid semantic version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersion(current, target) {
  if (/^\d+\.\d+\.\d+$/.test(target)) return target;
  const version = parseVersion(current);
  if (target === "patch") return `${version.major}.${version.minor}.${version.patch + 1}`;
  if (target === "minor") return `${version.major}.${version.minor + 1}.0`;
  if (target === "major") return `${version.major + 1}.0.0`;
  throw new Error("Release target must be one of: patch, minor, major, or x.y.z");
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function updateChangelog(version) {
  const changelogPath = "CHANGELOG.md";
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const marker = "## [Unreleased]";
  const markerIndex = changelog.indexOf(marker);
  if (markerIndex < 0) throw new Error("CHANGELOG.md must contain an ## [Unreleased] section");

  const nextHeader = `## [${version}] - ${todayUtc()}`;
  if (changelog.includes(nextHeader)) {
    throw new Error(`CHANGELOG.md already contains ${nextHeader}`);
  }

  const updated = changelog.replace(marker, `${marker}\n\n${nextHeader}`);
  fs.writeFileSync(changelogPath, updated);
}

function updateCliVersion(version) {
  const cliPath = "src/cli.ts";
  const cli = fs.readFileSync(cliPath, "utf8");
  const updated = cli.replace(
    /^export const PACKAGE_VERSION = "\d+\.\d+\.\d+";/m,
    `export const PACKAGE_VERSION = "${version}";`,
  );
  if (updated === cli) {
    throw new Error(`${cliPath} must contain an export const PACKAGE_VERSION declaration`);
  }
  fs.writeFileSync(cliPath, updated);
}

function main() {
  const target = process.argv[2];
  if (!target || target === "--help" || target === "-h") {
    printHelp();
    process.exit(target ? 0 : 1);
  }

  assertCleanWorktree();
  const current = readPackageVersion();
  const version = nextVersion(current, target);
  if (version === current) throw new Error(`package.json is already at ${version}`);

  execFileSync("npm", ["version", version, "--no-git-tag-version"], { stdio: "inherit" });
  updateCliVersion(version);
  updateChangelog(version);

  console.log(`\nPrepared release ${version}. Next steps:`);
  console.log("  npm run verify");
  console.log("  git add package.json package-lock.json src/cli.ts CHANGELOG.md");
  console.log(`  git commit -m "Release ${version}"`);
  console.log("  git push origin main");
  console.log(`  git tag v${version}`);
  console.log(`  git push origin v${version}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
