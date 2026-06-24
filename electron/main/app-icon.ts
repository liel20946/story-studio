import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { app, nativeImage } from "./electron-api.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function projectRootIconCandidates(): string[] {
  const root = path.join(__dirname, "..", "..");
  return [
    path.join(root, "build", "icon.icns"),
    path.join(root, "build", "icon.png"),
  ];
}

function packagedIconCandidates(): string[] {
  return [
    path.join(process.resourcesPath, "icon.icns"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(process.resourcesPath, "app-icon.icns"),
    path.join(process.resourcesPath, "app-icon.png"),
  ];
}

export function resolveAppIconPath(): string | null {
  const candidates = app.isPackaged ? packagedIconCandidates() : projectRootIconCandidates();

  for (const candidate of candidates) {
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

  if (!icon) return;

  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(icon);
  }
}
