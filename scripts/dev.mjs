#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

function runNodeScript(scriptName) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, scriptName)], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptName} exited with code ${code}`));
    });
  });
}

function resolveElectronExecPath() {
  if (process.platform === "darwin") {
    const branded = path.join(root, "build/dev/Story Studio.app/Contents/MacOS/Story Studio");
    if (fs.existsSync(branded)) {
      return branded;
    }
  }

  const electronModulePath = path.dirname(require.resolve("electron"));
  const relativePath = fs.readFileSync(path.join(electronModulePath, "path.txt"), "utf8").trim();
  return path.join(electronModulePath, "dist", relativePath);
}

await runNodeScript("prepare-dev-app.mjs");

const execPath = resolveElectronExecPath();
console.log(`Using Electron binary: ${execPath}`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.ELECTRON_EXEC_PATH = execPath;

const electronViteBin = path.join(root, "node_modules/.bin/electron-vite");
const child = spawn(electronViteBin, ["dev"], {
  cwd: root,
  stdio: "inherit",
  env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
