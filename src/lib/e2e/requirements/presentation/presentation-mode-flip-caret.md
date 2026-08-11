# Feature: the caret survives a presentation-mode flip

A mode flip repaints markers but moves no byte, so the seat the user had still
names the same position on the other side: the editor captures the focused
leaf's (path, raw offset) before the repaint and re-seats it through the shared
restore road after it, clamped to the destination's landable range at the focus
door. Reading mode has no caret at all, so entering it banks the snapshot and
leaving it to an editable rung spends it. Driven on `/test/editor` through the
header toggles (real clicks — the click parks focus in the host's chrome, which
is exactly the shape that used to lose the caret), with the `window.__test`
selection bridge as the caret oracle.

Miss-analysis (#109): the flip family's spec pinned bytes only and its
requirement said so — byte equality is silent about the seat, so the loss read
as normal until a spec owned the caret across a flip.

## Happy paths

- a caret mid-construct in live survives the flip to source at the same raw
  offset, and the next typed byte lands there
- a caret placed in source survives a round trip through each editable rung
  (preview-block, preview-inline, live) at the same path and offset
- flipping INTO an editable rung re-seats the caret right away, not only after
  the round trip back

## Edge cases

- reading mode has no caret: the bridge reports no selection while reading, and
  the caret banked on entry re-seats on the flip out, where typing resumes at it

## User interactions

- every flip is a real click on a header toggle; the caret is placed by
  clicking and arrow-stepping, and the post-flip proof is a typed byte landing
  at the seat

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
