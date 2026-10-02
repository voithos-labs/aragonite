# Feature: A header resize colliding with a reveal in flight

Two ways to answer one header resize. The block held for a scroll-into-view goes back to an
absolute position, worked out from the list's live offset within the scroll content (which
already counts the header's current height) and the spot the scroll left the block at. The
header slot's plain correction adds a relative delta instead. Applied one after the other for
the same resize, the delta lands on a position that already accounts for it.

So while a block is held, the header's resize goes through the root list's own correction and
puts the held block back where it landed; a resize arriving after the block was already put
back writes the same position again. With nothing held, the header adds its delta.

Fixture: `/test/editor?header=on` (80px ↔ 240px), windowed deep enough that the scroll
mounts and settles for real, plus a case below the windowing threshold where windowing is
inactive and no measure pass ever puts the held block back.

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
  scroll to a block that is already in view scrolls nothing and holds the block right where it
  sits, mid-viewport. A header resize there must keep the user's place. Windowing hides this,
  because a windowed document puts the held block back on every measure pass; with windowing
  inactive nothing does, so the resize is the only write. When a held `'nearest'` block went
  back to the viewport's top instead of where it landed, answering the resize moved the user
  ~263px.

## Error cases

- No uncaught page errors surface during the reveal, the resize, or the settle.
