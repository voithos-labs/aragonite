# Feature: Plugin Admonitions, native alert paste

The admonitions plugin can rewrite a pasted GitHub alert into a `:::name` directive, but only
when it is asked to (`admonitions({ convertAlertsOnPaste: true })`, off by default). The
`/test/plugins` harness leaves that option off, so a pasted alert blockquote (`> [!TIP]`) keeps
its GitHub bytes and lands as a native `admonitions/alert` container, never rewritten to `:::name`.
The tests write the real clipboard and press `Mod+V`, then read the tree by path through
`window.__test`. The opt-in rewrite has unit tests of its own
(`github-alert-paste-opt-in`).

## User interactions

- pasting a GitHub alert: a real clipboard write of `> [!TIP]` alert text, then `Mod+V` at the
  caret, lands a root child of kind `admonitions/alert` whose bytes still read `> [!TIP]` (no
  `:::tip`), and the document round-trips stable
- single-commit undo: one `Ctrl+Z` after the paste restores the document as it was, byte for
  byte, proving the paste is a single undo entry

## Edge cases

- fenced alert stays literal: one paste carrying both a top-level alert and a fenced alert
  lands the top-level one as a native `admonitions/alert` while the fenced `> [!NOTE]` stays inside a
  `fencedCode` block. Neither is rewritten to directive source (no `:::` anywhere)
- whole-table-selection paste: selecting an entire table (a second Ctrl+A inside a cell) and
  pasting alert text replaces the table with a native `admonitions/alert`; the result round-trips
  stable
