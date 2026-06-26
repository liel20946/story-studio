# Bowser YAML

Bowser user stories are stored as:

```yaml
stories:
  - id: "site-area-purpose"
    name: "Short human-readable story title"
    url: "https://example.com/path"
    mode: "recorded"
    variables:
      search_query: "Jerusalem"
    workflow: |
      Navigate to https://example.com/path
      Click the "Alerts" link
      Fill the "Search" field with "{{search_query}}"
    assertions: |
      @1 Verify the page loads successfully
      @2 Verify the alerts page is visible
      @3 Verify current alerts are displayed
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

- `Navigate to https://www.oref.org.il/eng`
- `Click the "Alerts" link`
- `Fill the "Search" field with "{{search_query}}"`

## Good assertions

- `@1 Verify the page loads successfully`
- `@2 Verify the alerts page is visible`
- `@4 Verify current alerts are displayed`

## Bad steps

- `Click locator("div:nth-child(7) > span")`
- `Click button`
- `Wait 500ms`
- `Verify the page loads` inside `workflow:` (belongs in `assertions:`)

If a low-level selector is unavoidable, keep it only in the raw recording, not in the final workflow, unless the selector maps to a real user-visible element that cannot be described more clearly.
