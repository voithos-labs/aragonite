# Feature: Mouse drag-reorder of table rows on a row-windowed table

Extends drag-reorder-row to tall tables whose body rows are virtualized (some
rows unmounted). Two added capabilities: pointer-edge autoscroll mounts
off-window rows during a drag, and the drop resolves a row's ABSOLUTE index even
when the window has scrolled past row 0 (local mounted index no longer equals
the CST row index).

Scope: the off-window / autoscroll layer only. On-screen reorder semantics, the
header no-op, single-undo, and click-vs-drag are covered by drag-reorder-row.

## Happy paths

- Dragging a body row toward the bottom edge autoscrolls past virtualized rows
  and drops onto a row that was off-window when the gesture began; the dragged
  row lands at that absolute body position.

## Edge cases

- The drop target's row was unmounted at drag start (its absolute index exceeds
  the highest row mounted at that moment) — proven via the live row indices, so
  the test can't pass vacuously on an all-mounted table.
- The reorder preserves total row count (no row dropped or duplicated) and
  leaves no container-parity mismatch; the gesture logs no page error.

## User interactions

- Real pointer gesture: press the body-row grip, hold the pointer in the bottom
  autoscroll band so the rAF loop scrolls off-window rows into view, then move
  out of the band onto the now-mounted target row and release.
