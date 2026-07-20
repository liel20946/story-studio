# AGENTS.md — Story Studio

Operational guide for building and releasing Story Studio without breaking auto-update.
Read this before shipping a new version.

## Pull request screenshots (required)

Before creating or updating a PR after UI or user-visible changes:

1. Capture screenshots of **every** visible change (settings, story/run views, generate, etc.).
2. Prefer the existing Electron capture pattern (`scripts/capture-*.mjs` with
   `STORY_STUDIO_MOCK_RUNS=1 xvfb-run -a node scripts/…`) and write PNGs under
   `/opt/cursor/artifacts/screenshots/`.
3. **Show the screenshots** in the PR description (and in the agent response) so
   reviewers can see the result without running the app.
4. Do not open/update a PR for visual work until those screenshots are attached.

## What this app is

- Electron + React (electron-vite) macOS app, Apple Silicon (`arm64`).
- Auto-update is powered by `electron-updater`, reading release metadata from GitHub Releases.
- Main entry: `out/main/index.mjs`. Updater code: `electron/main/services/auto-update-service.ts`.

## How auto-update works (read this first)

1. On launch (and via **Story Studio → Check for Updates…**), the app calls `electron-updater`.
2. `electron-updater` downloads **`latest-mac.yml`** from the latest GitHub Release.
3. It then downloads the artifact named in that yml (`path` / `files[].url`) and validates it against
   the `sha512` and `size` in the yml.
4. If the filename, `sha512`, or `size` in `latest-mac.yml` does not exactly match the uploaded
   asset, the download **silently never completes** — the user sees "downloading in the background"
   forever. This is the #1 way releases break.

### Non-negotiable rule

`latest-mac.yml` must reference the **exact asset filenames as served by GitHub**, plus matching
`sha512` and `size`.

Important GitHub quirk: the local artifact is named with a space — `Story Studio-<ver>-arm64-mac.zip`
— but GitHub **rewrites the space to a dot** when the asset is uploaded, serving it as
`Story.Studio-<ver>-arm64-mac.zip`. Therefore `latest-mac.yml` must use the **dotted** name
(`Story.Studio-*`), not the space or dash form. `scripts/generate-latest-mac-yml.mjs` handles this via
`githubAssetName()` (replaces spaces with dots) — keep that transform.

Ground truth: a working release (e.g. v1.4.8) has both the asset and the yml `url` as
`Story.Studio-1.4.8-arm64-mac.zip` with identical sizes. Match that shape.

## Prerequisites

- macOS on Apple Silicon.
- Node `>=20` (repo uses Node 24 locally).
- **Developer ID Application signing** — required for auto-update. Squirrel.Mac’s Restart /
  `quitAndInstall` does nothing for unsigned zips (this is what broke CI releases 1.5.8–1.5.11).
  Local Mac publishes work when the cert is in your keychain; GitHub Actions needs the same cert
  as secrets (`CSC_LINK` = base64 `.p12`, `CSC_KEY_PASSWORD`). The Release macOS workflow **fails**
  if those secrets are missing — never ship an unsigned build as latest.
- GitHub auth for publishing, one of:
  - `gh auth login -h github.com`, or
  - `GH_TOKEN` env var with `repo` scope.
  - Note: `electron-builder` reads the token **only** from the `GH_TOKEN` (or `GH_TOKEN`/`GITHUB_TOKEN`)
    env var — it does **not** use the `gh` CLI keyring. Being logged in with `gh` is not enough for
    `dist:publish`. Bridge the keyring token into the env when publishing:

    ```bash
    GH_TOKEN=$(gh auth token) npm run dist:publish
    ```
- Bump `version` in `package.json` before releasing. Never reuse a version number for different bits.
  Next release after the unsigned CI streak must be a **new** signed version (e.g. 1.5.12), published
  from Mac or from CI with signing secrets. `v1.5.7` was restored as Latest until then.

## Build (no publish)

```bash
npm install
npm run build      # electron-vite build -> out/
npm run dist       # build + electron-builder -> release/ (.dmg, .zip, .blockmap, latest-mac.yml)
```

Artifacts land in `release/`.

## Release (publish)

Preferred, single command:

```bash
# 1. Bump "version" in package.json first
GH_TOKEN=$(gh auth token) npm run dist:publish
```

`GH_TOKEN` is required — `electron-builder` won't pick up the `gh` login on its own.

`dist:publish` (`scripts/publish-release.mjs`) does:

1. `npm run build`
2. `electron-builder --mac --publish never` — packages locally only.
   **Do not** let electron-builder publish to GitHub: its uploader rewrites
   `Story Studio-*` → `Story-Studio-*` (dashes). Auto-update needs the dotted
   GitHub form `Story.Studio-*` (spaces → dots).
3. Regenerates `latest-mac.yml` from local `release/` via
   `scripts/generate-latest-mac-yml.mjs` (dotted names + matching sha512/size).
4. Creates/uploads a GitHub Release with `gh` using the **space-named** local
   files (GitHub serves them as `Story.Studio-*`), then publishes + marks latest.

### Always verify after publishing

```bash
node -e "fetch('https://github.com/liel20946/story-studio/releases/download/v<VERSION>/latest-mac.yml').then(r=>r.text()).then(console.log)"

gh release view v<VERSION> --json assets --jq '.assets[] | {name, size}'
```

Confirm that, for the zip and dmg in `latest-mac.yml`:

- the `url`/`path` filename **exists** in the release assets, and
- the `size` in the yml **equals** the asset's size,
- names are the **dotted** form (`Story.Studio-*`), not `Story-Studio-*`.

If they don't match, the release is broken — fix before telling anyone to update.

## Fixing a broken release (metadata mismatch)

If a release was published with a bad `latest-mac.yml` (wrong name/size/hash):

```bash
mkdir -p release
gh release download v<VERSION> -D release -p "*.zip" -p "*.dmg"   # get the REAL assets
node scripts/generate-latest-mac-yml.mjs <VERSION>                # regenerate yml from real files
node scripts/upload-update-metadata.mjs <VERSION>                 # re-upload (clobbers old yml)
```

Then re-run the verification commands above.

## Rolling back a release

To make the previous version the latest again (deletes the release and its tag):

```bash
gh release delete v<VERSION> --yes --cleanup-tag
```

## Common pitfalls

- **Unsigned CI builds.** If the Action logs `Signing: disabled`, the zip has no `_CodeSignature`
  and Restart/install will no-op for every existing client. Compare a good release (v1.5.7 has
  `_CodeSignature`) vs a bad one (v1.5.11 has none). Always sign; the workflow now requires it.
- **Manual GitHub UI uploads** skip `latest-mac.yml` and break auto-update. Use the scripts.
- **Wrong asset name form in the yml.** GitHub serves the space-named artifact with a dot
  (`Story Studio` -> `Story.Studio`). The yml must use the dotted name. A dash form (`Story-Studio`)
  is what electron-builder's built-in GitHub publisher uploads — that breaks auto-update if the
  yml expects dots. Always publish via `scripts/publish-release.mjs` (local build + `gh` upload).
- **Size mismatch** between the yml and the real asset is the classic "stuck download" cause
  (this is what broke v1.5.0: yml claimed ~110 MB while the uploaded zip was ~316 MB). Always verify.
- **Reusing a version number** with different binaries confuses `electron-updater` caches. Always bump.
- **Duplicate zips on one release** (e.g. both `Story-Studio-*.zip` and `Story.Studio-*.zip`)
  is a red flag — the yml can end up pointing at the wrong one. Keep one canonical artifact set
  (`Story.Studio-*` only).
- Auto-update only runs in the **packaged** app (`app.isPackaged`); it's a no-op in `npm run dev`.
