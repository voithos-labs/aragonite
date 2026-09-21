# Feature: live-mode horizontal block exits (landable bounds, not declared ranges)

A block's horizontal exit checks ask "is the caret at this block's edge?". In live
mode a hidden run at either end makes the raw edge unreachable, so a check that
tests raw 0 or raw length, or the kind's declared content range (which for a
paragraph, a fenced code block and a table cell is the whole raw), never matches
any caret the user can produce, and the arrow does nothing instead of leaving the
block (#103). The bound every check reads is what the DOM can actually reach: the
extremes the offset traversal can land on, which coincide with 0 and length
wherever nothing is hidden. Driven on `/test/editor` via `?presentationMode=live`;
the `window.__test` selection bridge is what says which block and offset the caret
reached.

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
- a list item opening with `**lead**`: the `- ` the list draws in front of the
  text is an inert widget, so the first offset the item can land on is past both
  it and the hidden `**`, and `ArrowLeft` from the item's start still exits to
  the previous block rather than stalling
- `Shift+ArrowLeft` at the first offset a paragraph can land on extends into the
  previous block instead of collapsing in place
- a table cell's bounds deliberately do not check the mode, unlike a prose
  block's: they follow what the screen shows, so a run the mode hides cannot be
  landed on and one it shows can. In preview-inline that makes them depend on
  which markers are shown at the time: a `[ref]` tail still hidden hops the way
  live's does, and the same cell shows its `**` pair once the caret is near it
  and keeps hopping at the raw edge. The key that did nothing here was never a
  live-only problem
- a block whose exit is already at raw 0 (`Some **bold** text`) is unchanged:
  `Home` reports 0 and `ArrowLeft` exits from there

## User interactions

- Real keystrokes and real clicks only; a caret placed programmatically would
  skip the landing code these bounds are read against
- Every assertion reads the selection bridge, never the DOM: which DOM position a
  key leaves behind is the browser's decision, and the bridge turns it into one
  canonical offset

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)

## Miss-analysis

- Every navigation row ran with every marker painted, where the raw edge is always
  reachable, so comparing against the declared range was indistinguishable from
  comparing against the bound the caret can reach; nothing pressed an arrow at a
  live block edge until this file (#103).
