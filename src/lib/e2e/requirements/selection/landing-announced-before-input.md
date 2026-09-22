# Feature: a caret landing is announced before the bytes typed after it

A `selectionChange` subscriber keys behaviour on "the caret arrived here" (an inline menu's
baseline, a decoration source scoped to the caret's block). The announcement therefore has to
reach it before the next input does. What the channel reports overall is in
`selection-restore.md` and `gap-caret-surface.md`; this file is only about the order.

## Happy paths

- Enter at the end of a paragraph, then a byte typed straight after: the payload naming the new
  paragraph reports that paragraph still empty, so the arrival was heard before the byte.
- Enter at the end of a list item, then a byte typed straight after: the payload naming the new
  item reports it empty, on the nested path and past the marker prefix the item draws.
- ArrowDown into the block below, then a byte typed straight after: same, on the column landing
  the vertical arrow uses instead of a plain caret placement.

## Edge cases

- A caret restore (`setSelection`) announces once, not twice: the editor announces the position
  itself, so the browser's `selectionchange` that follows repeats one subscribers already have.
  Asserted in `selection-restore.md`.

## Notes

Every scenario repeats the gesture over several blocks in one test. The defect was a race
between the editor's caret placement and the browser's `selectionchange` task, lost on roughly
a third of runs, so one cycle would go green by luck; several in a row will not.

The typed byte goes in with `insertText`, the tightest gap between a placement and an input this
harness can produce, which is the worst case the race has.

A click is deliberately not one of the scenarios. The browser places that caret itself and
reports it well before the next input, even at this harness's speed, so the gesture cannot go
red: the landings that lose the race are the ones the editor performs after its own tick.

Miss-analysis: the channel was only ever tested for what it reports, never for when, and the one
ordering guard that existed (the inline menu's baseline) was taken at `beforeinput` precisely to
work around this, so it passed while the channel stayed late.
