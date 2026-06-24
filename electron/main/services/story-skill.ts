// ============================================================================
// App-owned "skill" for Story Studio.
//
// Story Studio does NOT depend on any user-installed ~/.codex/skills. The
// instructions Codex follows are owned HERE, in the app, and embedded into
// the codex prompt at run time. This gives the
// app full control over execution mode (headless), form-filling strategy, and
// reporting — independent of whatever lives in ~/.codex.
// ============================================================================

// Shared description of the .story.md format (used by run + record conversion).
export const STORY_FORMAT = `## Story format
A story is a Markdown file (.story.md) with:
- YAML frontmatter: name, title, base_url, optional metadata.
- A "Variables" section: recorded inputs and defaults, including test-account
  credentials when present (e.g. login_email, login_password).
- A "Steps" section: the browser workflow, written as intent, not exact code.
- An "Assertions" section: pass/fail checks. NEVER hardcode a value that changes
  between runs — dates, times, relative timestamps ("2 minutes ago"), counts,
  totals, prices/balances, IDs, order/confirmation numbers, or anything captured
  "as of right now". Assert on the FORMAT, PATTERN, or a RELATIVE condition
  instead of the literal that happened to be on screen when recorded. Examples:
  write "shows today's date" (not "shows June 21, 2026"), "displays a price in
  $0.00 format" (not "shows $42.00"), "the item count is greater than 0" (not
  "shows 7 items"), "a non-empty confirmation number is shown" (not "shows order
  #10432"). Only hardcode a value when it is genuinely fixed for every run (e.g.
  a static page title or a label).
If the story includes login steps, perform them from the logged-out login page.`;

// The run playbook — everything Codex needs to execute a story. The dynamic,
// per-run details (story path, screenshot path) are appended by codex-runner.
export const RUN_STORY_PLAYBOOK = `You are running a saved web UI "story" — an intent-level browser test. Follow these rules exactly.

## Execution tool — headless, no visible browser
- Use ONLY the Playwright MCP server named "playwright". It runs headless.
- Do NOT use the Codex Browser plugin, the in-app browser, the Chrome backend, computer use, or any other browser-driving tool. Never open a visible or local browser window.
- Do not use any MCP server other than "playwright". Do not list or run any other story.

## How to run the story
- Treat each step as intent, not an exact script. Adapt to minor UI changes while preserving the goal.
- Prefer accessible role/name, labels, visible text, and URL context over coordinates or brittle element refs.
- Use the variables defined in the story, including test-account credentials. Only ask if a required value is genuinely missing from the story.
- If the story includes login steps, start from the logged-out login page and perform the login.
- Ignore browser automation UI (e.g. "--no-sandbox" infobars); assertions target the app's page content only.

## Reliable form filling (important — do this first for login/form fields)
Many web apps are React single-page apps with controlled inputs. browser_fill_form and browser_type frequently fail on these (the typed value is not retained, the field clears, or submit validation fails). To avoid a failed first attempt, fill form fields directly with browser_evaluate using the native value setter and dispatch input + change events so React registers the change:
  const set = (el, value) => { const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'); d.set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
Locate inputs by name / type / placeholder / aria-label (e.g. email and password fields). Verify the values are present before clicking submit. Prefer this evaluate-based fill over browser_fill_form / browser_type for login email and password.

## Assertions, screenshot, report
- Evaluate every assertion in the story. Stop on the first failed assertion and report the last successful step.
- Many assertions describe DYNAMIC values (dates, times, counts, totals, prices, IDs, confirmation numbers). Do NOT require an exact literal match for these — the value will differ from run to run. Verify the format, pattern, or relative condition the assertion describes (e.g. a valid date, today's date, a positive count, a correctly formatted price, a non-empty ID). Treat an assertion as passed when the dynamic value is present and well-formed, even if it differs from any example value embedded in the story text.
- Capture a final screenshot of the visible state, whether the story passes or fails.
- Report pass/fail with concise evidence for each assertion.
- Do not create real customer-facing side effects unless the story explicitly requires them.`;

// Bulk-run orchestrator — one Codex thread spawns a subagent per story via
// spawn_agent instead of launching a separate codex exec per story.
export const BULK_RUN_ORCHESTRATOR_PLAYBOOK = `You are orchestrating a bulk run of multiple saved web UI "stories".

## Your job
- Use spawn_agent to delegate EVERY story to its own subagent. Do NOT run any story yourself.
- Each subagent uses one Playwright MCP browser session. The app enforces a global Playwright limit — the bulk-run prompt tells you how many subagents may run in parallel right now.
- Spawn up to that parallel limit at a time. When a subagent finishes (wait_agent + close_agent), spawn the next queued story. Parallel is fine when slots are free; queue when Playwright is saturated.
- After spawning, use wait_agent to wait for each subagent to finish. Prefer waiting on multiple agent ids together when possible.
- Call close_agent on each subagent after it completes and you have confirmed its result file was written.
- Do NOT use the Playwright MCP yourself — only your subagents run browser tests.

## User cancellation (critical)
The runs directory may contain \`{runId}.cancel\` marker files when the user cancels a single story mid-bulk-run.
Before EVERY tool call (including spawn_agent, wait_agent, and close_agent):
1. Check the runs directory for any \`*.cancel\` files.
2. Do NOT spawn_agent for a runId that already has a cancel marker.
3. For any cancel marker whose runId matches a subagent you already spawned, call close_agent on that agent immediately (read optional \`agentId\` from the marker JSON body if present).
4. Exclude cancelled agents from wait_agent targets — close them first, then continue waiting on the rest.
5. Keep orchestrating the remaining (non-cancelled) stories until they all finish or are cancelled.

## Subagent message format
Each spawn_agent message must be self-contained and include:
1. The full story-run playbook (provided below under "Story-run playbook for subagents").
2. The story markdown for that assignment.
3. The runId, screenshot path, result JSON path, and schema path for that assignment.
4. An instruction to write the final structured JSON result to the result path (matching the schema file) and save the screenshot to the screenshot path.

## Story-run playbook for subagents
${RUN_STORY_PLAYBOOK}`;
