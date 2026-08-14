# Feature: selection toolbar (consumer rect-API example)

A demo-route component on `/test/editor` built purely consumer-side: a
`bind:this` `EditorInstance`, `getEvents().on('selectionChange')` for
lifecycle, and `getRects().rangeRects` for both the cross-block and the
single-block anchor — the snapshot carries real range offsets, so the public
API serves extent and geometry alike and the component makes no native
selection read. `normalizeSelection` orders the endpoints and
`getBlockKindAt` excludes an intra-table rectangle, so no path arithmetic and
no class probe live in the component. A `position: fixed` bar floats above the
selection's first rect, carrying the five `TOOLBAR_COMMANDS` as buttons that
call `runCommand(id)` rather than synthesizing a chord, each greyed by
`canRunCommand(id)` when the door would decline it.

## Happy paths

- selecting text inside one paragraph shows the toolbar above the selection's
  first rect
- a cross-block selection shows the toolbar anchored above the selection's
  start-block rects (the `rangeRects` public door)

## User interactions

- collapsing the selection (click) hides the toolbar
- clicking the bold button wraps the selected word: the press cancels its own
  mousedown default, so the caret never leaves the document and the door has a
  focused surface to run on
- a selection starting mid-line in a wrapped paragraph anchors the toolbar at
  rect[0]'s left — the first visual line's geometry, not the multi-line union
- a cross-block selection greys the single-block rewrites out rather than
  hiding the bar: the admissibility read and the door agree on the decline

## Edge cases

- scroll is v1 non-glue: the bar re-anchors on the next selection change, not
  on scroll (documented, untested — asserting a stale position would pin the
  gap, not the contract)
