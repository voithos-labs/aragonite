# Feature: a presentation-mode flip leaves the scroll position where the user put it

A mode switch is a view operation: it repaints markers and puts the caret back,
and it writes no scroll position. The caret restore therefore mounts the block
without scrolling, the same path an undo swap already takes for the same reason,
rather than the scrolling one, which yanks the viewport from wherever the user
scrolled to wherever the caret's block happens to sit.

Driven on `/test/editor` through the header toggles (real clicks), with the
editor's own `scrollTop` as the reference answer and the restored caret as the
non-vacuity check: a switch that restored nothing would hold the scroll trivially.

Miss-analysis (#155): every mode-switch scenario asserts bytes or the caret and
none reads the scroll container, so a restore path that scrolls looked identical
to one that does not; the loss was pinned only downstream, in limestone's own
suite.

Miss-analysis (#221): these scenarios did catch the regression, but nothing ran
them. A gate list derived from the commit's own files reached e2e-vr, since the
change was to the height estimator, and never the presentation project, whose
specs exercise the same mode-switch code. A change to shared code takes the gate
of every project that drives it, not the one its files sort under. Its headless
half now lives beside the height-estimator pin in
`reactivity/height-oracle-mode-flip`.

## Happy paths

- switching into reading holds the scroll position
- switching back out of reading puts the caret back and holds the scroll
  position, with the caret's block scrolled far out of view when the switch
  happens
- a round trip through each editable mode (preview-block, preview-inline, live)
  holds it too
- a switch that invalidates measured heights still holds it: the caret's block
  must stay mounted across the switch, so the restore mounts without scrolling.
  Nothing the switch does may recompute the window while its own blur has
  released the block held in place
- a switch that resizes mounted blocks above the viewport (fences losing their
  marker lines on the way into live) holds the block the user is looking at where
  it is: the windowing correction moves the scroll number by what those blocks
  lost, so the number is not what to check there. Miss-analysis: the reference
  answer for a switch was the scroll number over a fixture no switch resized, so
  a height table left stale by the switch dropping its cache, its resize reports
  dropped by the check, held the number and slid the content. Miss-analysis
  (#315): the reference answer was right and its tolerance was a whole two pixels,
  so the fraction the scroller refuses on each correction, one per corrected
  block, passed here; it surfaced only as this scenario re-labeling the leading
  block on the runs where the previous block's edge sat within a pixel of the
  viewport top

## User interactions

- the scroll is a real scroll of the editor's own scroll container; every switch
  is a real click on a header toggle

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
- No ResizeObserver loop error reaches `window.onerror` when a height correction mounts another block. Miss-analysis: the shared fixture relayed only thrown page errors until it also relayed `window.onerror`, so this loop error went unseen.
