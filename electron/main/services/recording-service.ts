import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { spawn, type ChildProcess } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { broadcast as ipcBroadcast } from "../broadcast.js";
import type {
  RecordingProgress,
  RecordingAvailability,
  AgentProvider,
} from "./contract-types.js";
import { resolveAgentBinary } from "./agent-provider.js";
import { getAgentRunConfig } from "./agent-config.js";
import { createDraftDir, discardDraftDir, saveDraftToLibrary, listStories } from "./stories-service.js";
import { convertRecordingWithAgent } from "./recording-convert-service.js";
import { formatRecordingFailure } from "./recording-errors.js";
import { siteSlugFromUrl, parseCompositeName } from "./bowser-stories-service.js";
import { getRunsDir } from "./paths.js";
import { listRuns, buildLastRunMap } from "./run-service.js";
import {
  buildPlaywrightEnv,
  installPlaywrightChromium,
  isPlaywrightChromiumInstalled,
  resolvePlaywrightInvocation,
} from "./playwright-runtime.js";
import { ensurePlaywrightReady } from "./playwright-preflight.js";

const execFileAsync = promisify(execFile);

let _recordingProcess: ChildProcess | null = null;
let _recordingAborted = false;

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
};

function agentCliLabel(provider: AgentProvider): string {
  return provider === "claude-code" ? "Claude Code" : "Codex";
}

/** Chromium-family browsers acceptable as a Playwright recording fallback. */
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

async function getSystemChromePath(): Promise<string | null> {
  for (const candidate of SYSTEM_CHROME_PATHS[process.platform] ?? []) {
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

export async function checkRecordingAvailability(
  settings: RecordingAgentSettings,
): Promise<RecordingAvailability> {
  let agentAvailable = false;
  let playwrightAvailable = false;
  let browserInstalled = false;

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

  try {
    // Generous timeout: the first `npx playwright` after launch can be slow to
    // resolve (cold cache), which previously produced a false negative and made
    // the record dialog wrongly claim Chromium was missing.
    const playwright = resolvePlaywrightInvocation();
    const { stdout } = await execFileAsync(
      playwright.command,
      [...playwright.prefixArgs, "--version"],
      {
        env: buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
        timeout: 45_000,
        maxBuffer: 1024 * 64,
      },
    );
    playwrightAvailable = /\bVersion\b/i.test(stdout) || /\d+\.\d+\.\d+/.test(stdout);
  } catch {
    // not available
  }

  if (playwrightAvailable) {
    browserInstalled = await isPlaywrightChromiumInstalled();
  }

  console.log("[recording] availability check", {
    agentProvider: settings.agentProvider,
    agentAvailable,
    playwrightAvailable,
    browserInstalled,
  });
  return {
    agentAvailable,
    playwrightAvailable,
    browserInstalled,
  };
}

export async function installBrowser(): Promise<{ ok: boolean; error?: string }> {
  return installPlaywrightChromium();
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

  const prep = await ensurePlaywrightReady({
    browserMode: "private",
    onProgress: (p) => broadcast({ phase: "starting", message: p.message }),
  });
  if (!prep.ok) {
    return { ok: false, message: prep.message, error: prep.error ?? prep.message };
  }

  return { ok: true, message: "Recording prerequisites fixed. Ready to record." };
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
      env: buildPlaywrightEnv({ electronAsNode: playwright.useElectronAsNode }),
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

export async function startRecording(
  name: string,
  url: string,
  agentSettings: RecordingAgentSettings,
  overwriteStoryKey?: string,
): Promise<RecordingStartResult> {
  _recordingAborted = false;

  const agentLabel = agentCliLabel(agentSettings.agentProvider);
  const agentBinary = await resolveAgentBinary(
    agentSettings.agentProvider,
    agentSettings.codexBinaryPath,
    agentSettings.claudeBinaryPath,
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

  console.log("[recording] start", { url, name });

  broadcast({ phase: "starting", message: "Preparing browser environment…" });
  const prep = await ensurePlaywrightReady({
    browserMode: "private",
    onProgress: (p) => broadcast({ phase: "starting", message: p.message }),
  });
  if (!prep.ok) {
    const msg = prep.error ?? prep.message;
    broadcast({
      phase: "error",
      message: msg,
      errorTitle: "Browser unavailable",
    });
    return { ok: false, error: msg, errorTitle: "Browser unavailable" };
  }

  return startPlaywrightCodegenRecording(
    name,
    url,
    agentSettings,
    agentBinary,
    overwriteStoryKey,
  );
}
