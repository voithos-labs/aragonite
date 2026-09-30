# Feature: Cross-block selection overlay over a GitHub alert

A GitHub alert renders a title row (the kind's icon and label) from its `[!TYPE]` marker rather
than from bytes, so no child block host paints that row. A block whose whole subtree a
cross-block range covers therefore paints one box over everything it renders, title row
included, and its children paint nothing. A range that cuts through the alert gets no such box:
the blocks the range actually touches paint their own pieces.

## Happy paths

- A Mod+Shift+End sweep from the paragraph above the alert to the end of the document paints one
  container-level box whose bounds cover the alert's title row
- The same range built as a pointer drag across the alert, mid-word to mid-word, paints that
  same box: the rule follows the shape of the range, not the gesture that drew it

## Edge cases

- The alert's body block paints nothing under that sweep, because the container's box already
  covers it and two overlays over one line read twice as dark
- A range that ends inside the alert paints no container box: the body block paints its own
  endpoint rects, and the title row stays outside the highlight

## Miss-analysis

- The overlay suite pinned what a container delegates against blockquotes and callouts, whose
  every visible row is a child block, so "the children paint all of it" was never false in a
  scenario. The first kind whose title row is derived rather than a child block (#321) had
  coverage at no layer, and the classification unit tests asked only which class a block fell
  into in document order, never which block paints the box.
