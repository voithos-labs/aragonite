# Feature: Plugin Admonitions — paste transform

The admonitions dogfood registers a content-keyed, pre-parse paste transform
(`registerPasteTransform`). Pasted GitHub-alert blockquotes (`> [!TIP]`) are
rewritten to `:::name` directive source before the editor parses, so they land
as real admonition blocks — the fence-safe sibling of the host convert button
(which serves loaded documents; the transform serves pastes). The transform is
CST-scoped, so an alert-shaped line pasted inside a code fence stays literal.

On `/test/plugins` the co-registered callout dogfood claims `note`/`warning`, so
an admonition-owned alert type (`tip`) is pasted to assert the admonition kind.
Real clipboard write + `Mod+V`; the CST is read by path via `window.__test`.

## User interactions

- pasting a GitHub alert: a real clipboard write of `> [!TIP]` alert text plus
  `Mod+V` at the caret converts it to a `:::tip` admonition — a root child of
  kind `admonition` — and the document round-trips stable
- single-commit undo: one `Ctrl+Z` after the paste restores the pre-paste
  document byte-for-byte, proving the transform does not split the paste into
  extra undo entries

## Edge cases

- fence-safe conversion: a single paste carrying both a top-level alert and a
  fenced alert converts the top-level one to a `:::tip` admonition while leaving
  the fenced `> [!NOTE]` byte-identical — never rewritten to `:::note`, because
  the converter is parse-scoped, not a line scan. The pasted document holds both
  an `admonition` and a `fencedCode` root child
- whole-table-selection paste: selecting an entire table (second Ctrl+A inside a
  cell) and pasting alert text replaces the table with a `:::tip` admonition —
  this route bypasses the shared paste dispatch and carries its own transform
  call, so the transform must fire there too; the result round-trips stable
