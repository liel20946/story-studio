# AGENTS.md — Story Studio

Operational guide for building and releasing Story Studio without breaking auto-update.
Read this before shipping a new version.

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

`latest-mac.yml` must reference the **exact** uploaded asset filenames, sizes, and hashes.
Never rename artifacts between building and publishing. In particular, do **not** rewrite
`Story-Studio-*` to `Story.Studio-*` (or vice versa) in the metadata — the `url`/`path` must be the
literal filenames present on the release.

## Prerequisites

- macOS on Apple Silicon.
- Node `>=20` (repo uses Node 24 locally).
- GitHub auth for publishing, one of:
  - `gh auth login -h github.com`, or
  - `GH_TOKEN` env var with `repo` scope.
- Bump `version` in `package.json` before releasing. Never reuse a version number for different bits.

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
npm run dist:publish
```

`dist:publish` (`scripts/publish-release.mjs`) does:

1. `npm run build`
2. `electron-builder --publish always` — uploads artifacts + `latest-mac.yml` to the GitHub Release.
3. Falls back to generating `latest-mac.yml` from `release/` if electron-builder didn't, via
   `scripts/generate-latest-mac-yml.mjs`.
4. `scripts/upload-update-metadata.mjs` — uploads/clobbers `latest-mac.yml` on the release tag.

### Always verify after publishing

```bash
node -e "fetch('https://github.com/liel20946/story-studio/releases/download/v<VERSION>/latest-mac.yml').then(r=>r.text()).then(console.log)"

gh release view v<VERSION> --json assets --jq '.assets[] | {name, size}'
```

Confirm that, for the zip and dmg in `latest-mac.yml`:

- the `url`/`path` filename **exists** in the release assets, and
- the `size` in the yml **equals** the asset's size.

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

- **Manual GitHub UI uploads** skip `latest-mac.yml` and break auto-update. Use the scripts.
- **Renaming artifacts** after build desyncs metadata from assets. Don't.
- **Reusing a version number** with different binaries confuses `electron-updater` caches. Always bump.
- **Duplicate/renamed zips on one release** (e.g. both `Story-Studio-*.zip` and `Story.Studio-*.zip`)
  is a red flag — the yml can end up pointing at the wrong one. Keep one canonical artifact set.
- Auto-update only runs in the **packaged** app (`app.isPackaged`); it's a no-op in `npm run dev`.
