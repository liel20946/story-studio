# Story Studio

Record and run automated browser sanity stories using your local **Codex CLI** and **Playwright**.

Story Studio is a standalone macOS desktop app (Electron). It does not require the Glaze host app.

## Prerequisites

Before using Story Studio, install and configure:

1. **Codex CLI** — install via Homebrew or Cursor, then authenticate once in Terminal
2. **Playwright** (for recording only) — run `npx playwright install chromium`

## Install (from a build)

1. Download `Story Studio.dmg` (or `.zip`)
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
2. Create a [GitHub personal access token](https://github.com/settings/tokens) with `repo` scope (or run `gh auth login`)
3. Publish:

```bash
export GH_TOKEN=ghp_xxxx   # skip if using gh auth login
npm run dist:publish
```

This uploads the `.dmg`, `.zip`, and `latest-mac.yml` to a new GitHub Release. Installed copies download updates in the background and prompt to restart.

**First install:** friends still need the `.dmg` once (from the release page, AirDrop, etc.). After that, updates are automatic.

## Share with friends

- Send the first `.dmg` from [GitHub Releases](https://github.com/liel20946/story-studio/releases) or AirDrop
- No App Store required
- Friends need their own Codex CLI setup (the app uses their quota and auth)

## Data location

App data is stored under:

`~/Library/Application Support/story-studio/`

On first launch, stories and runs are migrated automatically from the old Glaze app folder (`app.glaze.macos.eww8eck4-local`) if present.

## Features

- Run browser sanity stories with live timeline and screenshots
- Bulk run (up to 3 concurrent)
- Record new stories via Playwright codegen + Codex conversion
- Story library with sections, run history, and settings
