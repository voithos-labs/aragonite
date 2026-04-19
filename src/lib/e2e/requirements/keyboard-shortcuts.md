# Feature: Prose keyboard shortcuts

Covers in-prose keyboard shortcuts: hard break, literal tab insertion, heading-level conversion, and Escape for collapsing a live cross-block selection.

## Happy paths

- Shift+Enter inside a paragraph inserts a GFM hard break (`\` + newline) without splitting the block
- Tab inside a paragraph inserts a literal tab character at the cursor (no focus-escape)
- Ctrl+2 on a paragraph converts it to an H2 heading
- Ctrl+3 on an existing H1 replaces the prefix so the heading becomes H3
- Ctrl+0 on a heading converts it back to a plain paragraph

## Edge cases

- Ctrl+3 on a heading with the caret at end preserves the caret at the end of the new heading content, so an immediately-typed character appends to the content (regression against double-counting the old marker length)

## User interactions

- Escape while a cross-block selection is live collapses the selection back to a single-block caret
