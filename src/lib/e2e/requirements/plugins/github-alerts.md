# Feature: Plugin Admonitions — native GitHub alerts

A blockquote whose first line is exactly `> [!TYPE]` renders as a styled alert box
(the shared admonition chrome, keyed off the alert type) with its GitHub bytes
untouched — never rewritten to `:::name`. The marker line is not editable content;
it shows as the badge. Editing the body rebuilds through the marker and keeps the
`githubAlert` kind; the bytes round-trip. On `/test/plugins?seed=admonitions` the
native alert is a `caution` (block 5); `note`/`warning` are owned by the callout
dogfood, so a typed-from-scratch alert uses `tip`.

## Happy paths

- loaded alert renders styled: the seed's `> [!CAUTION]` mounts as a
  `.admonition[data-alert-source='github'][data-kind='caution']` box whose badge
  reads "Caution", and the source still contains the verbatim `> [!CAUTION]` bytes
- typing an alert from scratch: completing `> [!TIP]` forms an empty alert with the
  caret in its body, so typing the body straight on (no second Enter, which exits
  the quote) lands a `githubAlert` root child whose body carries the typed text,
  bytes reading `> [!TIP]\n> …`

## User interactions

- edit inside the body: placing the caret in the alert body and typing appends to
  the body, the container raw rebuilds through the `> [!CAUTION]` marker (preserved
  verbatim), the kind stays `githubAlert`, and the document round-trips stable
- undo after an edit: one `Ctrl+Z` restores the pre-edit document byte-for-byte
- unwrap on Backspace: pressing Backspace at the very start of the alert body lifts
  the first body block out and drops the marker — no `githubAlert` remains, the
  content reparses as a plain block (a multi-block body's remainder is a plain
  blockquote), and bytes are never rewritten to `:::`

## Edge cases

- the marker is not a caret target: the badge is static chrome, so focus lands in
  the body, not on the marker
