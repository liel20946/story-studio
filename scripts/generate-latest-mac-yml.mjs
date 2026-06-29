#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");

function sha512Base64(filePath) {
  const hash = crypto.createHash("sha512");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("base64");
}

function findArtifact(pattern) {
  return fs.readdirSync(releaseDir).find((name) => pattern.test(name));
}

function releaseAssetName(localName) {
  return localName.replace(/^Story Studio/, "Story.Studio");
}

export function generateLatestMacYml(version) {
  const zipName = findArtifact(new RegExp(`^Story[.\\s-]Studio-${version}-arm64-mac\\.zip$`));
  if (!zipName) {
    throw new Error(
      `No arm64 mac zip found in release/ for version ${version}. Run npm run dist first.`,
    );
  }

  const dmgName = findArtifact(new RegExp(`^Story[.\\s-]Studio-${version}-arm64\\.dmg$`));
  const zipPath = path.join(releaseDir, zipName);
  const zipSha512 = sha512Base64(zipPath);
  const zipSize = fs.statSync(zipPath).size;

  const files = [
    {
      url: releaseAssetName(zipName),
      sha512: zipSha512,
      size: zipSize,
    },
  ];

  if (dmgName) {
    const dmgPath = path.join(releaseDir, dmgName);
    files.push({
      url: releaseAssetName(dmgName),
      sha512: sha512Base64(dmgPath),
      size: fs.statSync(dmgPath).size,
    });
  }

  const lines = [
    `version: ${version}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`,
    ]),
    `path: ${releaseAssetName(zipName)}`,
    `sha512: ${zipSha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ];

  return lines.join("\n");
}

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.version;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const version = process.argv[2] ?? readVersion();
  const yml = generateLatestMacYml(version);
  const outputPath = path.join(releaseDir, "latest-mac.yml");
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(outputPath, yml);
  console.log(`Wrote ${outputPath}`);
}
