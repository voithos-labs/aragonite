# Feature: a write that merges a block into a new kind

A write can turn a block into one the line below then reads as part of it: delete the space of
`## a` over a `===` line and the two read as one setext heading. The fix-up merges them, and the
merged block is a level-one heading, not the paragraph the write made, so the page has to draw
that heading there and keep the caret where the write left it.

Miss-analysis: the merge's ids were checked only by the unit rows, which compare change
descriptors, so nothing looked at what the page draws once a merge changes the head's kind.

## Happy paths

- `## a` over `===`, Delete after the `##` in source mode: the source reads `##a` over `===`, one block, drawn as a level-one setext heading, caret still after the `##`

## Edge cases

- one undo puts both blocks back as they were

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
