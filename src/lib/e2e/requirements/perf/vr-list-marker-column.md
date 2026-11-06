# Feature: Virtual rendering, a windowed list's marker column

A list gives every item one marker column, sized from counts of its items' marker widths that the
list node keeps, so an item the window never mounted still counts. Where markers show (source
mode), the column is as wide as the widest list marker; a to-do's `[ ] ` draws past it.

Driven on `/test/editor` in source mode over a two-thousand-item bullet list below a one-item
reference list, with the long list's last item far below the window.

Miss-analysis: every marker-column row ran on a short list, all of it mounted, so none could tell
the counts from a read of the mounted items.

## Happy paths

- the long list's last item is a to-do and unmounted: the first item's text starts where the
  reference list's text starts, within half a pixel
- the long list's last item has a wider bullet (`-   `) and is unmounted: the first item's text
  starts right of the reference list's text

## Edge cases

- both rows check the long list is windowed (it has spacers) and mounts under half its items
- a byte splice adds a last item with a nine-digit marker below a three-item list: the second
  item, whose bytes the splice left alone and which it keeps as the same node, re-wraps in the
  narrower text column, and its list's height table holds its new drawn height within a pixel.
  Miss-analysis: a kept node no longer re-measures on its own edit, and no row changed a block's
  height from its parent.

## User interactions

- the load goes through the harness; nothing is typed
