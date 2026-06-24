#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def promote(output_dir: Path) -> None:
    draft_md = output_dir / "draft.story.md"
    draft_yaml = output_dir / "draft.story.yaml"
    reviewed_md = output_dir / "reviewed.story.md"
    reviewed_yaml = output_dir / "reviewed.story.yaml"

    if not draft_md.exists() or not draft_yaml.exists():
        raise SystemExit(f"Draft story artifacts are missing in {output_dir}")

    reviewed_md.write_text(draft_md.read_text().replace("# Draft UI Story", "# Reviewed UI Story", 1))
    reviewed_yaml.write_text(draft_yaml.read_text())


def main() -> int:
    parser = argparse.ArgumentParser(description="Promote approved draft UI story artifacts into reviewed artifacts.")
    parser.add_argument("--output-dir", required=True, help="Artifact directory containing draft.story.* files")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    promote(output_dir)
    print(f"output_dir={output_dir}")
    print(f"reviewed_yaml={output_dir / 'reviewed.story.yaml'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
