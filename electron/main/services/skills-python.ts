import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { getSkillsScriptsDir } from "./skills-paths.js";

const execFileAsync = promisify(execFile);

export async function runPythonScript(
  scriptName: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  const scriptPath = path.join(getSkillsScriptsDir(), scriptName);
  return execFileAsync("python3", [scriptPath, ...args], {
    cwd: options?.cwd,
    timeout: options?.timeout ?? 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function promoteReviewedStory(draftDir: string): Promise<void> {
  await runPythonScript("promote_reviewed_story.py", ["--output-dir", draftDir]);
}

export async function appendBowserStories(
  reviewedYamlPath: string,
  destinationPath: string,
): Promise<void> {
  await runPythonScript("append_bowser_stories.py", [reviewedYamlPath, destinationPath]);
}
