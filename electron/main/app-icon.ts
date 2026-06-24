import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { app, nativeImage } from "./electron-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function findProjectRoot(): string | null {
  const starts = [process.cwd(), __dirname];

  for (const start of starts) {
    let dir = start;
    while (true) {
      const packageJsonPath = path.join(dir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { name?: string };
          if (pkg.name === "story-studio") {
            return dir;
          }
        } catch {
          // keep walking
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return null;
}

function iconCandidates(): string[] {
  const root = findProjectRoot();
  if (!root) return [];

  const buildIcons = [
    path.join(root, "build", "icon.icns"),
    path.join(root, "build", "icon.png"),
  ];

  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, "icon.icns"),
      path.join(process.resourcesPath, "icon.png"),
      ...buildIcons,
    ];
  }

  return buildIcons;
}

export function resolveAppIconPath(): string | null {
  for (const candidate of iconCandidates()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getAppIcon(): Electron.NativeImage | undefined {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return undefined;

  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? undefined : image;
}

export function applyAppBranding(): void {
  app.setName("Story Studio");

  const iconPath = resolveAppIconPath();
  const icon = getAppIcon();

  if (iconPath) {
    app.setAboutPanelOptions({
      applicationName: "Story Studio",
      applicationVersion: app.getVersion(),
      iconPath,
    });
  }

  if (!icon || process.platform !== "darwin" || !app.isReady() || !app.dock) {
    return;
  }

  app.dock.setIcon(icon);
}
