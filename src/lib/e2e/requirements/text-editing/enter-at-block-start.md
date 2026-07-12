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
- source round-trips after every split (`serialize(parse(source)) === source`)

## User interactions

- undo after Enter at offset 0: one Ctrl+Z restores the original single-block source
