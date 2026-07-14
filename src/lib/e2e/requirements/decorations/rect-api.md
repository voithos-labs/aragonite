# Feature: Public rect API

`editor.getRects()` (and the plugin `editor.rects` door) expose viewport-space geometry over the
rendered document: a block's box, the rects covering an inline range, the native caret, and a
reveal that mounts a windowed-out block. Ranges inherit `measurePartialRects`' per-surface offset
semantics — raw offsets (dimmed markers included) on prose leaves, cell-index coordinates on grid
surfaces. Rects are real only in a browser: jsdom reports ~0-sized boxes, so this surface is
e2e-tested.

## Happy paths

- `blockRect` on a thematic break returns its box: a positive-width, near-zero-to-thin-height rect
  positioned where the rule renders
- `rangeRects` over a soft-wrapped paragraph returns more than one rect — one per visual line —
  each with positive width
- `rangeRects` on a heading treats offsets as raw offsets: a range that starts before the dimmed
  `## ` marker measures from the marker, not from the first visible word (marker-inclusive)
- `rangeRects` addressing a table by `[tableIdx, rowIdx, colIdx]` returns that cell's rect(s)

## User interactions

- `caretRect` after a real click lands within a few pixels of the clicked position (x and y),
  reporting the live native caret
- `reveal` on a block scrolled out of the virtual window mounts it and resolves `true`; the
  block's element resolves afterward

## Edge cases

- `caretRect` returns `null` while a cross-block selection is active: the parked native selection
  must not leak out as a caret
- `caretRect` returns `null` when nothing in the editor is focused
