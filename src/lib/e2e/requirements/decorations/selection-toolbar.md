# Feature: selection toolbar (consumer rect-API example)

A demo-route component on `/test/editor` built purely consumer-side: a
`bind:this` `EditorInstance`, `getEvents().on('selectionChange')` for
lifecycle, and `getRects().rangeRects` for both the cross-block and the
single-block anchor — the snapshot carries real range offsets, so the public
API serves extent and geometry alike and the component makes no native
selection read. A `position: fixed` bar floats above the selection's first
rect.

## Happy paths

- selecting text inside one paragraph shows the toolbar above the selection's
  first rect
- a cross-block selection shows the toolbar anchored above the selection's
  start-block rects (the `rangeRects` public door)

## User interactions

- collapsing the selection (click) hides the toolbar
- a selection starting mid-line in a wrapped paragraph anchors the toolbar at
  rect[0]'s left — the first visual line's geometry, not the multi-line union

## Edge cases

- scroll is v1 non-glue: the bar re-anchors on the next selection change, not
  on scroll (documented, untested — asserting a stale position would pin the
  gap, not the contract)
