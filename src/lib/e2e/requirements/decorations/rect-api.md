# Feature: Public rect API

`editor.getRects()` (and `editor.rects` on the plugin API) expose viewport-space geometry over
the rendered document: a block's box, the rects covering an inline range, the native caret, a
`reveal` that mounts a block windowing left out, and a `scrollTo` that mounts a block by path
and then scrolls the viewport to it. Ranges take their offset semantics from
`measurePartialRects`, and those differ per block: raw offsets (dimmed markers included) on
prose leaves, cell-index coordinates on grids. Rects are real only in a browser, since jsdom
reports boxes of about zero size, so this API is tested end to end.

## Happy paths

- `blockRect` on a thematic break returns its box: a positive-width, near-zero-to-thin-height rect
  positioned where the rule renders
- `rangeRects` over a soft-wrapped paragraph returns more than one rect, one per visual line,
  each with positive width
- `rangeRects` on a heading treats offsets as raw offsets: a range that starts before the dimmed
  `## ` marker measures from the marker, not from the first visible word (marker-inclusive)
- `rangeRects` addressing a table by `[tableIdx, rowIdx, colIdx]` returns that cell's rect(s)

## User interactions

- `caretRect` after a real click lands within a few pixels of the clicked position (x and y),
  reporting the live native caret
- `reveal` on a block scrolled out of the virtual window mounts it and resolves `true`; the
  block's element resolves afterward
- `scrollTo` on a mid-document block windowing left out mounts it and also scrolls the viewport
  so the block is on screen: both halves, not just the mount, since mounting alone is the false
  green to avoid
- `scrollTo` with `{ block: 'center' }` lands the target near the vertical center of the editor
  viewport, distinguishing it from the top-pinned mount and proving the scroll half ran

## Edge cases

- `reveal` on a path it cannot mount (out of range, no block there) resolves `false`
- `scrollTo` on a path it cannot mount (out of range) resolves `false` and scrolls nothing
- `SELECTION_END` on a grid takes its meaning from `measurePartialRects` and is tested only
  where a text block clamps it: passing `SELECTION_END` as `end` on a table addresses "through
  the last cell", but no spec pins that clamp on a grid. Recorded, not covered
- `caretRect` returns `null` while a cross-block selection is active: the native selection the
  editor holds aside must not leak out as a caret
- `caretRect` called from inside a `selectionChange` handler during cross-block entry returns
  `null`: it reads live `SelectionState`, not the `data-cross-block` DOM mirror the deferred effect
  writes one flush later, so the range held aside never leaks during the synchronous emit window
- `caretRect` returns `null` when nothing in the editor is focused
