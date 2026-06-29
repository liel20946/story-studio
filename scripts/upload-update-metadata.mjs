#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateLatestMacYml } from "./generate-latest-mac-yml.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ymlPath = path.join(root, "release", "latest-mac.yml");

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

const version = process.argv[2] ?? readVersion();
const tag = version.startsWith("v") ? version : `v${version}`;

if (!fs.existsSync(ymlPath)) {
  console.log("latest-mac.yml not found in release/; generating from local artifacts");
  fs.mkdirSync(path.join(root, "release"), { recursive: true });
  fs.writeFileSync(ymlPath, generateLatestMacYml(version.replace(/^v/, "")));
}

console.log(`Uploading latest-mac.yml to GitHub release ${tag}`);
const result = spawnSync("gh", ["release", "upload", tag, ymlPath, "--clobber"], {
  cwd: root,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Update metadata uploaded. Installed apps can now auto-update.");
