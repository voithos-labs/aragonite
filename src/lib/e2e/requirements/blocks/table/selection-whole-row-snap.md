# Feature: Table block — cross-block whole-row selection snap

A table that is an ENDPOINT of a cross-block (different-block) selection snaps to
whole rows, so the painted highlight, clipboard copy, and range delete all agree
on the same cells (WYSIWYG: what is highlighted is what is copied and deleted).
Intra-table (same-path) rectangular selection is unaffected.

## Happy paths

- Drag from a block above into a mid-row, mid-column table cell: the overlay
  covers every cell of each partially-selected row, including cells past the
  drag endpoint (the row's trailing columns).

## User interactions

- Real pointer drag drives the selection; the overlay is read from the painted
  `.selection-overlay` rects, not from internal state.
