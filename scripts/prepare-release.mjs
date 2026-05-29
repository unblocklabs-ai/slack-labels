#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const VERSION_FILES = ["package.json", "openclaw.plugin.json"];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function runGit(args) {
  execFileSync("git", args, { stdio: "inherit" });
}

function updateVersions(version) {
  for (const file of VERSION_FILES) {
    const json = readJson(file);
    json.version = version;
    writeJson(file, json);
  }

  if (existsSync("package-lock.json")) {
    const lock = readJson("package-lock.json");
    lock.version = version;
    if (lock.packages?.[""]) {
      lock.packages[""].version = version;
    }
    writeJson("package-lock.json", lock);
  }
}

function release(version) {
  if (!VERSION_RE.test(version)) {
    throw new Error(`Version must match X.Y.Z, got ${version}`);
  }

  const tag = `v${version}`;
  if (git(["tag", "--list", tag])) {
    throw new Error(`Git tag ${tag} already exists`);
  }

  updateVersions(version);

  const filesToStage = ["package.json", "openclaw.plugin.json"];
  if (existsSync("package-lock.json")) {
    filesToStage.push("package-lock.json");
  }

  runGit(["add", ...filesToStage]);
  runGit(["commit", "-m", `chore: release ${tag}`]);
  runGit(["tag", "-a", tag, "-m", tag]);

  console.log(`Created release commit and tag ${tag}`);
}

const [version, ...extraArgs] = process.argv.slice(2);

try {
  if (!version) {
    throw new Error("Missing required release version. Use: npm run release:prepare -- X.Y.Z");
  }

  if (extraArgs.length > 0) {
    throw new Error("Unexpected extra arguments. Use: npm run release:prepare -- X.Y.Z");
  }

  release(version);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
