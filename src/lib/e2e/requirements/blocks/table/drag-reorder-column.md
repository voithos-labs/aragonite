# Feature: Mouse drag-reorder of table columns (column grip)

Dragging a column's grip horizontally moves that column among all columns,
mirroring the row drag on the X axis. A single vertical insertion line marks the
drop gap during the drag; one column move commits on release (one undo step).
Unlike rows, columns have no fixed header and are not windowed — every column is
movable and the drop gap maps straight to a column index. A grip press under the
move threshold is a CLICK, not a drag: it still opens the affordance menu.

Scope: tables that fit horizontally (no horizontal scroll). Wide-table
horizontal autoscroll is a separate layer.

## Happy paths

- Dragging column A's grip right past column B reorders with insert semantics:
  the dragged column lands where the line showed (B, A, C).
- Dragging a column left past its neighbor reorders leftward (the `gap <= from`
  branch — mirrors the keyboard move-left case).
- Dragging a column right past the last column lands it at the table's end
  (target clamps to the last column position).
- A single vertical insertion line appears at the drop gap during the drag and
  clears on release.
- After a drag the caret is usable in the moved column (typing lands a marker).

## Edge cases

- A drag is a single undo entry; undo restores the pre-drag source exactly,
  including a non-canonical (tight-padding) table's original bytes.
- A drag leaves no container-parity mismatch and logs no page error — the
  per-row cell permute keeps keyed `{#each}` identity (the highest-risk path,
  since every row's cells are permuted at once).

## User interactions

- Real pointer gesture: hover the table to reveal grips, press a column grip,
  move past the threshold horizontally, release over the destination column.
- A plain grip click (press/release without crossing the threshold) opens the
  affordance menu instead of reordering.

## Accessibility

- Mouse-only affordance; the keyboard reorder chord (Alt+Arrow) remains the
  operable, screen-reader path and is covered by reorder-column.spec.ts.
