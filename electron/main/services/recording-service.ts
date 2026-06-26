import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "../electron-api.js";
import { broadcast as ipcBroadcast } from "../broadcast.js";
import type { RecordingProgress, RecordingAvailability } from "./contract-types.js";
import { resolveCodexBinary } from "./codex-runner.js";
import { createDraftDir, discardDraftDir, saveDraftToLibrary, listStories } from "./stories-service.js";
import { convertRecordingWithCodex } from "./recording-convert-service.js";
import { formatRecordingFailure } from "./recording-errors.js";
import { siteSlugFromUrl, parseCompositeName } from "./bowser-stories-service.js";
import { getRunsDir } from "./paths.js";
import { listRuns, buildLastRunMap } from "./run-service.js";

const execFileAsync = promisify(execFile);

let _recordingProcess: ChildProcess | null = null;
let _recordingAborted = false;

const CHROMIUM_EXECUTABLE_SUFFIX: Record<string, string[]> = {
  darwin: ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
  linux: ["chrome-linux", "chrome"],
  win32: ["chrome-win", "chrome.exe"],
};

function getPlaywrightBrowsersCacheDir(): string {
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (envPath === "0") {
    return path.join(process.cwd(), "node_modules", "playwright-core", ".local-browsers");
  }
  if (envPath) return envPath;
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  }
  if (process.platform === "linux") {
    const xdg = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache");
    return path.join(xdg, "ms-playwright");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "ms-playwright");
  }
  return path.join(os.homedir(), ".cache", "ms-playwright");
}

const SYSTEM_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  win32: [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
  ],
};

interface RecordingBrowser {
  ready: boolean;
  /** Playwright `--channel` when using an installed Chrome/Edge instead of bundled Chromium. */
  channel?: string;
}

async function isPlaywrightChromiumInstalled(): Promise<boolean> {
  const suffix = CHROMIUM_EXECUTABLE_SUFFIX[process.platform];
  if (!suffix) return false;

  const cacheDir = getPlaywrightBrowsersCacheDir();
  try {
    const entries = await fs.readdir(cacheDir);
    const chromiumDirs = entries.filter((entry) => /^chromium-\d+/.test(entry));
    for (const chromiumDir of chromiumDirs) {
      const execPath = path.join(cacheDir, chromiumDir, ...suffix);
      try {
        await fs.access(execPath);
        return true;
      } catch {
        // try next revision directory
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function getSystemChromePath(): Promise<string | null> {
  const candidates = SYSTEM_CHROME_PATHS[process.platform] ?? [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next install location
    }
  }
  return null;
}

async function resolveRecordingBrowser(): Promise<RecordingBrowser> {
  if (await isPlaywrightChromiumInstalled()) {
    return { ready: true };
  }
  if (await getSystemChromePath()) {
    return { ready: true, channel: "chrome" };
  }
  return { ready: false };
}

function findPlaywrightCli(): string | null {
  const candidates = [
    path.join(process.cwd(), "node_modules", "playwright", "cli.js"),
    path.join(app.getAppPath(), "node_modules", "playwright", "cli.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

interface PlaywrightInvocation {
  command: string;
  prefixArgs: string[];
  useElectronAsNode: boolean;
}

function resolvePlaywrightInvocation(): PlaywrightInvocation {
  const cli = findPlaywrightCli();
  if (cli) {
    return {
      command: process.execPath,
      prefixArgs: [cli],
      useElectronAsNode: true,
    };
  }
  return {
    command: "npx",
    prefixArgs: ["playwright"],
    useElectronAsNode: false,
  };
}

function buildEnv(opts?: { electronAsNode?: boolean }): NodeJS.ProcessEnv {
  const extraPath = `/opt/homebrew/bin:/usr/local/bin:${path.dirname(process.execPath)}`;
  const existingPath = process.env.PATH ?? "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: os.homedir(),
    PATH: `${extraPath}:${existingPath}`,
  };
  if (opts?.electronAsNode) {
    env.ELECTRON_RUN_AS_NODE = "1";
  }
  return env;
}

function broadcast(progress: RecordingProgress): void {
  ipcBroadcast("recording:progress", progress);
  console.log("[recording] progress", progress.phase, progress.message);
}

export async function checkRecordingAvailability(codexBinaryPath: string | null): Promise<RecordingAvailability> {
  let codexAvailable = false;
  let playwrightAvailable = false;
  let browserInstalled = false;

  try {
    await resolveCodexBinary(codexBinaryPath);
    codexAvailable = true;
  } catch {
    // not available
  }

  try {
    // Generous timeout: the first `npx playwright` after launch can be slow to
    // resolve (cold cache), which previously produced a false negative and made
    // the record dialog wrongly claim Chromium was missing.
    const playwright = resolvePlaywrightInvocation();
    const { stdout } = await execFileAsync(
      playwright.command,
      [...playwright.prefixArgs, "--version"],
      {
        env: buildEnv({ electronAsNode: playwright.useElectronAsNode }),
        timeout: 45_000,
        maxBuffer: 1024 * 64,
      },
    );
    playwrightAvailable = /\bVersion\b/i.test(stdout) || /\d+\.\d+\.\d+/.test(stdout);
  } catch {
    // not available
  }

  if (playwrightAvailable) {
    browserInstalled = (await resolveRecordingBrowser()).ready;
  }

  console.log("[recording] availability check", { codexAvailable, playwrightAvailable, browserInstalled });
  return { codexAvailable, playwrightAvailable, browserInstalled };
}

export async function installBrowser(): Promise<{ ok: boolean; error?: string }> {
  const playwright = resolvePlaywrightInvocation();
  const installArgs = [...playwright.prefixArgs, "install", "chromium"];
  console.log("[recording] installing chromium via", playwright.command, installArgs.join(" "));
  try {
    await execFileAsync(playwright.command, installArgs, {
      env: buildEnv({ electronAsNode: playwright.useElectronAsNode }),
      timeout: 5 * 60_000, // 5 minutes
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[recording] browser install failed", msg);
    return { ok: false, error: msg };
  }
}

export async function cancelRecording(): Promise<void> {
  if (_recordingProcess) {
    try {
      // SIGINT lets Playwright codegen flush its output file; SIGTERM often does not.
      _recordingProcess.kill("SIGINT");
    } catch {
      // ignore
    }
    _recordingProcess = null;
  }
}

export async function abortRecording(): Promise<void> {
  _recordingAborted = true;
  if (_recordingProcess) {
    try {
      _recordingProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
    _recordingProcess = null;
  }
}

function broadcastRecordingError(
  stage: "conversion" | "recording" | "start",
  err: unknown,
  fallbackMessage?: string,
): ReturnType<typeof formatRecordingFailure> {
  const failure = fallbackMessage
    ? formatRecordingFailure(stage, fallbackMessage)
    : formatRecordingFailure(stage, err);
  const message =
    failure.message.trim() === failure.title.trim()
      ? failure.detail?.trim() || failure.message
      : failure.message;
  broadcast({
    phase: "error",
    message,
    errorTitle: failure.title,
    detail: failure.detail,
  });
  return { ...failure, message };
}

function recordingFailureMessage(exitCode: number | null, stderr: string): string {
  const combined = stderr.trim();
  if (/executable doesn't exist/i.test(combined) || /npx playwright install/i.test(combined)) {
    return "Chromium is not installed. Click Install Chromium in the record dialog, then try again.";
  }
  if (combined) {
    return `Recording failed (exit ${exitCode ?? "?"}): ${combined}`;
  }
  return (
    "No script was generated. Perform at least one action in the browser, then click Save Recording."
  );
}

export async function startRecording(
  name: string,
  url: string,
  codexBinaryPath: string | null,
  overwriteStoryKey?: string,
): Promise<{
  ok: boolean;
  storyName?: string;
  draftId?: string;
  error?: string;
  errorTitle?: string;
  errorDetail?: string;
  cancelled?: boolean;
}> {
  _recordingAborted = false;
  const runsDir = getRunsDir();
  const ts = Date.now();
  const recScriptPath = path.join(runsDir, `.rec-${ts}.spec.ts`);

  broadcast({ phase: "starting", message: "Starting Playwright codegen…" });

  const recordingBrowser = await resolveRecordingBrowser();
  if (!recordingBrowser.ready) {
    const msg =
      "No browser available for recording. Install Chromium from the record dialog, or install Google Chrome.";
    broadcast({
      phase: "error",
      message: msg,
      errorTitle: "Recording unavailable",
    });
    return { ok: false, error: msg, errorTitle: "Recording unavailable" };
  }

  if (_recordingAborted) {
    return { ok: false, cancelled: true };
  }

  const codexBinary = await resolveCodexBinary(codexBinaryPath).catch(() => null);
  if (!codexBinary) {
    const msg = "Codex CLI not found. Install Codex CLI (or set its path in Settings) to convert recordings.";
    broadcast({
      phase: "error",
      message: msg,
      errorTitle: "Codex CLI required",
    });
    return { ok: false, error: msg, errorTitle: "Codex CLI required" };
  }

  // Step 1: spawn headed playwright codegen
  const playwright = resolvePlaywrightInvocation();

  return new Promise<{
    ok: boolean;
    storyName?: string;
    draftId?: string;
    error?: string;
    errorTitle?: string;
    errorDetail?: string;
    cancelled?: boolean;
  }>((resolve) => {
    const codegenArgs = [...playwright.prefixArgs, "codegen", url, "-o", recScriptPath];
    if (recordingBrowser.channel) {
      codegenArgs.push("--channel", recordingBrowser.channel);
    }
    console.log("[recording] spawning playwright codegen", {
      command: playwright.command,
      url,
      recScriptPath,
    });

    const codegenProcess = spawn(playwright.command, codegenArgs, {
      cwd: runsDir,
      env: buildEnv({ electronAsNode: playwright.useElectronAsNode }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    _recordingProcess = codegenProcess;

    let codegenStderr = "";

    broadcast({
      phase: "recording",
      message:
        "Recording in progress. End on the page you want as the final screenshot, then click Save Recording.",
    });

    codegenProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) console.log("[recording] codegen stdout:", text);
    });

    codegenProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      codegenStderr += text;
      const trimmed = text.trim();
      if (trimmed) console.error("[recording] codegen stderr:", trimmed);
    });

    codegenProcess.on("error", (err) => {
      _recordingProcess = null;
      console.error("[recording] codegen spawn error", err.message);
      const failure = broadcastRecordingError("start", err);
      resolve({
        ok: false,
        error: failure.message,
        errorTitle: failure.title,
        errorDetail: failure.detail,
      });
    });

    codegenProcess.on("close", async (code) => {
      _recordingProcess = null;

      try {
        if (_recordingAborted) {
          await fs.unlink(recScriptPath).catch(() => {});
          return resolve({ ok: false, cancelled: true });
        }

        // Step 2: read recorded script
        let script = "";
        try {
          script = await fs.readFile(recScriptPath, "utf-8");
          await fs.unlink(recScriptPath).catch(() => {});
        } catch (err) {
          const msg = recordingFailureMessage(code, codegenStderr);
          const failure = broadcastRecordingError("recording", err, msg);
          return resolve({
            ok: false,
            error: failure.message,
            errorTitle: failure.title,
            errorDetail: failure.detail,
          });
        }

        if (!script.trim()) {
          const msg = "Recorded script is empty.";
          const failure = broadcastRecordingError("recording", msg, msg);
          return resolve({
            ok: false,
            error: failure.message,
            errorTitle: failure.title,
            errorDetail: failure.detail,
          });
        }

        const overwrite = overwriteStoryKey
          ? parseCompositeName(overwriteStoryKey)
          : null;
        const storyId = overwrite?.storyId;
        const siteSlug = overwrite?.siteSlug ?? siteSlugFromUrl(url);

        // Step 3: convert Playwright recording → Bowser YAML via Codex
        broadcast({
          phase: "converting",
          message: "Converting with AI…",
        });

        const draftDir = await createDraftDir(siteSlug);
        const specCopyPath = path.join(draftDir, "recording.spec.ts");
        await fs.writeFile(specCopyPath, script, "utf-8");

        try {
          await convertRecordingWithCodex(
            script,
            draftDir,
            codexBinary,
            runsDir,
            {
              url,
              name,
              storyId,
              siteSlug,
            },
            buildEnv,
            (message) => broadcast({ phase: "converting", message }),
          );
        } catch (err) {
          await discardDraftDir(draftDir).catch(() => {});
          const failure = broadcastRecordingError("conversion", err);
          return resolve({
            ok: false,
            error: failure.message,
            errorTitle: failure.title,
            errorDetail: failure.detail,
          });
        }

        // Step 4: save directly to the story library (no manual review step).
        broadcast({ phase: "converting", message: "Saving story to library…" });

        let storyName: string;
        try {
          storyName = await saveDraftToLibrary(draftDir, siteSlug, storyId);
        } catch (err) {
          await discardDraftDir(draftDir).catch(() => {});
          const failure = broadcastRecordingError("conversion", err);
          return resolve({
            ok: false,
            error: failure.message,
            errorTitle: failure.title,
            errorDetail: failure.detail,
          });
        }

        void listRuns()
          .then((runs) => listStories(buildLastRunMap(runs)))
          .then((summaries) => ipcBroadcast("stories:changed", summaries))
          .catch((err) => console.warn("[recording] stories refresh failed", err));

        broadcast({
          phase: "done",
          message: "Story saved to library.",
          storyName,
        });
        console.log("[recording] story saved", storyName);
        resolve({ ok: true, storyName });
      } catch (err) {
        console.error("[recording] unexpected post-recording error", err);
        const failure = broadcastRecordingError("conversion", err);
        resolve({
          ok: false,
          error: failure.message,
          errorTitle: failure.title,
          errorDetail: failure.detail,
        });
      }
    });
  });
}
