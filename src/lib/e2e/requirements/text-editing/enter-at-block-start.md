# Feature: Enter at block start

Enter with the caret at raw offset 0 of a non-empty text block splits like any
other offset: an empty block appears above, the content keeps its bytes below,
and the caret stays on the content. Symmetric with Enter-at-end and with the
list item's split-at-start path.

## Happy paths

- Enter at offset 0 of a paragraph: empty block above, content below, caret on the content (typing lands at the head of the content)
- Enter at offset 0 of a heading: empty paragraph above, heading kind and text preserved below
- Enter at offset 0 of a setext heading: empty paragraph above, setext kind and text preserved below

## Edge cases

- real click + Home + Enter on a paragraph: same split as the seeded-caret path (the gesture Home lands on raw 0)
- Enter at offset 0 of a blockquote's first child: empty block above inside the blockquote at the same nesting level; nested block-list state stays consistent; caret on the content
- the live tree converges after every split: it matches a reparse of its own serialization
  (not merely `serialize(parse(source)) === source`, which is a tautology for valid GFM — the
  convergence check catches a split that left the tree's kind or shape stale vs its raw)

## User interactions

- undo after Enter at offset 0: one Ctrl+Z restores the original single-block source
