# Bowser YAML

Bowser user stories are stored as:

```yaml
stories:
  - id: "site-area-purpose"
    name: "Short human-readable story title"
    url: "https://example.com/path"
    tags: ["area", "intent"]
    mode: "recorded"
    variables:
      search_query: "Jerusalem"
    workflow: |
      Navigate to https://example.com/path
      Verify the page loads successfully
      Click the "Alerts" link
      Verify the alerts page is visible
```

## Rules

- `id` must be stable and unique within the file.
- Keep `name` short and readable.
- Use `mode: "recorded"` for manually captured stories.
- `tags` should be short grouping labels, not full sentences.
- Use one `workflow` line per meaningful action or assertion.
- Prefer user-facing language over selectors.
- Keep `Verify` steps explicit.
- Remove accidental or duplicate interactions from the final version.

## Good Steps

- `Navigate to https://www.oref.org.il/eng`
- `Click the "Alerts" link`
- `Fill the "Search" field with "{{search_query}}"`
- `Verify current alerts are displayed`

## Bad Steps

- `Click locator("div:nth-child(7) > span")`
- `Click button`
- `Wait 500ms`

If a low-level selector is unavoidable, keep it only in the raw recording, not in the final workflow, unless the selector maps to a real user-visible element that cannot be described more clearly.
