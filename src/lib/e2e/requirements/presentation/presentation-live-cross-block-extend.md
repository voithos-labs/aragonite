# Feature: live-mode cross-block extension over a construct-ending block

A block that ends in a construct ends in a run live mode paints nothing for, and
a cross-block selection's endpoint in that block is its content end. Taken from
the raw length instead, that endpoint would sit inside the trailing hidden run.
Three things must hold there: the painted selection stays inside the block's own
box, collapsing the range lands the caret on an offset it can reach rather than
between delimiter bytes, and typing over the range leaves a join with no
delimiter on screen. Driven on `/test/editor` via `?presentationMode=live`;
offsets come from the `window.__test` selection bridge and the paint from the
overlay's own rects.

## Happy paths

- extending forward out of a block that ends in `**bold**` reaches the next
  block, and the endpoint rects painted in the first block have real width and
  height and stay inside the block's box
- extending backward into such a block stops at its content end: the offset the
  bridge reports is the last one the caret can reach, not the raw length inside
  the run
- collapsing the extension leftward puts the caret at the anchor; collapsing it
  rightward puts it at an offset the caret can reach in the block the focus
  reached

- a collapse puts the caret outside the construct it lands against, on both axes:
  which edge it is (opener or closer) and which way the collapse went
  (`ArrowLeft`/`Escape` to the range's start, `ArrowRight` to its end). Those two
  together are one decision, not two independent facts, because the positional
  sides follow traversal order, so one key means opposite things at an opener and
  at a closer. That is how five of the ten handlers were wrong while five were
  right by coincidence. A collapse takes no step: it jumps to the range's own
  edge, where the answer is relative to the construct. `ArrowUp`/`ArrowDown` are
  the vertical spellings of the same two handlers and reach the same code
- the cell endpoint puts the caret in the same place a prose leaf does; going
  through the cell's own focus path instead skipped the collapse steps and typed
  inside the construct

## Edge cases

- a block that begins with a construct is the mirror case: extending backward
  into it stops at the first offset the caret can reach, and the paint stays
  inside its box
- typing a character over the cross-block range replaces it in one commit and
  the resulting block shows no `*` on screen, because the runs the cut stranded
  go with it (the join cleanup's rule, exercised here through the extension's
  endpoints)
- the same extension in source mode reaches the raw endpoints, where every
  delimiter is painted and nothing moves in

## User interactions

- extensions are built with real `Shift+Arrow` keypresses from a real click; the
  collapse is a real arrow keypress, and the type-over a real keystroke
- rect assertions read the overlay elements the editor actually painted, never a
  recomputed geometry

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
