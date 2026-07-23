# Feature: Plugin Admonitions — native alert paste

With native alert rendering shipped, the admonitions paste transform is opt-in
(`admonitionsPlugin({ convertAlertsOnPaste: true })`, default off). On the default
`/test/plugins` harness the transform is NOT installed, so a pasted GitHub-alert
blockquote (`> [!TIP]`) keeps its GitHub bytes and lands as a native `githubAlert`
container — never rewritten to `:::name`. Real clipboard write + `Mod+V`; the CST is
read by path via `window.__test`. The opt-in rewrite path is unit-covered
(`github-alert-paste-opt-in`).

## User interactions

- pasting a GitHub alert: a real clipboard write of `> [!TIP]` alert text plus
  `Mod+V` at the caret lands a root child of kind `githubAlert` whose bytes still
  read `> [!TIP]` (no `:::tip`), and the document round-trips stable
- single-commit undo: one `Ctrl+Z` after the paste restores the pre-paste document
  byte-for-byte, proving the paste is a single undo entry

## Edge cases

- fenced alert stays literal: a single paste carrying both a top-level alert and a
  fenced alert lands the top-level one as a native `githubAlert` while the fenced
  `> [!NOTE]` stays inside a `fencedCode` block — neither is rewritten to directive
  source (no `:::` anywhere)
- whole-table-selection paste: selecting an entire table (second Ctrl+A inside a
  cell) and pasting alert text replaces the table with a native `githubAlert` — this
  route bypasses the shared paste dispatch and carries its own parse, so the alert
  must land there too; the result round-trips stable
