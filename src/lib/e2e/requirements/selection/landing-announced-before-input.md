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
- A click into a list item, then a byte typed straight after with no render flush between the two:
  the payload naming the item reports it without the byte. The browser places that caret, so the
  click itself is what announces it.
- ArrowRight into a plugin leaf whose source is hidden, then a byte typed straight after: the
  payload naming the leaf reports it without the byte. The placement cannot announce the arrival
  there (the source has to be shown first), so this is the case where dropping a repeat must not
  drop the arrival with it.
- ArrowDown onto a whole-block plugin container, read before any render flush: the payload naming
  the container is already there. A container with no character position focuses the block itself
  instead of descending into a column, which is a landing of its own.

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

The click scenario drives the mouse and the keyboard directly rather than through
`clickBlockAtPath`, which waits for a render flush: that wait hands the browser's own
`selectionchange` its turn, and the gesture then passes whether or not the click announces.

Miss-analysis: the channel was only ever tested for what it reports, never for when, and the one
ordering guard that existed (the inline menu's baseline) was taken at `beforeinput` precisely to
work around this, so it passed while the channel stayed late. The whole-block scenario was missed
again a step later: the column landing was pinned on the editable surface, and the container's
branch of the same verb, which lands focus without descending, was never driven. The click was
missed a third time, by a scenario written through a helper that flushes.
