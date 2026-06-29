#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateLatestMacYml } from "./generate-latest-mac-yml.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

run("npm", ["run", "build"]);
run("npx", ["electron-builder", "--publish", "always"]);

const version = readVersion();
const ymlPath = path.join(root, "release", "latest-mac.yml");

if (!fs.existsSync(ymlPath)) {
  console.warn("electron-builder did not write latest-mac.yml; generating it from release artifacts");
  fs.writeFileSync(ymlPath, generateLatestMacYml(version));
}

run("node", ["scripts/upload-update-metadata.mjs"]);
