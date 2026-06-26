import * as fs from "fs";
import * as path from "path";
import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";
import { app, screen } from "../electron-api.js";

export interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

const DEFAULT_WIDTH = 1160;
const DEFAULT_HEIGHT = 780;
const MIN_WIDTH = 860;
const MIN_HEIGHT = 560;

const STATE_FILE = () => path.join(app.getPath("userData"), "window-state.json");

export function getDefaultMainWindowSizeOptions(): Pick<
  BrowserWindowConstructorOptions,
  "width" | "height" | "minWidth" | "minHeight"
> {
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
  };
}

function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const parsed = raw as Partial<WindowState>;
  if (typeof parsed.width !== "number" || typeof parsed.height !== "number") {
    return null;
  }
  return {
    width: parsed.width,
    height: parsed.height,
    x: typeof parsed.x === "number" ? parsed.x : undefined,
    y: typeof parsed.y === "number" ? parsed.y : undefined,
    isMaximized: parsed.isMaximized === true,
  };
}

function loadWindowState(): WindowState | null {
  try {
    const data = fs.readFileSync(STATE_FILE(), "utf-8");
    return parseWindowState(JSON.parse(data));
  } catch {
    return null;
  }
}

function isBoundsVisibleOnScreen(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function ensureBoundsOnScreen(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state;
  if (isBoundsVisibleOnScreen({ x: state.x, y: state.y, width: state.width, height: state.height })) {
    return state;
  }
  return { ...state, x: undefined, y: undefined };
}

export function getMainWindowStateOptions(): {
  options: Pick<BrowserWindowConstructorOptions, "width" | "height" | "x" | "y" | "minWidth" | "minHeight">;
  isMaximized: boolean;
} {
  const defaults = getDefaultMainWindowSizeOptions();
  const saved = loadWindowState();
  if (!saved) {
    return { options: defaults, isMaximized: false };
  }

  const validated = ensureBoundsOnScreen(saved);
  return {
    options: {
      ...defaults,
      width: Math.max(defaults.minWidth!, validated.width),
      height: Math.max(defaults.minHeight!, validated.height),
      ...(validated.x !== undefined && validated.y !== undefined
        ? { x: validated.x, y: validated.y }
        : {}),
    },
    isMaximized: validated.isMaximized ?? false,
  };
}

function captureWindowState(win: BrowserWindow): WindowState {
  const bounds = win.getNormalBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized(),
  };
}

function persistWindowState(state: WindowState): void {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2), "utf-8");
  } catch {
    // Window geometry is non-critical.
  }
}

export function saveMainWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  persistWindowState(captureWindowState(win));
}

export function trackMainWindowState(win: BrowserWindow): void {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveMainWindowState(win);
    }, 400);
  };

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveMainWindowState(win);
  });
}
