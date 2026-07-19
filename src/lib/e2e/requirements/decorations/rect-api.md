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

- `reveal` on an unrevealable path (out of range, no block to mount) resolves `false`
- grid-surface `SELECTION_END` semantics are inherited from `measurePartialRects` and are tested
  at the text-surface clamp only: passing the sentinel as `end` on a table addresses "through the
  last cell", but no spec pins that clamp on a grid — recorded, not covered
- `caretRect` returns `null` while a cross-block selection is active: the parked native selection
  must not leak out as a caret
- `caretRect` called from inside a `selectionChange` handler during cross-block entry returns
  `null`: it reads live `SelectionState`, not the `data-cross-block` DOM mirror the deferred effect
  writes one flush later, so the parked range never leaks during the synchronous emit window
- `caretRect` returns `null` when nothing in the editor is focused
