# Feature: live-mode cross-block extension over a construct-ending block

A block that ENDS in a construct ends in a run live paints nothing for, and a
cross-block selection's model endpoint in that block is its content end — an
offset inside the trailing hidden run when the endpoint is taken from the raw
length instead. Three things must hold there: the painted selection stays inside
the block's own box, collapsing the range lands the caret on a landable offset
rather than between delimiter bytes, and typing over the range leaves a seam
with no delimiter on screen. Driven on `/test/editor` via
`?presentationMode=live`; offsets come from the `window.__test` selection bridge
and the paint from the overlay's own rects.

## Happy paths

- extending forward out of a block that ends in `**bold**` reaches the next
  block, and the endpoint rects painted in the first block have real width and
  height and stay inside the block's box
- extending backward INTO such a block stops at its content end — the offset the
  bridge reports is the last landable one, not the raw length inside the run
- collapsing the extension leftward puts the caret at the anchor; collapsing it
  rightward puts it at a landable offset in the block the focus reached

- a collapse seats OUTSIDE the construct it lands against, on both axes: the edge kind
  (opener or closer) and the collapse direction (`ArrowLeft`/`Escape` to the range's start,
  `ArrowRight` to its end). The two are one discriminator, not two independent facts — the
  positional sides are walk-order, so one key means opposite things at an opener and at a
  closer, which is how five of the ten arms were wrong while five were right by coincidence.
  A collapse takes no step: it jumps to the range's own edge, where the answer is
  construct-relative. `ArrowUp`/`ArrowDown` are the vertical spellings of the same two arms
  and reach the same door
- the cell endpoint takes the same seat as a prose leaf; seating through the cell's own
  focus door instead skipped the collapse ceremony and typed inside the construct

## Edge cases

- a block that BEGINS with a construct is the mirror case: extending backward
  into it stops at its landable start, and the paint stays inside its box
- typing a character over the cross-block range replaces it in one commit and
  the resulting block shows no `*` on screen — the runs the cut stranded go with
  it (the join seam's rule, exercised here through the extension's endpoints)
- the same extension in source mode reaches the raw endpoints, where every
  delimiter is painted and nothing moves in

## User interactions

- extensions are built with real `Shift+Arrow` presses from a real click; the
  collapse is a real arrow press, and the type-over a real keystroke
- rect assertions read the overlay elements the editor actually painted, never a
  recomputed geometry

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
