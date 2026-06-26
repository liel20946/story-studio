#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

if (process.platform !== "darwin") {
  process.exit(0);
}

const APP_NAME = "Story Studio";
const srcApp = path.join(root, "node_modules/electron/dist/Electron.app");
const devDir = path.join(root, "build/dev");
const devApp = path.join(devDir, `${APP_NAME}.app`);
const legacyDevApp = path.join(devDir, "Electron.app");
const iconSrc = path.join(root, "build/icon.icns");
const iconDest = path.join(devApp, "Contents/Resources/electron.icns");
const plist = path.join(devApp, "Contents/Info.plist");
const stampFile = path.join(devDir, ".stamp");

if (!fs.existsSync(srcApp)) {
  console.error("Electron.app not found. Run npm install first.");
  process.exit(1);
}

if (!fs.existsSync(iconSrc)) {
  console.error("build/icon.icns not found.");
  process.exit(1);
}

const electronVersion = JSON.parse(
  fs.readFileSync(path.join(root, "node_modules/electron/package.json"), "utf8"),
).version;
const stamp = `${electronVersion}-${fs.statSync(iconSrc).mtimeMs}-v4`;

if (fs.existsSync(stampFile) && fs.readFileSync(stampFile, "utf8") === stamp && fs.existsSync(devApp)) {
  process.exit(0);
}

fs.rmSync(devApp, { recursive: true, force: true });
fs.rmSync(legacyDevApp, { recursive: true, force: true });
fs.mkdirSync(devDir, { recursive: true });
execSync(`cp -R "${srcApp}" "${devApp}"`);
fs.copyFileSync(iconSrc, iconDest);

const executableDir = path.join(devApp, "Contents/MacOS");
const legacyExecutable = path.join(executableDir, "Electron");
const brandedExecutable = path.join(executableDir, APP_NAME);
fs.renameSync(legacyExecutable, brandedExecutable);

execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName ${APP_NAME}" "${plist}"`);
execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName ${APP_NAME}" "${plist}"`);
execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable ${APP_NAME}" "${plist}"`);
execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.storystudio.app" "${plist}"`);

const skillsSrc = path.join(root, "resources/skills");
const skillsDest = path.join(devApp, "Contents/Resources/skills");
if (fs.existsSync(skillsSrc)) {
  fs.cpSync(skillsSrc, skillsDest, { recursive: true });
}

fs.writeFileSync(stampFile, stamp);
console.log(`Prepared ${APP_NAME} dev app bundle`);
