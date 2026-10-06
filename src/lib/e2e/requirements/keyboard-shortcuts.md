# Feature: Prose keyboard shortcuts

Covers in-prose keyboard shortcuts: literal tab insertion, where a heading-level conversion leaves the caret, and Escape for collapsing a live cross-block selection. What the hard break and the heading levels write is pinned at the unit level.

## Happy paths

- Tab inside a paragraph inserts a literal tab character at the cursor (no focus-escape)

## Edge cases

- Tab over a selection inside a paragraph changes nothing: no tab goes in, the selection stays on
  the same text, and focus stays in the editor. Shift+Tab, the same. Miss-analysis: the Tab row
  only ever pressed at a caret, and the indent rows over a selection all ran across blocks, so a
  selection inside one paragraph reached the literal tab (it went in before the selected text) and
  Shift+Tab, bound to nothing in prose, let focus leave the editor.

- Ctrl+3 on a heading with the caret at end preserves the caret at the end of the new heading content, so an immediately-typed character appends to the content (regression against double-counting the old marker length)

## User interactions

- Escape while a cross-block selection is live collapses the selection back to a single-block caret
