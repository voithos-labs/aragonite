# Feature: Mouse drag-reorder of table columns on a horizontally-overflowing table

Extends drag-reorder-column to wide tables whose columns overflow `.table-block`'s
`overflow-x` and are partly scrolled off the edge. Added capability: pointer-edge
horizontal autoscroll moves the `.table-block` so a clipped column scrolls into
view and becomes a valid drop target mid-drag. Columns are never windowed — every
cell stays mounted, only clipped — so the column rects are simply re-read live as
the container scrolls (no mount, no re-slice).

Scope: the horizontal-autoscroll layer only. On-screen reorder semantics,
single-undo, parity, and click-vs-drag are covered by drag-reorder-column.

## Happy paths

- Dragging an early column's grip toward the table's right edge autoscrolls past
  the clipped columns and drops onto a column that was scrolled off-screen when
  the gesture began; the dragged column lands at that column's position.

## Edge cases

- The drop target's column was off-screen at drag start (its index exceeds the
  rightmost fully-visible column at that moment) — proven via live geometry, so
  the test can't pass vacuously on a fully-visible table.
- The reorder preserves column count (no column dropped or duplicated) and leaves
  no container-parity mismatch; the gesture logs no page error.

## User interactions

- Real pointer gesture: hover the table to reveal grips, press an early column's
  grip, hold the pointer in the right-edge autoscroll band so the rAF loop scrolls
  clipped columns into view, then move out of the band onto the now-visible target
  column and release.
