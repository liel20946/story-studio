# Bowser YAML

Bowser user stories are stored as:

```yaml
stories:
  - id: "example-homepage"
    name: "Example Domain homepage"
    url: "https://example.com"
    mode: "recorded"
    workflow: |
      Navigate to https://example.com
      Click the "Learn more" link
    assertions: |
      @1 Verify the Example Domain page is visible
      @2 Verify the IANA documentation page opens
```

## Rules

- `id` must be stable and unique within the file.
- Keep `name` short and readable.
- Use `mode: "recorded"` for manually captured stories.
- `workflow` contains **action steps only** — Navigate, Click, Fill, Select, Press.
- `assertions` contains **checks only** — one per line, each starting with `Verify`.
- Prefix each assertion with `@N` where `N` is how many workflow steps have completed before the check runs.
- **End-state recordings:** when the user finishes by clicking into a detail page, tab, or result row after the main action, keep that navigation in `workflow` and place the final assertion at `@<total step count>` describing that destination — not the list/table/toast they clicked away from.
- Store typed inputs in `variables:` and reference them in Fill steps as `{{variable_name}}`.
- Remove accidental or duplicate interactions from the final version.

## Good workflow steps

- `Navigate to https://example.com`
- `Click the "Learn more" link`
- `Fill the "Email" field with "{{login_email}}"`

## Good assertions

- `@1 Verify the Example Domain page is visible`
- `@2 Verify the IANA documentation page opens`

## Bad steps

- `Click locator("div:nth-child(7) > span")`
- `Click button`
- `Wait 500ms`
- `Verify the page loads` inside `workflow:` (belongs in `assertions:`)

If a low-level selector is unavoidable, keep it only in the raw recording, not in the final workflow, unless the selector maps to a real user-visible element that cannot be described more clearly.
