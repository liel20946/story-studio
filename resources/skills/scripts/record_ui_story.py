#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from convert_playwright_recording import convert_recording_file, slugify


def default_output_dir(url: str, cwd: Path) -> Path:
    parsed = urlparse(url)
    site_part = f"{parsed.netloc}{parsed.path}".strip("/") or parsed.netloc or "recorded-site"
    site_slug = slugify(site_part)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return cwd / ".ai" / "ui-story-recordings" / site_slug / timestamp


def ensure_npx_available() -> None:
    result = subprocess.run(["which", "npx"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("`npx` was not found. Install Node.js/npm before using this recorder.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Record a manual browser flow with Playwright codegen and convert it into Bowser-style YAML.")
    parser.add_argument("url", help="Target URL to open in Playwright codegen")
    parser.add_argument("--name", help="Optional story name override")
    parser.add_argument("--output-dir", help="Directory for the recording artifacts")
    parser.add_argument("--yaml-destination", help="Optional shared Bowser YAML destination for this site")
    parser.add_argument("--browser", default="chromium", help="Playwright browser: chromium, firefox, or webkit")
    parser.add_argument("--lang", default="en-US", help="Locale to use during recording")
    parser.add_argument("--viewport-size", default="1440,900", help="Viewport size as WIDTH,HEIGHT")
    parser.add_argument("--target", default="playwright-test", help="Playwright codegen target. Keep the default for converter compatibility.")
    args = parser.parse_args()

    if args.target != "playwright-test":
        raise SystemExit("Only --target=playwright-test is supported by this converter.")

    ensure_npx_available()

    output_dir = Path(args.output_dir).resolve() if args.output_dir else default_output_dir(args.url, Path.cwd()).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    recording_path = output_dir / "recording.spec.ts"
    markdown_output = output_dir / "draft.story.md"
    yaml_output = output_dir / "draft.story.yaml"
    har_output = output_dir / "network.har"
    storage_output = output_dir / "storage.json"

    command = [
        "npx",
        "playwright",
        "codegen",
        args.url,
        "-o",
        str(recording_path),
        "--target",
        args.target,
        "--browser",
        args.browser,
        "--lang",
        args.lang,
        "--viewport-size",
        args.viewport_size,
        "--save-har",
        str(har_output),
        "--save-storage",
        str(storage_output),
    ]

    print("Starting Playwright codegen recording.")
    print("Perform one focused flow, navigate to the screen you want as the final screenshot,")
    print("then close the browser/recorder window when done.")
    print(f"Artifacts will be saved under: {output_dir}")
    if args.yaml_destination:
        print(f"Shared YAML destination: {Path(args.yaml_destination).resolve()}")
    print("")

    completed = subprocess.run(command)
    if completed.returncode != 0:
        return completed.returncode

    if not recording_path.exists() or not recording_path.read_text().strip():
        raise SystemExit(f"Recording did not produce a script at {recording_path}")

    result = convert_recording_file(recording_path, story_name=args.name, source_url=args.url)
    markdown_output.write_text(result["review_markdown"])
    yaml_output.write_text(result["yaml"])

    print("")
    print("Recording converted successfully.")
    print(f"Recording: {recording_path}")
    print(f"Draft review: {markdown_output}")
    print(f"Draft YAML: {yaml_output}")
    if args.yaml_destination:
        print(f"Suggested shared YAML destination: {Path(args.yaml_destination).resolve()}")
    print("")
    print(result["review_markdown"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
