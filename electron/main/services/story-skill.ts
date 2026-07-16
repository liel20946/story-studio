// ============================================================================
// App-owned "skill" for Story Studio.
//
// Story Studio does NOT depend on any user-installed ~/.codex/skills. The
// instructions Codex follows are owned HERE, in the app, and embedded into
// the codex prompt at run time.
// ============================================================================

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

const RUN_STORY_PLAYBOOK_SHARED = `## How to run the story
- Follow **Execution order** — the numbered list that interleaves steps and assertions. Run every line through the last one.
- Treat each line as intent, not an exact script. Adapt to minor UI changes while preserving the goal.
- Prefer accessible role/name, labels, visible text, and URL context over coordinates or brittle element refs.
- Use variables defined in the story, including test-account credentials.
- If the story includes login steps, start from the logged-out login page and perform the login.
- Ignore browser automation UI (e.g. "--no-sandbox" infobars).

## Verify steps and dynamic assertions
- For Verify steps, check visible text or page state directly.
- Dynamic values (dates, times, counts, totals, prices, IDs): verify format/pattern/relative condition, not exact literals.
- Stop on first failed Verify and mark status failed or blocked if environment prevents progress.

## Screenshots and steps.json (required)
- Create a \`screenshots/\` directory in the run output directory before executing steps.
- Capture checkpoint screenshots at meaningful moments:
  1. **Navigate** — after the new page has loaded.
  2. **Verify** — after each assertion in Execution order passes (evidence for the report).
  3. **Form groups** — after filling all fields in a form/dialog/section, **immediately before** clicking Submit / Save / Continue / Log In / Issue / Confirm (one screenshot per form, not per field). This is **not** the hero screenshot.
  4. **Major UI change** — modal opened, wizard step advanced (optional checkpoint only).
  5. **Failure** — always, immediately before stopping.
- Skip screenshots for intermediate Fill / Click / Press / Select steps inside a form group, focus changes, scrolling, and waiting.
- Aim for roughly **3–8 checkpoint screenshots** on a typical story, not one per workflow line.
- Save checkpoint images as \`screenshots/step-{index}-{slug}.png\` and attach the path only on that steps.json entry.

## Hero screenshot (critical — read carefully)
- The hero screenshot is **separate** from form-group / pre-submit checkpoints.
- Capture it **only after the last line in Execution order** completes successfully (usually the final Verify).
- After the last submit/navigation action, **wait for the UI to settle** (a few seconds, or until the element the final Verify checks is visible) **before** the final Verify and hero capture.
- The hero must show the **post-condition** the story ends on — e.g. the new row in a table, success toast visible, landed page after the last click — **not** a dialog about to be submitted and not an earlier page.
- Take a **fresh** screenshot and save it to the hero path. Do **not** copy or reuse an earlier checkpoint file (especially not a pre-submit form screenshot).
- Attach the hero path only on the **last** steps.json entry and in structured output \`screenshotPath\`.

## steps.json
- Write \`steps.json\` as a non-empty array covering every line in Execution order (actions and Verify steps). Each entry: index, text, status (passed|failed|blocked), started_at, finished_at, screenshot (path or null), error (or null).

## Report
- Report pass/fail with concise evidence for each Verify step.
- Do not create real customer-facing side effects unless the story explicitly requires them.
- Work silently during execution — do not narrate your plan in chat.`;

const RUN_STORY_PLAYBOOK_FORM_FILL_MCP = `## Reliable form filling (important)
Many web apps are React SPAs with controlled inputs. Fill tools and type tools frequently fail. Prefer evaluating in the page with the native value setter and dispatching input + change events:
  const set = (el, value) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
Locate inputs by name / type / placeholder / aria-label. Verify values before submit.`;

export const RUN_STORY_PLAYBOOK = `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

## Execution tool — headless, no visible browser
- Use ONLY the Playwright MCP server named "playwright". It runs headless.
- Do NOT use the Codex Browser plugin, the in-app browser, the Chrome backend, computer use, Chrome DevTools MCP, or any other browser-driving tool.
- Do not use any MCP server other than "playwright".

${RUN_STORY_PLAYBOOK_SHARED}

${RUN_STORY_PLAYBOOK_FORM_FILL_MCP}`;

const RUN_STORY_PLAYBOOK_CHROME_DEVTOOLS = `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

## Execution tool — headless Chrome DevTools MCP
- Use ONLY the Chrome DevTools MCP server named "chrome-devtools". It runs headless Google Chrome.
- Do NOT use the Playwright MCP server, Playwright CLI, the Codex Browser plugin, the in-app browser, computer use, or any other browser-driving tool.
- Do not use any MCP server other than "chrome-devtools".

${RUN_STORY_PLAYBOOK_SHARED}

${RUN_STORY_PLAYBOOK_FORM_FILL_MCP}`;

const RUN_STORY_PLAYBOOK_COMPUTER_USE_SINGLE = `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

## Execution tool — @Computer (Codex Computer Use)
- Start with @Computer. Use Codex Computer Use to operate the desktop like a human (see, click, type, scroll).
- Do NOT use Playwright MCP, Playwright CLI, Chrome DevTools MCP, the Codex in-app @Browser, Cursor, or any headless/automation browser.
- Do not invent or call any other browser-driving tool.
- If Computer Use / @Computer tools are missing, fail immediately with a clear blocked summary — do not improvise another browser tool.

## Chrome window (required)
- Prefer an **already open Google Chrome** window. Open a **new tab in that existing window** for this story.
- Only open a new Chrome window if Google Chrome is not already running.
- Navigate by typing/pasting the story URL into that tab's address bar.
- Do not use Playwright/automation profiles, Cursor, or private/incognito unless the story requires it.

${RUN_STORY_PLAYBOOK_SHARED}

## Reliable form filling (important)
- Click into fields and type values normally via @Computer. Clear existing text when needed before typing.
- Prefer labels, visible text, and obvious UI affordances over pixel-perfect guessing.
- After filling a form group, verify the values are visible in the fields before submit.`;

const RUN_STORY_PLAYBOOK_COMPUTER_USE_BULK = `You are running a saved web UI "story" — an intent-level browser test as part of a bulk run. Follow these rules exactly.

## Execution tool — @Computer (Codex Computer Use)
- Start with @Computer. Use Codex Computer Use to operate the desktop like a human (see, click, type, scroll).
- Do NOT use Playwright MCP, Playwright CLI, Chrome DevTools MCP, the Codex in-app @Browser, Cursor, or any headless/automation browser.
- Do not invent or call any other browser-driving tool.
- If Computer Use / @Computer tools are missing, fail immediately with a clear blocked summary — do not improvise another browser tool.

## Chrome window / tab (required — bulk run)
- Prefer the dedicated Story Studio Chrome window if it already exists; otherwise use any **already open Google Chrome** window.
- For this story, open a **new tab in that same Chrome window** and run the story there. Do not open a separate Chrome window per story when a Chrome window already exists.
- Only open a new Chrome window if Google Chrome is not already running.
- Navigate by typing/pasting the story URL into that tab's address bar.

${RUN_STORY_PLAYBOOK_SHARED}

## Reliable form filling (important)
- Click into fields and type values normally via @Computer. Clear existing text when needed before typing.
- Prefer labels, visible text, and obvious UI affordances over pixel-perfect guessing.
- After filling a form group, verify the values are visible in the fields before submit.`;

export interface RunPlaybookOptions {
  /** Use Codex Computer Use instead of any browser MCP (overrides browserMcp). */
  computerUse?: boolean;
  /** Headless browser MCP when Computer Use is off. */
  browserMcp?: "playwright" | "chrome-devtools";
  /** Bulk run: open a new tab in the shared Chrome window (Computer Use). */
  bulk?: boolean;
}

/** Resolve the run playbook for Playwright MCP, Chrome DevTools MCP, or Computer Use. */
export function getRunStoryPlaybook(options?: RunPlaybookOptions): string {
  if (options?.computerUse) {
    return options.bulk
      ? RUN_STORY_PLAYBOOK_COMPUTER_USE_BULK
      : RUN_STORY_PLAYBOOK_COMPUTER_USE_SINGLE;
  }
  if (options?.browserMcp === "chrome-devtools") {
    return RUN_STORY_PLAYBOOK_CHROME_DEVTOOLS;
  }
  return RUN_STORY_PLAYBOOK;
}

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

export const GENERATE_STORY_PLAYBOOK = `You are generating a Bowser YAML v2 UI story by exploring a website with Playwright MCP.

## Browser tool
- Use ONLY the Playwright MCP server named "playwright". It runs headless.
- Do NOT use the Codex Browser plugin, the in-app browser, computer use, Chrome DevTools MCP, or any other browser-driving tool.
- Do not use any MCP server other than "playwright".

${GENERATE_STORY_TASK}`;

const GENERATE_STORY_PLAYBOOK_CHROME_DEVTOOLS = `You are generating a Bowser YAML v2 UI story by exploring a website with Chrome DevTools MCP.

## Browser tool
- Use ONLY the Chrome DevTools MCP server named "chrome-devtools". It runs headless Google Chrome.
- Do NOT use the Playwright MCP server, the Codex Browser plugin, the in-app browser, computer use, or any other browser-driving tool.
- Do not use any MCP server other than "chrome-devtools".

${GENERATE_STORY_TASK}`;

const GENERATE_STORY_PLAYBOOK_COMPUTER_USE = `You are generating a Bowser YAML v2 UI story by exploring a website with Codex Computer Use.

## Browser tool
- Start with @Computer. Use Codex Computer Use to operate the desktop like a human (see, click, type, scroll).
- Do NOT use Playwright MCP, Chrome DevTools MCP, Playwright CLI, the Codex in-app @Browser, Cursor, or any headless/automation browser.
- Prefer an **already open Google Chrome** window. Open a **new tab** there for exploration; only open a new Chrome window if Chrome is not running.

${GENERATE_STORY_TASK}`;

export interface GeneratePlaybookOptions {
  computerUse?: boolean;
  browserMcp?: "playwright" | "chrome-devtools";
}

/** Resolve the generate-exploration playbook for the selected browser backend. */
export function getGenerateStoryPlaybook(options?: GeneratePlaybookOptions): string {
  if (options?.computerUse) return GENERATE_STORY_PLAYBOOK_COMPUTER_USE;
  if (options?.browserMcp === "chrome-devtools") {
    return GENERATE_STORY_PLAYBOOK_CHROME_DEVTOOLS;
  }
  return GENERATE_STORY_PLAYBOOK;
}

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
  computerUse?: boolean;
  browserMcp?: "playwright" | "chrome-devtools";
}

/** Build the full prompt for a generate conversation turn. */
export function buildGeneratePrompt(ctx: GeneratePromptContext): string {
  const base = ctx.exploring
    ? getGenerateStoryPlaybook({
        computerUse: ctx.computerUse,
        browserMcp: ctx.browserMcp,
      })
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
    `Run output directory: ${runOutputDir}\n` +
    `Screenshots directory: ${screenshotsDir}\n` +
    `Steps JSON path: ${stepsPath}\n` +
    `Hero screenshot path: ${heroScreenshotPath}\n\n` +
    `The full story to run is included below. Do not read story files from disk.\n\n` +
    "```markdown\n" +
    storyContents +
    "\n```\n\n" +
    `Write steps.json to ${stepsPath} (log every step in Execution order; attach screenshots only at checkpoints — see playbook). ` +
    `Save checkpoint screenshots under ${screenshotsDir}. ` +
    `The hero screenshot MUST be a fresh capture taken after the last Execution order step succeeds — ` +
    `wait for the UI to update after the final submit/navigation, then save it to exactly ${heroScreenshotPath}. ` +
    `Do not reuse a pre-submit or earlier checkpoint as the hero. ` +
    `Set screenshotPath in the output schema to ${heroScreenshotPath}.` +
    (runHook?.trim() ? `\n\n## Additional instructions\n${runHook.trim()}` : "")
  );
}
