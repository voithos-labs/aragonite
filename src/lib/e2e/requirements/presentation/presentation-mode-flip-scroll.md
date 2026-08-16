# Feature: a presentation-mode flip leaves the scrollport where the reader put it

A flip is a view operation: it repaints markers and re-seats the caret, and it
writes no scroll position. The caret restore therefore rides the bare MOUNT
reveal — the road the history swap already takes for the same reason — rather
than the scrolling one, which yanks the viewport from wherever the reader
scrolled to wherever the caret's block happens to sit.

Driven on `/test/editor` through the header toggles (real clicks), with the
editor's own `scrollTop` as the oracle and the re-seated caret as the
non-vacuity check: a flip that restored nothing would hold the scroll trivially.

Miss-analysis (#155): every flip scenario asserts bytes or the caret and none
reads the scrollport, so a restore road that scrolls looked identical to one
that does not; the loss was pinned only downstream, in limestone's own suite.

## Happy paths

- flipping into reading holds the scroll position
- flipping back out of reading re-seats the caret and holds the scroll position,
  with the caret's block scrolled far out of view when the flip happens
- a round trip through each editable rung (preview-block, preview-inline, live)
  holds it too

## User interactions

- the scroll is a real scroll of the editor's own scrollport; every flip is a
  real click on a header toggle

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
