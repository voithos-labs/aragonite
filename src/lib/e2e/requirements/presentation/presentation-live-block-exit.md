# Feature: live-mode horizontal block exits (landable bounds, not declared ranges)

A block's horizontal exit gates ask "is the caret at this block's edge?". In live
mode a hidden run at either end makes the raw edge unreachable, so a gate that
tests raw 0 / raw length — or the kind's declared content range, which for a
paragraph, a fenced code block and a table cell is the whole raw — never matches
any caret the user can produce, and the arrow goes inert instead of leaving the
block (#103). The bound every gate reads is what the DOM can actually land: the
walk's landable extremes, which coincide with 0 / length wherever nothing is
hidden. Driven on `/test/editor` via `?presentationMode=live`; the `window.__test`
selection bridge is the oracle for which block and offset the caret reached.

## Happy paths

- a paragraph opening with `**Lead**`: `Home` lands past the hidden `**`, and one
  `ArrowLeft` there leaves for the previous block's end
- a fenced code block: `Home` lands in the body past the hidden opener fence, and
  one `ArrowLeft` there leaves for the previous block
- a fenced code block: `End` on the body's last line lands before the hidden
  closer fence, and one `ArrowRight` there leaves for the next block
- a table cell ending in `[text][ref]`: `End` lands before the hidden `][ref]`
  tail, and one `ArrowRight` there moves to the next cell in the row
- a table cell opening with a hidden `[`: `Home` lands on the link text, and one
  `ArrowLeft` there moves to the previous cell in row-major order, at its end

## Edge cases

- the same gestures in source mode, where every marker is painted, keep stepping
  inside the block: the bound only moves where the mode paints nothing
- a list item opening with `**lead**`: the ambient `- ` is an inert island, so the
  item's landable start is past BOTH it and the hidden `**`, and `ArrowLeft` from
  the item's start still exits to the previous block rather than stalling
- `Shift+ArrowLeft` at a paragraph's landable start extends into the previous
  block instead of collapsing in place
- a table cell's bounds are mode-UNGUARDED on purpose, unlike a prose block's:
  they follow what the screen shows, so a run the mode hides is unlandable and
  one it reveals is landable. In preview-inline that makes them reveal-state
  dependent — an unrevealed `[ref]` tail hops the same way live's does, and the
  same cell reveals its `**` pair by caret proximity and keeps hopping at the raw
  edge. The dead key this fixes was never live-only
- a block whose exit is already at raw 0 (`Some **bold** text`) is unchanged:
  `Home` reports 0 and `ArrowLeft` exits from there

## User interactions

- Real keystrokes and real clicks only; a programmatic caret would skip the
  landing seam these bounds are read against
- Every assertion reads the selection bridge, never the DOM: which DOM position a
  key leaves behind is the browser's decision, and the bridge canonicalizes it

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

- Every navigation row ran with every marker painted, where the raw edge is always
  reachable, so the gates' declared-range comparison was indistinguishable from the
  landable bound; nothing arrowed at a live block edge until this file (#103).
