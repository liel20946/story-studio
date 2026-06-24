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
import { getRunsDir } from "./paths.js";
import { writeStoryFile, renameStory } from "./stories-service.js";
import { STORY_FORMAT } from "./story-skill.js";

const execFileAsync = promisify(execFile);

let _recordingProcess: ChildProcess | null = null;

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

async function isChromiumInstalled(): Promise<boolean> {
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
    browserInstalled = await isChromiumInstalled();
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

function recordingFailureMessage(exitCode: number | null, stderr: string): string {
  const combined = stderr.trim();
  if (/executable doesn't exist/i.test(combined) || /npx playwright install/i.test(combined)) {
    return "Chromium is not installed. Click Install Chromium in the record dialog, then try again.";
  }
  if (combined) {
    return `Recording failed (exit ${exitCode ?? "?"}): ${combined}`;
  }
  return (
    "No script was generated. Perform at least one action in the browser, then close the " +
    "Playwright Inspector window (not just the browser tab)."
  );
}

export async function startRecording(
  name: string,
  url: string,
  codexBinaryPath: string | null,
): Promise<{ ok: boolean; storyName?: string; error?: string }> {
  const runsDir = getRunsDir();
  const ts = Date.now();
  const recScriptPath = path.join(runsDir, `.rec-${ts}.spec.ts`);

  broadcast({ phase: "starting", message: "Starting Playwright codegen…" });

  if (!(await isChromiumInstalled())) {
    const msg = "Chromium is not installed. Install Chromium from the record dialog, then try again.";
    broadcast({ phase: "error", message: msg });
    return { ok: false, error: msg };
  }

  // Step 1: spawn headed playwright codegen
  const codePath = await resolveCodexBinary(codexBinaryPath).catch(() => null);
  if (!codePath) {
    broadcast({ phase: "error", message: "codex binary not found. Cannot convert recording." });
    return { ok: false, error: "codex binary not resolved" };
  }

  const playwright = resolvePlaywrightInvocation();

  return new Promise<{ ok: boolean; storyName?: string; error?: string }>((resolve) => {
    const codegenArgs = [...playwright.prefixArgs, "codegen", url, "-o", recScriptPath];
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
        "Browser open. Perform your actions, then close the Playwright Inspector window or click Stop & Save.",
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
      broadcast({ phase: "error", message: `Failed to start recording: ${err.message}` });
      resolve({ ok: false, error: err.message });
    });

    codegenProcess.on("close", async (code) => {
      _recordingProcess = null;

      // Step 2: read recorded script
      let script = "";
      try {
        script = await fs.readFile(recScriptPath, "utf-8");
        // Clean up temp file
        await fs.unlink(recScriptPath).catch(() => {});
      } catch (err) {
        const msg = recordingFailureMessage(code, codegenStderr);
        broadcast({ phase: "error", message: msg });
        return resolve({ ok: false, error: msg });
      }

      if (!script.trim()) {
        const msg = "Recorded script is empty.";
        broadcast({ phase: "error", message: msg });
        return resolve({ ok: false, error: msg });
      }

      // Step 3: convert using codex
      broadcast({ phase: "converting", message: "Converting to story format with Codex…" });

      const convertPrompt =
        `Convert the following recorded Playwright codegen script into an intent-level story.\n\n` +
        `${STORY_FORMAT}\n\n` +
        `Capture variables (login_email, login_password if typed, account_name, other typed values). ` +
        `Write steps as intent, not raw selectors. ` +
        `For assertions, NEVER hardcode a value that changes between runs — dates, times, counts, totals, prices, IDs, or confirmation numbers. ` +
        `Express those as a format/pattern or relative check (e.g. "shows today's date", "displays a price in $0.00 format", "item count is greater than 0", "a non-empty confirmation number is shown") rather than the literal value seen during recording. ` +
        `Return ONLY the full .story.md file contents as your final message — do not write any file. Script:\n${script}`;

      const convertArgs = [
        "exec",
        "--dangerously-bypass-approvals-and-sandbox",
        "--json",
        "--skip-git-repo-check",
        "-C",
        runsDir,
        convertPrompt,
      ];

      console.log("[recording] spawning codex for conversion", { name, codexBinary: codePath });

      const convertProcess = spawn(codePath, convertArgs, {
        cwd: runsDir,
        env: buildEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let lastAgentMessage = "";
      let convertBuffer = "";

      convertProcess.stdout?.on("data", (chunk: Buffer) => {
        convertBuffer += chunk.toString("utf-8");
        const lines = convertBuffer.split("\n");
        convertBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            const type = parsed["type"] as string | undefined;
            if (type === "item.completed") {
              const item = parsed["item"] as Record<string, unknown> | undefined;
              if (item?.["type"] === "agent_message") {
                const text = (item["text"] as string | undefined) ?? "";
                if (text) lastAgentMessage = text;
              }
            }
          } catch {
            // ignore
          }
        }
      });

      convertProcess.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8").trim();
        if (text) console.error("[recording] convert stderr:", text);
      });

      convertProcess.on("error", async (err) => {
        console.error("[recording] convert spawn error", err.message);
        broadcast({ phase: "error", message: `Conversion failed: ${err.message}` });
        resolve({ ok: false, error: err.message });
      });

      convertProcess.on("close", async (_code) => {
        if (!lastAgentMessage.trim()) {
          const msg = "Codex did not produce story content.";
          broadcast({ phase: "error", message: msg });
          return resolve({ ok: false, error: msg });
        }

        // Step 4: write story file
        try {
          await writeStoryFile(name, lastAgentMessage);
          // Codex generates its own `title:` frontmatter (e.g. "Visit Homepage")
          // from the recorded actions, which would override the name the user
          // typed. Force the display title back to the user-provided name so the
          // saved story matches what they named it.
          await renameStory(name, name).catch(() => {});
          broadcast({ phase: "done", message: `Story "${name}" saved.` });
          console.log("[recording] story written", name);
          resolve({ ok: true, storyName: name });
        } catch (err) {
          const msg = `Failed to write story: ${String(err)}`;
          broadcast({ phase: "error", message: msg });
          resolve({ ok: false, error: msg });
        }
      });
    });
  });
}
