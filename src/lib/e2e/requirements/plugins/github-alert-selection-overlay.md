# Feature: Cross-block selection overlay over a GitHub alert

A GitHub alert renders a title row (the kind's icon and label) from its `[!TYPE]` marker
rather than from bytes, so no child block-host paints it. A block whose whole subtree a
cross-block range holds therefore paints ONE box over everything it renders, chrome
included, and its children paint nothing. A range that cuts through the alert has no such
box: the blocks the range actually touches paint their own pieces.

## Happy paths

- A Mod+Shift+End sweep from the paragraph above the alert to the end of the document
  paints one container-level box whose bounds cover the alert's title row

## Edge cases

- The alert's body block paints nothing under that sweep: the container's box already
  covers it, and two overlays over one line read twice as dark
- A range that ENDS inside the alert paints no container box; the body block paints its
  own endpoint rects, and the title row stays outside the highlight

## Miss-analysis

- The overlay suite pinned container delegation against blockquotes and callouts, whose
  every visible row is a child block, so "children paint it all" was never false in a
  scenario; the first kind with derived chrome (#321) had no coverage at any layer, and
  the classification unit tests asked only for the doc-order class, never for which block
  paints the box.
