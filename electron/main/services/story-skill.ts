// ============================================================================
// App-owned "skill" for Story Studio.
//
// Story Studio does NOT depend on any user-installed ~/.codex/skills. The
// instructions Codex follows are owned HERE, in the app, and embedded into
// the codex prompt at run time.
// ============================================================================

import type { BrowserMode } from "./contract-types.js";

export const BOWSER_STORY_FORMAT = `## Bowser YAML v2 story format
Stories live in site YAML files with this shape:

\`\`\`yaml
stories:
  - id: site-area-purpose
    name: Short human-readable title
    url: https://example.com/path
    mode: recorded | generated
    variables:
      login_email: user@example.com
      login_password: secret
    workflow: |
      Navigate to https://example.com/path
      Click the "Login" link
      Fill the "Email" field with "{{login_email}}"
      Fill the "Password" field with "{{login_password}}"
      Click the "Log In" button
    assertions: |
      @1 Verify the page loads successfully
      @5 Verify the dashboard is visible
\`\`\`

Rules:
- \`workflow\` = action steps only: Navigate, Click, Fill, Select, Press.
- \`assertions\` = checks only, one per line. Prefix with \`@N\` where N is how many workflow steps complete before the check (0 before the first step; with 5 workflow steps the last check is \`@5\`, not \`@6\`).
- The final assertion should match the last screen the user reached. If the recording ends with a trailing Click/Navigate (e.g. opening a detail row after a create/update), keep that step in workflow and put the final assertion at \`@<workflow step count>\` (same as the number of workflow lines) describing the destination — not the intermediate list or toast.
- Prefer human-facing language over DOM selectors.
- Keep at least one assertion per story.
- For dynamic values (dates, counts, prices, IDs), verify format/pattern not exact literals.
- Store typed inputs in a \`variables:\` map and reference them in Fill steps as \`{{variable_name}}\` (e.g. login_email, login_password).`;

// Legacy alias for recording conversion prompts
export const STORY_FORMAT = BOWSER_STORY_FORMAT;

/** Shared run rules. `mcp` adds Playwright MCP-specific interaction / screenshot tips. */
function buildRunStoryPlaybookShared(mcp: boolean): string {
  const inspect = mcp
    ? "Use non-mutating snapshots to inspect the page; do not click or type merely to explore."
    : "Use non-mutating page inspection to understand state; do not click or type merely to explore.";
  const oneLine = mcp
    ? "Execute exactly ONE Execution order line per browser action tool call. Never batch multiple story lines into one `browser_run_code_unsafe` call, generated script, or callback; Story Studio uses each completed call to report live progress."
    : "Execute exactly ONE Execution order line per browser action. Never batch multiple story lines into one tool call; Story Studio uses each completed action to report live progress.";
  const screenshotSave = mcp
    ? `- For every \`browser_take_screenshot\` call, pass \`{ "filename": "screenshots/step-{index}-{slug}.png", "raw": true }\`. The MCP parameter is **filename** (not \`path\`); use a workspace-relative path under \`screenshots/\`.
- In steps.json, attach \`screenshots/step-{index}-{slug}.png\` only on that checkpoint entry.`
    : `- Save each checkpoint as \`screenshots/step-{index}-{slug}.png\` under the run output directory.
- In steps.json, attach that path only on the checkpoint entry.`;

  return `## How to run the story
- Follow **Execution order** — the single numbered list (actions first, then Verify lines). Run every line top to bottom through the last one.
- Never attempt, probe, or pre-run a later interaction before the current line succeeds.
- Every browser interaction (Navigate, Click, Fill, Press, or Select) must implement the current Execution order line. ${inspect}
- ${oneLine}
- Immediately after each line finishes, update \`steps.json\` with that line's real result before starting the next. Do not synthesize the full timeline at the end.
- Treat each line as intent, not an exact script. Adapt to minor UI changes while preserving the goal.
- Prefer accessible role/name, labels, visible text, and URL context over coordinates or brittle element refs.
- Use variables defined in the story, including test-account credentials.
- If the story includes login steps, start from the logged-out login page and perform the login.
- Ignore browser automation UI (e.g. "--no-sandbox" infobars).

## Verify steps
- Check visible text or page state directly. Dynamic values (dates, counts, prices, IDs): verify format/pattern/relative condition, not exact literals.
- Stop on first failed Verify; mark failed or blocked if the environment prevents progress.

## Screenshots (required)
- Create \`screenshots/\` in the run output directory before executing steps.
- Checkpoint moments only: after Navigate loads; after each Verify passes; after filling a form **immediately before** Submit/Save/Log In/etc. (one per form — not the hero); on failure before stopping; optional on major UI changes (modal/wizard).
- Skip intermediate Fill/Click/Press/Select inside a form, focus changes, scrolling, and waiting. Aim for ~3–8 checkpoints, not one per line.
${screenshotSave}

## Hero screenshot
- Separate from form/pre-submit checkpoints. Capture **only after the last Execution order line** succeeds (usually the final Verify).
- After the last submit/navigation, wait for the UI to settle before the final Verify and hero.
- Hero must show the **post-condition** (new row, success toast, landed page) — not a dialog about to submit or an earlier page.
- Take a **fresh** shot to the hero path; never reuse a checkpoint. Attach hero only on the last steps.json entry and in \`screenshotPath\`.

## steps.json
- Non-empty array for every Execution order line: index, text, status (passed|failed|blocked), started_at, finished_at, screenshot (path or null), error (or null).
- **Live progress:** rewrite the full \`steps.json\` after each step (not only at exit). In generated Node scripts, \`fs.writeFileSync(stepsPath, JSON.stringify(steps, null, 2))\` in each step's \`finally\`.

## Report
- Report pass/fail with concise evidence for each Verify. No real customer-facing side effects unless the story requires them. Work silently — do not narrate in chat.`;
}

const RUN_STORY_PLAYBOOK_FORM_FILL_MCP = `## Reliable form filling (important)
Many web apps are React SPAs with controlled inputs. Fill tools and type tools frequently fail. Prefer evaluating in the page with the native value setter and dispatching input + change events:
  const set = (el, value) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
Locate inputs by name / type / placeholder / aria-label. Verify values before submit.`;

const RUN_STORY_PLAYBOOK_CODEX_CHROME = `## Execution tool — Codex Chrome extension
- Drive the user's signed-in Google Chrome via the **Codex Chrome extension** (\`@Chrome\`).
- Use Chrome for every Navigate / Click / Fill / Press / Select / Verify action in the story.
- Reuse the user's authenticated Chrome session. Do not clear cookies, storage, or browser data. Do not close unrelated tabs.
- Prefer structured Chrome / page tools over coordinate clicking. After each consequential action, confirm the page changed before continuing.
- Save screenshots as PNG files under the run output \`screenshots/\` directory (and the hero path) using the tools available to you.
- Do NOT use Playwright MCP, the in-app \`@Browser\`, Computer Use (\`@Computer\`), Playwright CLI, or any other browser-driving tool.
- Do not register or call any MCP browser server.`;

export function buildRunStoryPlaybook(browserMode: BrowserMode): string {
  if (browserMode === "codex-chrome") {
    return `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

${RUN_STORY_PLAYBOOK_CODEX_CHROME}

${buildRunStoryPlaybookShared(false)}`;
  }

  const browserDescription =
    browserMode === "existing-chrome"
      ? `## Execution tool — existing Chrome tab via Playwright MCP
- Use ONLY the Playwright MCP server named "playwright". It is connected to a user-selected Chrome tab with the user's existing authenticated session.
- Reuse the selected tab. Do not close unrelated tabs or clear cookies, storage, or browser data.
- In existing-Chrome mode, do NOT use \`browser_click\`: its actionability wait can hang through the extension bridge.
- For every Click step, use \`browser_run_code_unsafe\` with the exact role/text or snapshot aria-ref. Click with \`{ force: true, noWaitAfter: true, timeout: 5000 }\`. If that throws without changing the page, use \`locator.evaluate((element) => element.click())\` once.
- After each click, take a fresh snapshot and confirm the expected state change before continuing. Never repeat a consequential click if the page already changed.`
      : `## Execution tool — headless Playwright MCP
- Use ONLY the Playwright MCP server named "playwright". It runs headless in an isolated browser.`;
  return `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

${browserDescription}
- Do NOT use the Codex Browser plugin, the in-app browser, computer use, Playwright CLI, or any other browser-driving tool.
- Do not use any MCP server other than "playwright".

${buildRunStoryPlaybookShared(true)}

${RUN_STORY_PLAYBOOK_FORM_FILL_MCP}`;
}

export const RUN_STORY_PLAYBOOK = buildRunStoryPlaybook("private");

export interface RunPromptPaths {
  runOutputDir: string;
  screenshotsDir: string;
  stepsPath: string;
  heroScreenshotPath: string;
  storyContents: string;
  runHook?: string;
}

const GENERATE_STORY_TASK = `## Your task
1. Use the target URL from the user's request (required).
2. Explore ONE focused user flow matching the user's intent.
3. Prefer stable, user-facing flows: navigation, search/filter, forms, article/detail pages.
4. Capture meaningful actions only — prefer user-facing descriptions over brittle selectors.

## Login credentials (required when the flow needs sign-in)
- If the flow requires login — the site shows a sign-in gate, the user mentions logging in, or you cannot proceed without authentication — you MUST have real credentials before attempting login.
- Look for credentials in the user's message and the conversation so far (email/username, password, or other auth fields).
- If login is required and credentials are NOT provided:
  1. Do NOT attempt login with placeholder, example, or guessed values.
  2. Do NOT return YAML yet.
  3. Reply in plain prose asking the user for the required login details. Be specific (e.g. email and password).
- Once credentials are provided, perform the real login in the browser, complete the flow, and put the supplied values in \`variables:\` (e.g. login_email, login_password) referenced in Fill steps.
- For non-login inputs that are still unknown, you may use sensible placeholders in \`variables:\`.

${BOWSER_STORY_FORMAT}

## Output requirements
- Return a YAML document with a top-level \`stories:\` array containing exactly one story entry.
- Set mode: generated
- Choose a stable kebab-case story id and a short human-readable name from the flow.
- workflow = action steps only; assertions = checks with \`@N\` prefixes (not in workflow).
- Include at least one assertion. For dynamic values, verify format/pattern not exact literals.
- Do NOT write files or append to any story library.
- When login is required but credentials are missing, reply with plain prose only — no YAML.
- When the story is complete, return ONLY the YAML document — no markdown fences, no explanation.`;

export function buildGenerateStoryPlaybook(browserMode: BrowserMode): string {
  if (browserMode === "codex-chrome") {
    return `You are generating a Bowser YAML v2 UI story by exploring a website with the Codex Chrome extension.

## Browser tool
- Drive the user's signed-in Google Chrome via the **Codex Chrome extension** (\`@Chrome\`).
- Reuse the user's authenticated Chrome session. Do not clear cookies, storage, or browser data.
- Do NOT use Playwright MCP, the in-app \`@Browser\`, Computer Use, or any other browser-driving tool.

${GENERATE_STORY_TASK}`;
  }

  const browserDescription =
    browserMode === "existing-chrome"
      ? `- Use ONLY the Playwright MCP server named "playwright". It is connected to a user-selected Chrome tab with the user's existing authenticated session.
- Reuse the selected tab. Do not close unrelated tabs or clear cookies, storage, or browser data.
- In existing-Chrome mode, do NOT use \`browser_click\`. Use \`browser_run_code_unsafe\` with an exact locator and \`click({ force: true, noWaitAfter: true, timeout: 5000 })\`, then snapshot to confirm the page changed.`
      : `- Use ONLY the Playwright MCP server named "playwright". It runs headless in an isolated browser.`;
  return `You are generating a Bowser YAML v2 UI story by exploring a website with Playwright MCP.

## Browser tool
${browserDescription}
- Do NOT use the Codex Browser plugin, the in-app browser, computer use, or any other browser-driving tool.
- Do not use any MCP server other than "playwright".

${GENERATE_STORY_TASK}`;
}

export const GENERATE_STORY_PLAYBOOK =
  buildGenerateStoryPlaybook("private");

export const DRAFT_REVISION_PLAYBOOK = `IMPORTANT: This is a TEXT-ONLY revision. Do NOT open a browser, run shell commands, install packages, or use any MCP/tools.

${BOWSER_STORY_FORMAT}

## Your task
Revise the current draft story based on the full conversation and the user's latest feedback.
- Preserve story id and url unless the user explicitly asks to change them.
- Set mode: generated
- workflow = action steps only; assertions = checks with \`@N\` prefixes.
- Return ONLY the updated YAML document — no markdown fences, no explanation. Do not write any file.`;

export interface GeneratePromptContext {
  userMessage: string;
  transcript: string;
  currentDraftYaml?: string;
  isFirstTurn: boolean;
  /** True while no draft YAML exists yet — browser exploration is allowed. */
  exploring: boolean;
  browserMode?: BrowserMode;
}

/** Build the full prompt for a generate conversation turn. */
export function buildGeneratePrompt(ctx: GeneratePromptContext): string {
  const base = ctx.exploring
    ? buildGenerateStoryPlaybook(ctx.browserMode ?? "private")
    : DRAFT_REVISION_PLAYBOOK;
  const parts = [base, "\n\n## User request\n", ctx.userMessage.trim()];
  if (ctx.transcript.trim()) {
    parts.push("\n\n## Conversation so far\n", ctx.transcript.trim());
  }
  if (ctx.currentDraftYaml?.trim()) {
    parts.push("\n\n## Current draft YAML\n```yaml\n", ctx.currentDraftYaml.trim(), "\n```");
  }
  if (ctx.isFirstTurn) {
    parts.push(
      "\n\nThe user's message must include a target URL (https://…). If no URL is present, reply with a single line: ERROR: missing URL",
    );
  }
  return parts.join("");
}

export interface GenerateResumePromptContext {
  userMessage: string;
  currentDraftYaml?: string;
  exploring: boolean;
  /** First revision turn after a draft was produced in this session. */
  enteringRevision?: boolean;
}

/** Incremental follow-up for an established provider session (no full playbook replay). */
export function buildGenerateResumePrompt(ctx: GenerateResumePromptContext): string {
  const userMessage = ctx.userMessage.trim();
  if (ctx.exploring) {
    return userMessage;
  }

  const parts = [`Revise the draft based on this feedback:\n${userMessage}`];
  if (ctx.enteringRevision) {
    parts.push(
      "\n\nSwitch to text-only revision now: do NOT open a browser, run shell commands, install packages, or use any MCP/tools.",
    );
  }
  if (ctx.currentDraftYaml?.trim()) {
    parts.push("\n\n## Current draft YAML\n```yaml\n", ctx.currentDraftYaml.trim(), "\n```");
  }
  parts.push("\n\nReturn ONLY the updated YAML document — no markdown fences, no explanation.");
  return parts.join("");
}

/** Shared "This run" prompt suffix for Codex and Claude Code single-story runs. */
export function buildRunPromptSuffix(paths: RunPromptPaths): string {
  const { runOutputDir, screenshotsDir, stepsPath, heroScreenshotPath, storyContents, runHook } =
    paths;
  return (
    `\n\n## This run\n` +
    `Run output: ${runOutputDir}\n` +
    `Screenshots: ${screenshotsDir}\n` +
    `steps.json: ${stepsPath}\n` +
    `Hero: ${heroScreenshotPath}\n\n` +
    `Story is below — do not read story files from disk. Follow the playbook for checkpoints, live steps.json, and hero (fresh capture after the last Execution order line → ${heroScreenshotPath}; set screenshotPath to that path).\n\n` +
    "```markdown\n" +
    storyContents +
    "\n```" +
    (runHook?.trim() ? `\n\n## Additional instructions\n${runHook.trim()}` : "")
  );
}
