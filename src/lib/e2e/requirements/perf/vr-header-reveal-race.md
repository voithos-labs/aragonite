# Feature: A header resize colliding with a reveal in flight

Two writers of one `scrollTop`. The block held for a scroll-into-view re-asserts an absolute
position derived from the list's live offset within the scroll content, a measurement that
already includes the header's current height. The header slot's resize observer adds a
relative delta. Applied to a consistent state each produces the same number; applied
one after the other for the same resize, the delta lands on a position that already
accounts for it.

Where that block is being held in place it is the only writer: the header observer
asks, and skips its delta when the answer is yes. It asks rather than re-placing,
because a request the hold is not serving still wants the compensation.

Fixture: `/test/editor?header=on` (80px ↔ 240px), windowed deep enough that the scroll
runs its mount-and-settle loop for real, plus a case below the windowing threshold where
windowing is inactive and no measure pass ever re-asserts.

## Happy paths

- A `scrollTo` and a header height change in the same tick: the scroll still reports
  `true` and the target still lands inside the scroll container at the top position
  `'nearest'` asked for, not a header's height above it.
- A header height change while a finished `'nearest'` scroll still holds its position (the
  lasting visibility search navigation depends on) keeps the target at the same
  offset in the scroll container across the resize.

## Edge cases

- The case at the level of individual writes: once some `scrollTop` write has placed the
  target where the scroll asked, no later write may take it away again. The landing cases
  above cannot see the defect on their own: a wrong write that something else corrects ends
  up correct, and the correction here is a side effect of the wrong write itself (its
  scroll shift mounts a block, whose measure pass re-asserts the held position), so it runs
  only when that slide happens to mount something. Before the fix this recorded a single
  violation, `{ wrote: 1632, offBy: -160 }`, against a hold that had just written 1472.
- The other side of the rule, on a document windowing never turned on for: a `'nearest'`
  scroll to a block that is already in view scrolls nothing and still holds its request, so
  the position the hold would place it at (the top) is not where the block is. A header resize
  there must compensate, keeping the user's place, rather than re-place the target. Windowing
  hides this distinction, because a windowed document re-asserts on every measure pass and the
  target is already at that position whenever the header resizes; with windowing inactive
  nothing re-asserts, so the resize would be the only thing left that could re-place it.
  Answering the resize by re-placing moved the user ~263px.

## Error cases

- No uncaught page errors surface during the reveal, the resize, or the settle.
