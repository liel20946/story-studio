#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path


def extract_story_ids(content: str) -> list[str]:
    return re.findall(r'^\s*-\s+id:\s*["\']?([^"\']+)["\']?\s*$', content, flags=re.MULTILINE)


def read_story_body(source_path: Path) -> str:
    if source_path.name not in {"reviewed.story.yaml", "reviewed.story.yml"}:
        raise ValueError(
            f"{source_path} is not a reviewed story file. Append only approved reviewed outputs."
        )
    sibling_review_md = source_path.with_name("reviewed.story.md")
    if not sibling_review_md.exists():
        raise ValueError(f"{source_path} is missing sibling reviewed.story.md")

    content = source_path.read_text().rstrip() + "\n"
    if not content.startswith("stories:\n"):
        raise ValueError(f"{source_path} does not start with 'stories:'")

    lines = content.splitlines()
    if len(lines) < 2:
        raise ValueError(f"{source_path} does not contain any story entries")

    body_lines = lines[1:]
    while body_lines and not body_lines[0].strip():
        body_lines = body_lines[1:]
    while body_lines and not body_lines[-1].strip():
        body_lines = body_lines[:-1]

    body = "\n".join(body_lines)
    if not body:
        raise ValueError(f"{source_path} does not contain any story entries")

    return body + "\n"


def append_stories(source_path: Path, destination_path: Path) -> None:
    source_content = source_path.read_text().rstrip() + "\n"
    source_ids = extract_story_ids(source_content)
    if len(source_ids) != len(set(source_ids)):
        raise ValueError(f"{source_path} contains duplicate story ids")

    source_body = read_story_body(source_path)

    if not destination_path.exists():
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        destination_path.write_text("stories:\n" + source_body)
        return

    existing = destination_path.read_text().rstrip() + "\n"
    if not existing.startswith("stories:\n"):
        raise ValueError(f"{destination_path} does not start with 'stories:'")
    existing_ids = extract_story_ids(existing)
    duplicate_ids = sorted(set(source_ids) & set(existing_ids))
    if duplicate_ids:
        raise ValueError(
            f"{destination_path} already contains story ids: {', '.join(duplicate_ids)}"
        )

    if existing.strip() == "stories:":
        destination_path.write_text("stories:\n" + source_body)
        return

    separator = "" if existing.endswith("\n\n") else "\n"
    destination_path.write_text(existing + separator + source_body)


def main() -> int:
    parser = argparse.ArgumentParser(description="Append approved Bowser story YAML into a shared destination file.")
    parser.add_argument("source", help="Path to a story YAML file that starts with 'stories:'")
    parser.add_argument("destination", help="Path to the shared Bowser YAML file")
    args = parser.parse_args()

    source_path = Path(args.source).resolve()
    destination_path = Path(args.destination).resolve()
    append_stories(source_path, destination_path)
    print(f"source={source_path}")
    print(f"destination={destination_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
