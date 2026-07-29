# Feature: A header resize colliding with a reveal in flight

Two writers of one `scrollTop`. The reveal anchor re-asserts an ABSOLUTE position
derived from the list's live offset within the scroll content — a measure that already
includes the header's current height. The header slot's resize observer adds a
RELATIVE delta. Applied to a consistent state each produces the same number; applied
one after the other for the same resize, the delta lands on a position that already
accounts for it.

Where the anchor is HOLDING the position it is the single writer: the header observer
asks, and skips its delta when the answer is yes. It asks rather than re-placing,
because a claim the anchor is not holding still wants the compensation.

Fixture: `/test/editor?header=on` (80px ↔ 240px) — windowed deep enough that the reveal
runs its mount-and-settle loop for real, plus an under-watermark arm where windowing is
inactive and no measure pass ever re-asserts.

## Happy paths

- A `scrollTo` and a header height change in the same tick: the reveal still reports
  `true` and the target still lands inside the scrollport at its `'nearest'` top-pin,
  not a header's height above it.
- A header height change while a landed `'nearest'` reveal still holds its pin (the
  durable-visibility contract search navigation rides) keeps the target at the same
  offset in the scrollport across the resize.

## Edge cases

- The write-level arm: once some `scrollTop` write has placed the target where the
  reveal asked, no later write may take it away again. The landing arms above cannot
  see the defect on their own — a wrong write that something else corrects rests
  correctly, and the corrector here is a side effect of the wrong write itself (its
  scroll shift mounts a block, whose measure pass re-asserts the anchor), so it runs
  only when that slide happens to mount something. Pre-fix this recorded a single
  violation, `{ wrote: 1632, offBy: -160 }`, against an anchor that had just written 1472.
- The other side of the rule, on an UNWINDOWED document: a `'nearest'` reveal of a block
  that is already in view scrolls nothing and still holds its claim, so the anchor's
  placement for it (the top pin) is not where the block is. A header resize there must
  compensate — keep the reader's place — not re-place the target. Windowing hides this
  distinction, because a windowed document re-asserts on every measure pass and the
  target is already at the pin whenever the header resizes; with windowing inactive
  nothing re-asserts, so the resize would be the only re-placement trigger there is. A
  deferral that answered by re-placing moved the reader ~263px.

## Error cases

- No uncaught page errors surface during the reveal, the resize, or the settle.
