#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateLatestMacYml } from "./generate-latest-mac-yml.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");

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

function findLocal(version, kind) {
  const patterns = {
    zip: new RegExp(`^Story[.\\s-]Studio-${version}-arm64-mac\\.zip$`),
    dmg: new RegExp(`^Story[.\\s-]Studio-${version}-arm64\\.dmg$`),
    zipBlockmap: new RegExp(`^Story[.\\s-]Studio-${version}-arm64-mac\\.zip\\.blockmap$`),
    dmgBlockmap: new RegExp(`^Story[.\\s-]Studio-${version}-arm64\\.dmg\\.blockmap$`),
  };
  const name = fs.readdirSync(releaseDir).find((entry) => patterns[kind].test(entry));
  if (!name) {
    throw new Error(`Missing release artifact (${kind}) for ${version} in release/`);
  }
  return path.join(releaseDir, name);
}

const version = readVersion();
const tag = `v${version}`;

if (!process.env.GH_TOKEN) {
  console.error("GH_TOKEN is required. Run: GH_TOKEN=$(gh auth token) npm run dist:publish");
  process.exit(1);
}

run("npm", ["run", "build"]);
// Build locally only — electron-builder's GitHub publisher rewrites spaces to
// dashes (Story-Studio-*), which breaks latest-mac.yml (must use Story.Studio-*).
run("npx", ["electron-builder", "--mac", "--publish", "never"]);

const ymlPath = path.join(releaseDir, "latest-mac.yml");
console.log("Regenerating latest-mac.yml from release artifacts");
fs.writeFileSync(ymlPath, generateLatestMacYml(version));

const artifacts = [
  findLocal(version, "zip"),
  findLocal(version, "dmg"),
  findLocal(version, "zipBlockmap"),
  findLocal(version, "dmgBlockmap"),
  ymlPath,
];

const releaseExists =
  spawnSync("gh", ["release", "view", tag], { cwd: root, stdio: "ignore" }).status === 0;

if (!releaseExists) {
  run("gh", [
    "release",
    "create",
    tag,
    "--title",
    version,
    "--notes",
    `Story Studio ${version}`,
    "--draft",
  ]);
}

// Upload space-named local files; GitHub serves them as Story.Studio-* (spaces → dots).
run("gh", ["release", "upload", tag, ...artifacts, "--clobber"]);
run("gh", ["release", "edit", tag, "--draft=false", "--latest"]);

console.log(`Published ${tag}. Verify latest-mac.yml names/sizes against release assets.`);
