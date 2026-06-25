#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable
from urllib.parse import urlparse


STOP_WORDS = {
    "a",
    "an",
    "and",
    "article",
    "browse",
    "button",
    "click",
    "content",
    "flow",
    "for",
    "from",
    "guidance",
    "in",
    "on",
    "open",
    "page",
    "recorded",
    "section",
    "site",
    "story",
    "the",
    "to",
    "verify",
    "view",
    "www",
    "com",
    "org",
    "net",
    "eng",
    "flow",
}


def slugify(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered)
    return lowered.strip("-") or "recorded-flow"


def js_string_values(value: str) -> list[str]:
    return [
        group.replace("\\'", "'").replace('\\"', '"')
        for match in re.finditer(r"'((?:\\'|[^'])*)'|\"((?:\\\"|[^\"])*)\"", value)
        for group in [match.group(1) if match.group(1) is not None else match.group(2)]
    ]


def extract_await_statements(source: str) -> list[str]:
    source = limit_to_first_test_block(source)
    return [statement.strip() for statement in re.findall(r"await\s+(.+?);", source, flags=re.DOTALL)]


def limit_to_first_test_block(source: str) -> str:
    if source.count("test(") <= 1:
        return source

    start = source.find("test(")
    if start == -1:
        return source

    body_match = re.search(r"\)\s*=>\s*\{", source[start:])
    if not body_match:
        return source[start:]
    brace_start = start + body_match.end() - 1

    depth = 0
    for index in range(brace_start, len(source)):
        character = source[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]

    return source[start:]


def describe_locator(expression: str) -> str:
    text = expression.strip()
    text = re.sub(r"\.first\(\)|\.last\(\)|\.nth\(\d+\)", "", text)

    role_match = re.search(r"getByRole\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*\{(.+?)\})?\s*\)", text)
    if role_match:
        role = role_match.group(1)
        options = role_match.group(2) or ""
        name_match = re.search(r"name:\s*['\"]([^'\"]+)['\"]", options)
        if name_match:
            return f'"{name_match.group(1)}" {role}'
        return f"the {role}"

    for pattern, formatter in [
        (r"getByLabel\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'"{value}" field'),
        (r"getByPlaceholder\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'field with placeholder "{value}"'),
        (r"getByText\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'text "{value}"'),
        (r"getByAltText\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'image "{value}"'),
        (r"getByTestId\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'element with test id "{value}"'),
        (r"locator\(\s*['\"]([^'\"]+)['\"]\s*\)", lambda value: f'element matching "{value}"'),
    ]:
        match = re.search(pattern, text)
        if match:
            return formatter(match.group(1))

    if text == "page":
        return "the page"

    return f'element `{text}`'


def translate_expectation(statement: str) -> str | None:
    page_title_match = re.match(r"expect\(page\)\.toHaveTitle\((.+)\)$", statement)
    if page_title_match:
        value = js_string_values(page_title_match.group(1))
        if value:
            return f'Verify the page title contains "{value[0]}"'
        return "Verify the page title matches the expected value"

    page_url_match = re.match(r"expect\(page\)\.toHaveURL\((.+)\)$", statement)
    if page_url_match:
        value = js_string_values(page_url_match.group(1))
        if value:
            return f'Verify the current URL contains "{value[0]}"'
        return "Verify the current URL matches the expected value"

    locator_match = re.match(r"expect\((.+)\)\.(\w+)\((.*)\)$", statement)
    if not locator_match:
        return None

    target = describe_locator(locator_match.group(1))
    matcher = locator_match.group(2)
    arguments = js_string_values(locator_match.group(3))

    if matcher == "toBeVisible":
        return f"Verify {target} is visible"
    if matcher == "toContainText" and arguments:
        return f'Verify {target} contains text "{arguments[0]}"'
    if matcher == "toHaveText" and arguments:
        return f'Verify {target} has text "{arguments[0]}"'
    if matcher == "toHaveValue" and arguments:
        return f'Verify {target} has value "{arguments[0]}"'
    if matcher == "toBeChecked":
        return f"Verify {target} is checked"
    if matcher == "toMatchAriaSnapshot":
        return f"Verify {target} matches the expected accessibility snapshot"

    return f"Verify {target} passes `{matcher}`"


def translate_action(statement: str) -> str | None:
    if statement.startswith("page.goto("):
        values = js_string_values(statement)
        if values:
            return f"Navigate to {values[0]}"
        return "Navigate to the target page"

    if statement == "page.goBack()":
        return "Go back to the previous page"
    if statement == "page.goForward()":
        return "Go forward to the next page"
    if statement == "page.reload()":
        return "Reload the current page"

    action_match = re.match(r"(.+)\.(click|dblclick|fill|press|check|uncheck|selectOption|hover|type)\((.*)\)$", statement)
    if not action_match:
        return None

    target = describe_locator(action_match.group(1))
    action = action_match.group(2)
    arguments = js_string_values(action_match.group(3))

    if action == "click":
        return f"Click {target}"
    if action == "dblclick":
        return f"Double-click {target}"
    if action == "fill" and arguments:
        return f'Fill {target} with "{arguments[0]}"'
    if action == "press" and arguments:
        return f'Press "{arguments[0]}" on {target}'
    if action == "check":
        return f"Check {target}"
    if action == "uncheck":
        return f"Uncheck {target}"
    if action == "hover":
        return f"Hover over {target}"
    if action == "type" and arguments:
        return f'Type "{arguments[0]}" into {target}'
    if action == "selectOption" and arguments:
        return f'Select "{arguments[0]}" in {target}'

    return f"Perform `{action}` on {target}"


def translate_statement(statement: str) -> str | None:
    statement = " ".join(statement.split())
    if statement.startswith("expect("):
        return translate_expectation(statement)
    return translate_action(statement)


def derive_default_name(url: str, steps: Iterable[str]) -> str:
    parsed = urlparse(url)
    host = slugify(parsed.netloc or "site")

    for step in steps:
        click_match = re.match(r'Click "([^"]+)" (.+)', step)
        if click_match:
            return f'{click_match.group(1)} on {host}'

    return f"Recorded flow on {host}"


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


def derive_tags(url: str, story_name: str) -> list[str]:
    parsed = urlparse(url)
    tags: list[str] = []

    for segment in parsed.path.split("/"):
        if not segment.strip():
            continue
        normalized = slugify(segment)
        if normalized and normalized not in tags:
            tags.append(normalized)

    for token in re.findall(r"[a-z0-9]+", story_name.lower()):
        if token in STOP_WORDS:
            continue
        normalized = slugify(token)
        if normalized and normalized not in tags:
            tags.append(normalized)

    return tags[:4]


# Keyboard navigation / edit keys captured while fixing typos — not story intent.
_CORRECTION_KEY_BASES = frozenset(
    {
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "Backspace",
        "Delete",
    }
)


def is_correction_press(step: str) -> bool:
    match = re.match(r'^Press "([^"]+)" on ', step)
    if not match:
        return False
    base_key = match.group(1).split("+")[-1]
    return base_key in _CORRECTION_KEY_BASES


def fill_or_type_target(step: str) -> str | None:
    fill_match = re.match(r"^Fill (.+?) with ", step)
    if fill_match:
        return fill_match.group(1).strip()
    type_match = re.match(r'^Type ".+" into (.+)$', step)
    if type_match:
        return type_match.group(1).strip()
    return None


def rebuild_fill_indices(steps: list[str]) -> dict[str, int]:
    indices: dict[str, int] = {}
    for index, step in enumerate(steps):
        target = fill_or_type_target(step)
        if target:
            indices[target] = index
    return indices


def clean_recorded_steps(steps: list[str]) -> list[str]:
    """Remove typo-correction noise and keep the final value per field."""
    result: list[str] = []
    last_fill_index: dict[str, int] = {}
    previous: str | None = None

    for step in steps:
        if is_correction_press(step):
            continue

        if previous is not None and step == previous and step.startswith("Click "):
            continue

        fill_match = re.match(r'^(Fill .+? with )"(.+)"$', step)
        type_match = re.match(r'^(Type )"(.+)" (into .+)$', step)

        if fill_match or type_match:
            target = fill_or_type_target(step)
            assert target is not None
            if target in last_fill_index:
                result.pop(last_fill_index[target])
                last_fill_index = rebuild_fill_indices(result)
            last_fill_index[target] = len(result)
            result.append(step)
        else:
            result.append(step)

        previous = step

    return result


def ensure_verify_steps(steps: list[str], url: str) -> list[str]:
    """Add fallback Verify steps when Playwright codegen produced none."""
    if any(step.startswith("Verify ") for step in steps):
        return steps

    result = list(steps)
    first_nav = next((i for i, step in enumerate(result) if step.startswith("Navigate to ")), None)
    if first_nav is not None:
        result.insert(first_nav + 1, "Verify the page loads successfully")
    else:
        result.insert(0, f"Navigate to {url}")
        result.insert(1, "Verify the page loads successfully")

    last_url: str | None = None
    for step in result:
        if step.startswith("Navigate to "):
            last_url = step.removeprefix("Navigate to ").strip()

    if last_url:
        parsed = urlparse(last_url)
        if parsed.path and parsed.path not in ("/", ""):
            result.append(f'Verify the current URL contains "{parsed.path}"')
        else:
            result.append("Verify the expected page state is visible")
    else:
        result.append("Verify the expected page state is visible")

    return result


def infer_variable_key(target: str, value: str) -> str:
    lowered = target.lower()
    if "password" in lowered:
        return "login_password"
    if "email" in lowered or "e-mail" in lowered:
        return "login_email"
    if "username" in lowered or "user name" in lowered:
        return "login_username"
    if "phone" in lowered or "mobile" in lowered:
        return "phone"
    if "search" in lowered:
        return "search_query"
    label_match = re.search(r'"([^"]+)"', target)
    if label_match:
        key = slugify(label_match.group(1)).replace("-", "_")
        if key:
            return key
    key = slugify(target).replace("-", "_")
    return key or "input_value"


def apply_variables_to_steps(steps: list[str]) -> tuple[list[str], dict[str, str]]:
    variables: dict[str, str] = {}
    updated: list[str] = []
    fill_re = re.compile(r'^(Fill .+ with )"([^"]+)"$')
    type_re = re.compile(r'^(Type )"([^"]+)" (into .+)$')

    for step in steps:
        fill_match = fill_re.match(step)
        if fill_match:
            prefix, value = fill_match.group(1), fill_match.group(2)
            if value.startswith("{{") and value.endswith("}}"):
                updated.append(step)
                continue
            target = prefix.removeprefix("Fill ").removesuffix(" with ")
            key = infer_variable_key(target, value)
            base_key = key
            suffix = 2
            while key in variables and variables[key] != value:
                key = f"{base_key}_{suffix}"
                suffix += 1
            variables[key] = value
            updated.append(f'{prefix}"{{{{{key}}}}}"')
            continue

        type_match = type_re.match(step)
        if type_match:
            prefix, value, suffix = type_match.group(1), type_match.group(2), type_match.group(3)
            if value.startswith("{{") and value.endswith("}}"):
                updated.append(step)
                continue
            key = infer_variable_key(suffix.removeprefix("into "), value)
            base_key = key
            n = 2
            while key in variables and variables[key] != value:
                key = f"{base_key}_{n}"
                n += 1
            variables[key] = value
            updated.append(f'{prefix}"{{{{{key}}}}}" {suffix}')
            continue

        updated.append(step)

    return updated, variables


def build_review_markdown(
    story_id: str,
    story_name: str,
    url: str,
    steps: list[str],
    *,
    mode: str,
    tags: list[str],
    variables: dict[str, str] | None = None,
) -> str:
    numbered_steps = "\n".join(f"{index}. {step}" for index, step in enumerate(steps, start=1))
    tags_text = ", ".join(tags) if tags else "none"
    variables_section = ""
    if variables:
        var_lines = "\n".join(f"- `{key}`: {value}" for key, value in variables.items())
        variables_section = f"## Variables\n\n{var_lines}\n\n"
    return (
        f"# Draft UI Story\n\n"
        f"**ID:** {story_id}\n"
        f"**Story:** {story_name}\n"
        f"**URL:** {url}\n"
        f"**Mode:** {mode}\n"
        f"**Tags:** {tags_text}\n\n"
        f"{variables_section}"
        f"## Workflow\n\n"
        f"{numbered_steps}\n"
    )


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_yaml(
    story_id: str,
    story_name: str,
    url: str,
    steps: list[str],
    *,
    mode: str,
    tags: list[str],
    variables: dict[str, str] | None = None,
) -> str:
    workflow = "\n".join(f"      {step}" for step in steps)
    tags_yaml = ""
    if tags:
        tag_items = ", ".join(yaml_quote(tag) for tag in tags)
        tags_yaml = f"    tags: [{tag_items}]\n"
    variables_yaml = ""
    if variables:
        variables_yaml = "    variables:\n"
        for key, value in variables.items():
            variables_yaml += f"      {key}: {yaml_quote(value)}\n"
    return (
        "stories:\n"
        f"  - id: {yaml_quote(story_id)}\n"
        f"    name: {yaml_quote(story_name)}\n"
        f"    url: {yaml_quote(url)}\n"
        f"{tags_yaml}"
        f"    mode: {yaml_quote(mode)}\n"
        f"{variables_yaml}"
        "    workflow: |\n"
        f"{workflow}\n"
    )


def convert_recording_file(
    recording_path: Path,
    story_name: str | None = None,
    source_url: str | None = None,
    *,
    mode: str = "recorded",
) -> dict[str, str]:
    source = recording_path.read_text()
    statements = extract_await_statements(source)
    steps = [translated for statement in statements if (translated := translate_statement(statement))]

    if not steps:
        raise ValueError(f"No supported Playwright actions found in {recording_path}")

    detected_url = source_url
    if not detected_url:
        goto_match = next((step for step in steps if step.startswith("Navigate to ")), None)
        if goto_match:
            detected_url = goto_match.removeprefix("Navigate to ").strip()
        else:
            detected_url = "https://example.com"

    final_name = story_name or derive_default_name(detected_url, steps)
    story_id = derive_story_id(detected_url, final_name)
    tags = derive_tags(detected_url, final_name)
    steps = clean_recorded_steps(steps)
    steps = ensure_verify_steps(steps, detected_url)
    steps, variables = apply_variables_to_steps(steps)

    return {
        "story_id": story_id,
        "story_name": final_name,
        "url": detected_url,
        "mode": mode,
        "tags": ", ".join(tags),
        "review_markdown": build_review_markdown(
            story_id,
            final_name,
            detected_url,
            steps,
            mode=mode,
            tags=tags,
            variables=variables or None,
        ),
        "yaml": build_yaml(story_id, final_name, detected_url, steps, mode=mode, tags=tags, variables=variables or None),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a Playwright codegen recording into Bowser-style review artifacts.")
    parser.add_argument("recording", help="Path to the Playwright recording (.spec.ts or .spec.js)")
    parser.add_argument("--name", help="Override the generated story name")
    parser.add_argument("--url", help="Override the detected URL")
    parser.add_argument("--mode", default="recorded", help="Story authoring mode to include in the YAML")
    parser.add_argument("--markdown-output", help="Path for the generated Markdown review file")
    parser.add_argument("--yaml-output", help="Path for the generated YAML file")
    args = parser.parse_args()

    recording_path = Path(args.recording).resolve()
    result = convert_recording_file(
        recording_path,
        story_name=args.name,
        source_url=args.url,
        mode=args.mode,
    )

    markdown_output = Path(args.markdown_output).resolve() if args.markdown_output else recording_path.with_name("draft.story.md")
    yaml_output = Path(args.yaml_output).resolve() if args.yaml_output else recording_path.with_name("draft.story.yaml")

    markdown_output.write_text(result["review_markdown"])
    yaml_output.write_text(result["yaml"])

    print(f"story_name={result['story_name']}")
    print(f"markdown_output={markdown_output}")
    print(f"yaml_output={yaml_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
