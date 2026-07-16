import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { app } from "../electron-api.js";
import { broadcast as ipcBroadcast } from "../broadcast.js";
import type {
  RecordingProgress,
  RecordingAvailability,
  AgentProvider,
  BrowserMcp,
} from "./contract-types.js";
import { resolveAgentBinary } from "./agent-provider.js";
import { getAgentRunConfig } from "./agent-config.js";
import {
  needsGoogleChrome,
  resolveEffectiveBrowserTool,
  type EffectiveBrowserTool,
} from "./browser-mcp-config.js";
import { createDraftDir, discardDraftDir, saveDraftToLibrary, listStories } from "./stories-service.js";
import {
  convertObservedRecordingWithAgent,
  convertRecordingWithAgent,
} from "./recording-convert-service.js";
import { formatRecordingFailure } from "./recording-errors.js";
import { siteSlugFromUrl, parseCompositeName } from "./bowser-stories-service.js";
import { getRunsDir } from "./paths.js";
import { listRuns, buildLastRunMap } from "./run-service.js";

const execFileAsync = promisify(execFile);

let _recordingProcess: ChildProcess | null = null;
let _recordingAborted = false;
/** Resolves when the user clicks Save / Abort during a headed Chrome recording. */
let _manualRecordingResolve: ((outcome: "saved" | "aborted") => void) | null = null;

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

/** Google Chrome only — required by Chrome DevTools MCP / Computer Use. */
const GOOGLE_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  win32: [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
  ],
};

/** Chromium-family browsers acceptable as a Playwright recording fallback. */
const SYSTEM_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    ...GOOGLE_CHROME_PATHS.darwin,
  ],
  linux: [
    ...GOOGLE_CHROME_PATHS.linux,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ],
  win32: [...GOOGLE_CHROME_PATHS.win32],
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

async function findFirstExistingPath(candidates: string[]): Promise<string | null> {
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

async function getSystemChromePath(): Promise<string | null> {
  return findFirstExistingPath(SYSTEM_CHROME_PATHS[process.platform] ?? []);
}

async function getGoogleChromePath(): Promise<string | null> {
  return findFirstExistingPath(GOOGLE_CHROME_PATHS[process.platform] ?? []);
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

type RecordingAgentSettings = {
  agentProvider: AgentProvider;
  codexBinaryPath: string | null;
  claudeBinaryPath: string | null;
  codexModel: string;
  codexEffort: string;
  claudeModel: string;
  claudeEffort: string;
  browserMcp?: BrowserMcp;
  codexComputerUse?: boolean;
};

function agentCliLabel(provider: AgentProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

function chromeRequirementMessage(settings: RecordingAgentSettings): string {
  const computerUse =
    settings.agentProvider === "codex" && Boolean(settings.codexComputerUse);
  if (computerUse) {
    return "Google Chrome is required for Codex Computer Use. Install Google Chrome from https://www.google.com/chrome/, then try again.";
  }
  return "Google Chrome is required for Chrome DevTools MCP. Install Google Chrome from https://www.google.com/chrome/, then try again.";
}

function resolveRecordingTool(settings: RecordingAgentSettings): EffectiveBrowserTool {
  return resolveEffectiveBrowserTool({
    browserMcp: settings.browserMcp,
    computerUse:
      settings.agentProvider === "codex" && Boolean(settings.codexComputerUse),
  });
}

export async function checkRecordingAvailability(
  settings: RecordingAgentSettings,
): Promise<RecordingAvailability> {
  let agentAvailable = false;
  let playwrightAvailable = false;
  let browserInstalled = false;
  const chromeInstalled = Boolean(await getGoogleChromePath());
  const tool = resolveRecordingTool(settings);
  const requiresPlaywright = tool === "playwright";
  const needsChrome = needsGoogleChrome({
    browserMcp: settings.browserMcp,
    computerUse:
      settings.agentProvider === "codex" && Boolean(settings.codexComputerUse),
  });

  try {
    await resolveAgentBinary(
      settings.agentProvider,
      settings.codexBinaryPath,
      settings.claudeBinaryPath,
    );
    agentAvailable = true;
  } catch {
    // not available
  }

  if (requiresPlaywright) {
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
  }

  console.log("[recording] availability check", {
    agentProvider: settings.agentProvider,
    agentAvailable,
    playwrightAvailable,
    browserInstalled,
    chromeInstalled,
    needsChrome,
    requiresPlaywright,
    tool,
    browserMcp: settings.browserMcp,
    codexComputerUse: settings.codexComputerUse,
  });
  return {
    agentAvailable,
    playwrightAvailable,
    browserInstalled,
    chromeInstalled,
    needsChrome,
    requiresPlaywright,
  };
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

export async function autoFixRecordingPrerequisites(
  settings: RecordingAgentSettings,
): Promise<{ ok: boolean; message: string; error?: string }> {
  const providerLabel = agentCliLabel(settings.agentProvider);
  try {
    await resolveAgentBinary(
      settings.agentProvider,
      settings.codexBinaryPath,
      settings.claudeBinaryPath,
    );
  } catch {
    const msg = `${providerLabel} CLI is missing. Install it (or set its path in Settings), then try again.`;
    return { ok: false, message: msg, error: msg };
  }

  const tool = resolveRecordingTool(settings);
  if (tool === "playwright") {
    try {
      const playwright = resolvePlaywrightInvocation();
      await execFileAsync(playwright.command, [...playwright.prefixArgs, "--version"], {
        env: buildEnv({ electronAsNode: playwright.useElectronAsNode }),
        timeout: 60_000,
        maxBuffer: 1024 * 64,
      });
    } catch (err) {
      const msg = `Playwright CLI is unavailable: ${err instanceof Error ? err.message : String(err)}`;
      return { ok: false, message: msg, error: msg };
    }

    const recordingBrowser = await resolveRecordingBrowser();
    if (!recordingBrowser.ready) {
      const installRes = await installBrowser();
      if (!installRes.ok) {
        const msg = installRes.error ?? "Failed to install Chromium.";
        return { ok: false, message: msg, error: msg };
      }
      const browser = await resolveRecordingBrowser();
      if (!browser.ready) {
        const msg = "Chromium installation finished, but no runnable browser was found.";
        return { ok: false, message: msg, error: msg };
      }
    }
  }

  const needsChrome = needsGoogleChrome({
    browserMcp: settings.browserMcp,
    computerUse:
      settings.agentProvider === "codex" && Boolean(settings.codexComputerUse),
  });
  if (needsChrome) {
    const chromePath = await getGoogleChromePath();
    if (!chromePath) {
      const msg = chromeRequirementMessage(settings);
      return { ok: false, message: msg, error: msg };
    }
  }

  return { ok: true, message: "Recording prerequisites fixed. Ready to record." };
}

export async function cancelRecording(): Promise<void> {
  // Headed Chrome / Computer Use: Save ends the capture but keeps Chrome open
  // so the agent can observe the session during conversion.
  if (_manualRecordingResolve) {
    const resolve = _manualRecordingResolve;
    _manualRecordingResolve = null;
    resolve("saved");
    return;
  }
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
  if (_manualRecordingResolve) {
    const resolve = _manualRecordingResolve;
    _manualRecordingResolve = null;
    resolve("aborted");
  }
  if (_recordingProcess) {
    try {
      _recordingProcess.kill("SIGTERM");
    } catch {
      // ignore
    }
    _recordingProcess = null;
  }
}

function waitForManualRecordingEnd(): Promise<"saved" | "aborted"> {
  return new Promise((resolve) => {
    _manualRecordingResolve = resolve;
  });
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

type RecordingStartResult = {
  ok: boolean;
  storyName?: string;
  draftId?: string;
  error?: string;
  errorTitle?: string;
  errorDetail?: string;
  cancelled?: boolean;
};

async function finishDraftStory(params: {
  draftDir: string;
  siteSlug: string;
  storyId?: string;
}): Promise<RecordingStartResult> {
  broadcast({ phase: "converting", message: "Saving story to library…" });

  let storyName: string;
  try {
    storyName = await saveDraftToLibrary(params.draftDir, params.siteSlug, params.storyId);
  } catch (err) {
    await discardDraftDir(params.draftDir).catch(() => {});
    const failure = broadcastRecordingError("conversion", err);
    return {
      ok: false,
      error: failure.message,
      errorTitle: failure.title,
      errorDetail: failure.detail,
    };
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
  return { ok: true, storyName };
}

async function startPlaywrightCodegenRecording(
  name: string,
  url: string,
  agentSettings: RecordingAgentSettings,
  agentBinary: string,
  overwriteStoryKey?: string,
): Promise<RecordingStartResult> {
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

  const agentConfig = getAgentRunConfig(agentSettings.agentProvider, agentSettings);
  const playwright = resolvePlaywrightInvocation();

  return new Promise<RecordingStartResult>((resolve) => {
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

        broadcast({
          phase: "converting",
          message: "Converting with AI…",
        });

        const draftDir = await createDraftDir(siteSlug);
        const specCopyPath = path.join(draftDir, "recording.spec.ts");
        await fs.writeFile(specCopyPath, script, "utf-8");

        try {
          await convertRecordingWithAgent(
            script,
            draftDir,
            {
              url,
              name,
              storyId,
              siteSlug,
              provider: agentSettings.agentProvider,
              agentBinary,
              agentConfig,
            },
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

        resolve(await finishDraftStory({ draftDir, siteSlug, storyId }));
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

async function openUrlInExistingGoogleChrome(url: string): Promise<void> {
  if (process.platform === "darwin") {
    // Reuses the running Chrome / default profile (new tab in existing window).
    await execFileAsync("open", ["-a", "Google Chrome", url], {
      timeout: 15_000,
      env: buildEnv(),
    });
    return;
  }

  const chromePath = await getGoogleChromePath();
  if (!chromePath) {
    throw new Error("Google Chrome is not installed.");
  }
  // No custom --user-data-dir so Chrome attaches to the default profile.
  const child = spawn(chromePath, [url], {
    env: buildEnv(),
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}

async function startObservedChromeRecording(
  name: string,
  url: string,
  agentSettings: RecordingAgentSettings,
  agentBinary: string,
  tool: "chrome-devtools" | "computer-use",
  overwriteStoryKey?: string,
): Promise<RecordingStartResult> {
  const chromePath = await getGoogleChromePath();
  if (!chromePath) {
    const msg = chromeRequirementMessage(agentSettings);
    broadcast({
      phase: "error",
      message: msg,
      errorTitle: "Google Chrome required",
    });
    return { ok: false, error: msg, errorTitle: "Google Chrome required" };
  }

  const startingMessage =
    tool === "computer-use"
      ? "Opening start URL in your Google Chrome…"
      : "Opening start URL in your Google Chrome…";
  broadcast({ phase: "starting", message: startingMessage });

  if (_recordingAborted) {
    return { ok: false, cancelled: true };
  }

  const agentConfig = getAgentRunConfig(agentSettings.agentProvider, agentSettings);

  try {
    console.log("[recording] opening URL in existing Google Chrome", { tool, url });
    await openUrlInExistingGoogleChrome(url);

    broadcast({
      phase: "recording",
      message:
        tool === "chrome-devtools"
          ? "Recording in your Chrome. Use the opened tab (enable chrome://inspect → Remote debugging if needed). End on the final screenshot page, then Save Recording."
          : "Recording in your Chrome. Use the opened tab — do not switch to a new window. End on the final screenshot page, then Save Recording.",
    });

    const outcome = await waitForManualRecordingEnd();
    if (outcome === "aborted" || _recordingAborted) {
      return { ok: false, cancelled: true };
    }

    const overwrite = overwriteStoryKey ? parseCompositeName(overwriteStoryKey) : null;
    const storyId = overwrite?.storyId;
    const siteSlug = overwrite?.siteSlug ?? siteSlugFromUrl(url);

    broadcast({
      phase: "converting",
      message: "Converting with AI…",
    });

    const draftDir = await createDraftDir(siteSlug);
    try {
      await convertObservedRecordingWithAgent(
        draftDir,
        {
          url,
          name,
          storyId,
          siteSlug,
          provider: agentSettings.agentProvider,
          agentBinary,
          agentConfig,
          tool,
        },
        (message) => broadcast({ phase: "converting", message }),
      );
    } catch (err) {
      await discardDraftDir(draftDir).catch(() => {});
      const failure = broadcastRecordingError("conversion", err);
      return {
        ok: false,
        error: failure.message,
        errorTitle: failure.title,
        errorDetail: failure.detail,
      };
    }

    return finishDraftStory({ draftDir, siteSlug, storyId });
  } catch (err) {
    const failure = broadcastRecordingError("start", err);
    return {
      ok: false,
      error: failure.message,
      errorTitle: failure.title,
      errorDetail: failure.detail,
    };
  }
}

export async function startRecording(
  name: string,
  url: string,
  agentSettings: RecordingAgentSettings,
  overwriteStoryKey?: string,
): Promise<RecordingStartResult> {
  _recordingAborted = false;
  _manualRecordingResolve = null;

  const agentLabel = agentCliLabel(agentSettings.agentProvider);
  const agentBinary = await resolveAgentBinary(
    agentSettings.agentProvider,
    agentSettings.codexBinaryPath,
    agentSettings.claudeBinaryPath,
    {
      computerUse:
        agentSettings.agentProvider === "codex" &&
        Boolean(agentSettings.codexComputerUse),
    },
  ).catch(() => null);
  if (!agentBinary) {
    const msg = `${agentLabel} CLI not found. Install ${agentLabel} CLI (or set its path in Settings) to convert recordings.`;
    broadcast({
      phase: "error",
      message: msg,
      errorTitle: `${agentLabel} CLI required`,
    });
    return { ok: false, error: msg, errorTitle: `${agentLabel} CLI required` };
  }

  const tool = resolveRecordingTool(agentSettings);
  console.log("[recording] start", { tool, url, name });

  if (tool === "playwright") {
    return startPlaywrightCodegenRecording(
      name,
      url,
      agentSettings,
      agentBinary,
      overwriteStoryKey,
    );
  }

  return startObservedChromeRecording(
    name,
    url,
    agentSettings,
    agentBinary,
    tool,
    overwriteStoryKey,
  );
}
