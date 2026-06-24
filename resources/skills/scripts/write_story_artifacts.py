#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path
from urllib.parse import urlparse


def slugify(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered)
    return lowered.strip("-") or "ui-story"


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def derive_story_id(url: str, story_name: str) -> str:
    parsed = urlparse(url)
    host = slugify(parsed.netloc or "site")
    name_slug = slugify(story_name)
    suffix = f"-on-{host}"
    if name_slug.endswith(suffix):
        name_slug = name_slug[: -len(suffix)] or name_slug
    if name_slug.startswith(host):
        return name_slug
    return f"{host}-{name_slug}"


def normalize_tags(tags: list[str]) -> list[str]:
    normalized: list[str] = []
    for tag in tags:
        candidate = slugify(tag)
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return normalized


def build_markdown(
    title: str,
    story_id: str,
    story_name: str,
    url: str,
    mode: str,
    tags: list[str],
    workflow_steps: list[str],
    source_path: str | None,
) -> str:
    numbered_steps = "\n".join(f"{index}. {step}" for index, step in enumerate(workflow_steps, start=1))
    parts = [
        f"# {title}",
        "",
        f"**ID:** {story_id}",
        f"**Story:** {story_name}",
        f"**URL:** {url}",
        f"**Mode:** {mode}",
        f"**Tags:** {', '.join(tags) if tags else 'none'}",
    ]
    if source_path:
        parts.append(f"**Source Exploration:** `{source_path}`")
    parts.extend(["", "## Workflow", "", numbered_steps, ""])
    return "\n".join(parts)


def build_yaml(story_id: str, story_name: str, url: str, mode: str, tags: list[str], workflow_steps: list[str]) -> str:
    workflow = "\n".join(f"      {step}" for step in workflow_steps)
    tags_yaml = ""
    if tags:
        tags_yaml = "    tags: [" + ", ".join(yaml_quote(tag) for tag in tags) + "]\n"
    return (
        "stories:\n"
        f"  - id: {yaml_quote(story_id)}\n"
        f"    name: {yaml_quote(story_name)}\n"
        f"    url: {yaml_quote(url)}\n"
        f"{tags_yaml}"
        f"    mode: {yaml_quote(mode)}\n"
        "    workflow: |\n"
        f"{workflow}\n"
    )


def write_outputs(
    output_dir: Path,
    story_id: str,
    story_name: str,
    url: str,
    mode: str,
    tags: list[str],
    workflow_steps: list[str],
    source_path: str | None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    draft_md = build_markdown("Draft UI Story", story_id, story_name, url, mode, tags, workflow_steps, source_path)
    draft_yaml = build_yaml(story_id, story_name, url, mode, tags, workflow_steps)
    (output_dir / "draft.story.md").write_text(draft_md)
    (output_dir / "draft.story.yaml").write_text(draft_yaml)


def main() -> int:
    parser = argparse.ArgumentParser(description="Write deterministic draft/reviewed UI story artifacts.")
    parser.add_argument("--output-dir", required=True, help="Artifact directory")
    parser.add_argument("--name", required=True, help="Story name")
    parser.add_argument("--url", required=True, help="Absolute story start URL")
    parser.add_argument("--mode", required=True, choices=["recorded", "generated"], help="Story authoring mode")
    parser.add_argument("--workflow-file", required=True, help="Text file with one workflow step per line")
    parser.add_argument("--story-id", help="Optional explicit story id")
    parser.add_argument("--tags", default="", help="Comma-separated tags")
    parser.add_argument("--source-path", help="Optional source artifact path to embed in Markdown")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    workflow_path = Path(args.workflow_file).resolve()
    workflow_steps = [line.strip() for line in workflow_path.read_text().splitlines() if line.strip()]
    if not workflow_steps:
        raise SystemExit(f"No workflow steps found in {workflow_path}")
    if not any(step.startswith("Verify ") for step in workflow_steps):
        raise SystemExit("Workflow must include at least one 'Verify' step.")

    story_id = args.story_id or derive_story_id(args.url, args.name)
    tags = normalize_tags([tag.strip() for tag in args.tags.split(",") if tag.strip()])

    write_outputs(
        output_dir,
        story_id,
        args.name,
        args.url,
        args.mode,
        tags,
        workflow_steps,
        args.source_path,
    )
    print(f"output_dir={output_dir}")
    print(f"story_id={story_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
