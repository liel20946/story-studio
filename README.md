# Story Studio

Record and run automated browser sanity stories using your local **Codex CLI** and **Playwright**.

Story Studio is a standalone macOS desktop app (Electron).

## Prerequisites

Before using Story Studio, install and configure:

1. **Codex CLI** — install via Homebrew or Cursor, then authenticate once in Terminal
2. **Playwright** (for recording only) — run `npx playwright install chromium`

## Install (from a build)

1. Download `Story Studio.dmg` (or `.zip`) from [GitHub Releases](https://github.com/liel20946/story-studio/releases)
2. Drag **Story Studio** to Applications
3. First launch on unsigned builds: right-click the app → **Open**

## Development

```bash
npm install
npm run dev
```

## Build for distribution

```bash
npm run dist
```

Output appears in `release/` (`.dmg` and `.zip` for macOS).

## Publish updates (GitHub Releases)

The app checks GitHub Releases for updates on launch and via **Story Studio → Check for Updates…**.

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`)
2. Authenticate with GitHub (`gh auth login`) or set `GH_TOKEN` to a personal access token with `repo` scope
3. Publish:

```bash
export GH_TOKEN=$(gh auth token)   # skip if already exported
npm run dist:publish
```

This uploads the `.dmg`, `.zip`, and `latest-mac.yml` to a new GitHub Release. Installed copies download updates in the background and prompt to restart.

**First install:** send friends the `.dmg` once. After that, updates are automatic.

## Share with friends

- Send the first `.dmg` from GitHub Releases or AirDrop
- No App Store required
- Friends need their own Codex CLI setup (the app uses their quota and auth)

## Data location

App data is stored under:

`~/Library/Application Support/story-studio/`

Stories, runs, and settings live in that folder.

## Features

- Run browser sanity stories with live timeline and screenshots
- Bulk run (up to 3 concurrent)
- Record new stories via Playwright codegen + Codex conversion
- Story library with sections, run history, and settings

## Default recording URL

New recordings pre-fill the start URL from **Settings → Recording**. The factory default is `https://example.com` — change it to your app's URL before recording.
