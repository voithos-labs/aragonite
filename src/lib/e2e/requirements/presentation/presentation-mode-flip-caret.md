# Feature: the caret survives a presentation-mode flip

A mode switch repaints markers but moves no byte, so the caret position the user
had still names the same position on the other side: the editor captures the
focused leaf's (path, raw offset) before the repaint and puts it back through the
shared restore path after it, clamped to the range the destination can land on as
focus is set. Reading mode has no caret at all, so entering it banks the snapshot
and leaving it for an editable mode spends it. Driven on `/test/editor` through
the header toggles (real clicks, which move focus into the host's own UI, exactly
the shape that used to lose the caret), with the `window.__test` selection bridge
as the answer for where the caret is.

Miss-analysis (#109): the mode-switch specs pinned bytes only and their
requirement said so. Byte equality says nothing about the caret, so the loss read
as normal until a spec owned the caret across a switch.

Miss-analysis (#39): every mode-switch scenario put the caret in prose, so the
capture and restore that a mode-keyed cell render newly fires had nothing
checking it; the presentation specs that carry a table hover its drag handles
instead of entering it.

## Happy paths

- a caret mid-construct in live survives the switch to source at the same raw
  offset, and the next typed byte lands there
- a caret placed in source survives a round trip through each editable mode
  (preview-block, preview-inline, live) at the same path and offset
- switching into an editable mode puts the caret back right away, not only after
  the round trip back
- a caret inside a table cell survives the switch at the same cell path and
  offset, and the next typed byte lands in that cell

## Edge cases

- reading mode has no caret: the bridge reports no selection while reading, and
  the caret banked on entry comes back on the switch out, where typing resumes at
  it

## User interactions

- every switch is a real click on a header toggle; the caret is placed by
  clicking and arrow-stepping, and the proof afterwards is a typed byte landing
  where the caret was

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture)
