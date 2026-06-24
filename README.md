# Story Studio

A macOS app for recording and running browser sanity tests with your local **Codex CLI** and **Playwright**.

Use it to capture a flow in the browser, turn it into a reusable story, and re-run it anytime with a live timeline, screenshots, and pass/fail results.

## Features

- **Record** new stories from a browser session (Playwright codegen + Codex conversion)
- **Run** stories with a live event timeline and screenshots
- **Bulk run** up to three stories at once
- **Organize** stories into sections with run history
- **Auto-update** — installed copies check for new releases on launch

## Requirements

- macOS (Apple Silicon)
- [Codex CLI](https://github.com/openai/codex) installed and authenticated in Terminal
- [Playwright](https://playwright.dev/) Chromium (for recording only):

```bash
npx playwright install chromium
```

Story Studio uses your local Codex setup — your auth and API usage stay on your machine.

## Install

1. Download the latest **Story Studio** `.dmg` from [GitHub Releases](https://github.com/liel20946/story-studio/releases)
2. Drag the app to **Applications**
3. On first launch, if macOS blocks the app: right-click **Story Studio** → **Open**

## Updates

After the first install, updates are automatic:

- The app checks [GitHub Releases](https://github.com/liel20946/story-studio/releases) when it launches
- You can also use **Story Studio → Check for Updates…** in the menu bar
- When a new version is ready, you'll be prompted to restart

## Getting started

1. Open **Settings** and set your **Recording start URL** (default: `https://example.com`)
2. **Record** a new story from the sidebar, or **import** existing `.story.md` files
3. **Run** a story to watch the agent work through your steps in the browser

### Where data is stored

```
~/Library/Application Support/story-studio/
```

Stories, run history, and settings are saved there.

## Development

```bash
npm install
npm run dev
```

### Build a release locally

```bash
npm run dist
```

Artifacts are written to `release/` (`.dmg` and `.zip`).

### Publish a release

For maintainers shipping a new version:

1. Bump `version` in `package.json`
2. Run `npm run dist:publish` (requires `gh auth login` or `GH_TOKEN` with `repo` scope)

Installed apps will pick up the new release automatically.
