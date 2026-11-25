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

## With the rewrite on

`/test/plugins?seed=admonitions-alone` lists `admonitions({ convertAlertsOnPaste: true })` alone.
The rewrite reads the whole paste as text, as 0.11.5's transform did.

Miss-analysis: the transform's rows ran it on raw text in a unit, so no row pasted with it on, and
nothing showed which of the editor's paste routes a rewrite by block type would skip.

- a pasted top-level alert lands as its `:::` box, and one `Ctrl+Z` takes the paste back
- one alert line pasted inside a paragraph lands as a box between the paragraph's halves
- an alert nested in a pasted list item stays an alert
